import Java from "frida-java-bridge";
import { getApi, getArtMethodSpec } from "frida-java-bridge/lib/android.js";
import { logger } from "../shared/logger";

declare module "frida-java-bridge/lib/android.js" {
  // the ArtMethod layout frida-java-bridge detects once and uses for every hook, offsets in bytes
  export function getArtMethodSpec(vm: Java.VM): { size: number; offset: { jniCode: number; quickCode: number; accessFlags: number } };
}

// Workarounds for bugs in frida-java-bridge 7.0.13 on newer Android versions:
// 1. Android 16: hooking an intrinsic or a precompiled boot image method overflows the stack (repairAccessFlags)
// 2. Android 17: Java.backtrace() throws (resolveArtWalkStack)
// 3. Android 17: every hooked method crashes the app at the next GC (fixArtMethodAccessFlagsOffset)
// Remove workarounds once fixed . They depend on the bridge's internals (the `_m` mangler, the memoized ArtMethod
// spec, its API table), so package.json pins the exact version: when upgrading, run javaBridgeWorkarounds.test.ts on
// Android 15, 16 and 17.

// ArtMethod access flags, used by bugs 1 and 3
const kAccNative = 0x0100;
// above these bits, an intrinsic's access flags hold its intrinsic ordinal, e.g. 0xb7280009 of Integer.valueOf(int)
const ACCESS_FLAGS_MASK = 0xffff;

// =====================================================================================================================
// Bug 1 - Android 16: hooking an intrinsic or a precompiled boot image method overflows the stack
// =====================================================================================================================

const kAccPreCompiled = 0x00800000; // also kAccPreviouslyWarm, set on boot image methods
const kAccCompileDontBother = 0x02000000;
const kAccIntrinsic = 0x80000000;
const kAccPublicApi = 0x10000000; // hidden API list of JDK methods such as Integer.valueOf()
// their native methods are signature polymorphic, e.g. MethodHandle.invokeExact(): ART dispatches them by their
// intrinsic, so they must stay intrinsics
const SIGNATURE_POLYMORPHIC_CLASSES = new Set(["java.lang.invoke.MethodHandle", "java.lang.invoke.VarHandle"]);

// frida-java-bridge's ArtMethodMangler, kept as `_m` on the replacement implementation
type ArtMethodMangler = { hookedMethodId?: NativePointer; replacementMethodId?: NativePointer; originalMethod?: { accessFlags: number } };

// Hooking an intrinsic or a precompiled boot image method crashes the app with a stack overflow on Android 16.
//
// Repro (Android 16 arm64 emulator, com.google.android.dialer): hook Integer.valueOf(int) and String.equals(Object)
// with `m.implementation = function (...args) { return m.call(this, ...args); }`. Within seconds: SIGSEGV, "stack
// pointer is not in a rw map; likely due to stack overflow", in frida-agent frames.
//
// Cause: the bridge runs the hook through a native copy of the ArtMethod (the replacement) and lets a call of the
// original through only while the caller's frame is the generic JNI trampoline's frame of that copy.
// - The copy keeps the original's runtime flags plus kAccCompileDontBother, e.g. 0xb7280009 -> 0xb7000109 for
//   Integer.valueOf(int). ART ignores kAccCompileDontBother for intrinsics and with kAccPreCompiled set, so the JIT
//   compiles a JNI stub for the copy. The bridge no longer recognizes that frame, and each call of the original runs
//   the hook again until the stack overflows.
// - The bridge clears and sets runtime flags of the original (0xb7280009 -> 0xb7200009). In an intrinsic these bits
//   hold the intrinsic ordinal, so ART runs another intrinsic's code for it.
//
// frooky hits this because a hook file can hook any method, including JDK intrinsics such as String.equals() that
// the app and the framework call all the time.
//
// Fix: the copy gets only the low access flags plus kAccCompileDontBother, without kAccIntrinsic, its ordinal and
// kAccPreCompiled. A hooked intrinsic becomes a plain public API method with kAccCompileDontBother, as ART would
// still compile an intrinsic and code compiled afterwards would inline it, both skipping the hook. Unhooking
// restores its flags. The signature polymorphic methods of MethodHandle and VarHandle are left alone. Call after
// setting `implementation`, and after fixArtMethodAccessFlagsOffset() (bug 3), whose offset it uses.
export function repairAccessFlags(method: Java.Method): void {
  const mangler = (method.implementation as { _m?: ArtMethodMangler } | null)?._m;
  const { hookedMethodId, replacementMethodId, originalMethod } = mangler ?? {};
  if (!hookedMethodId || !replacementMethodId || !originalMethod) return;
  const target = `${method.holder.$className}.${method.methodName}`;
  const originalFlags = originalMethod.accessFlags >>> 0;
  if ((originalFlags & kAccNative) !== 0 && SIGNATURE_POLYMORPHIC_CLASSES.has(method.holder.$className)) {
    logger.debug(`Kept the access flags of ${target}: signature polymorphic`);
    return;
  }
  const accessFlagsOffset = getArtMethodSpec(Java.vm).offset.accessFlags;
  const replacementFlags = replacementMethodId.add(accessFlagsOffset);
  const flags = replacementFlags.readU32() >>> 0;
  if ((flags & kAccNative) === 0) {
    logger.debug(`Unexpected ArtMethod layout of the replacement of ${target}`);
    return;
  }
  const isIntrinsic = (originalFlags & kAccIntrinsic) !== 0;
  const runtimeFlags = isIntrinsic ? flags & ACCESS_FLAGS_MASK : flags & ~kAccPreCompiled;
  const repairedFlags = (runtimeFlags | kAccCompileDontBother) >>> 0;
  if (repairedFlags !== flags) {
    replacementFlags.writeU32(repairedFlags);
    logger.debug(`Access flags of the replacement of ${target}: 0x${flags.toString(16)} -> 0x${repairedFlags.toString(16)}`);
  }
  if (isIntrinsic) {
    const hookedFlags = ((originalFlags & ACCESS_FLAGS_MASK) | kAccPublicApi | kAccCompileDontBother) >>> 0;
    hookedMethodId.add(accessFlagsOffset).writeU32(hookedFlags);
    logger.debug(`Access flags of the intrinsic ${target}: 0x${originalFlags.toString(16)} -> 0x${hookedFlags.toString(16)}`);
  }
}

// =====================================================================================================================
// Bug 2 - Android 17: Java.backtrace() throws
// =====================================================================================================================

// StackVisitor::WalkStack<CountTransitions::kYes, false>(bool) of Android 17's ART
const WALK_STACK_WITH_FLAG_SYMBOL = "_ZN3art12StackVisitor9WalkStackILNS0_16CountTransitionsE0ELb0EEEvb";

// Java.backtrace() throws on Android 17.
//
// Repro (Android 17 x86_64 emulator, com.google.android.dialer): `Java.perform(() => Java.backtrace())` throws
// "Error: expected a pointer" at makeBacktraceModule (lib/android.js). Android 15 and 16 return the frames.
//
// Cause: Android 17's ART adds a template parameter to StackVisitor::WalkStack(). libart.so no longer exports
// _ZN3art12StackVisitor9WalkStackILNS0_16CountTransitionsE0EEEvb, only WALK_STACK_WITH_FLAG_SYMBOL. The bridge
// looks up only the old name, so api['art::StackVisitor::WalkStack'] is undefined and the backtrace CModule can't
// be created.
//
// frooky hits this on every Java hook with `platformStackTrace: true` or a `callerFilter`: without it, the stack
// traces are empty and the callerFilter drops every call.
//
// Fix: look up the new name too (in the symbol map and the optionals of lib/android.js). Here, it is filled into the
// bridge's API before the first Java.backtrace().
export function resolveArtWalkStack(): void {
  const api = getApi();
  if (api === null || api["art::StackVisitor::WalkStack"] !== undefined) return;
  const address = Process.findModuleByName("libart.so")?.findExportByName(WALK_STACK_WITH_FLAG_SYMBOL);
  if (!address) return;
  api["art::StackVisitor::WalkStack"] = new NativeFunction(address, "void", ["pointer", "bool"], { exceptions: "propagate" });
  logger.debug("Java backtraces use StackVisitor::WalkStack<kYes, false>() of libart.so");
}

// =====================================================================================================================
// Bug 3 - Android 17: every hooked method crashes the app at the next GC
// =====================================================================================================================

const kAccPublic = 0x0001;
const kAccStatic = 0x0008;
const kAccFinal = 0x0010;
// Modifiers of android.os.Process.getElapsedCpuTime(), the method frida-java-bridge finds the access flags offset with
const GET_ELAPSED_CPU_TIME_MODIFIERS = kAccPublic | kAccStatic | kAccFinal | kAccNative;

let artMethodSpecFixed = false;

// Every hooked method crashes the app at the next GC on Android 17.
//
// Repro (Android 17 x86_64 emulator, com.google.android.dialer): hook HashMap.get(Object) with
// `m.implementation = function (...args) { return m.call(this, ...args); }` and trigger GCs (`kill -USR1 <pid>`).
// Within seconds: SIGSEGV, null pointer dereference in art::CodeInfo::DecodeGcMasksOnly(), called by
// ReferenceMapVisitor::VisitFrame() in StackVisitor::WalkStack() from MarkCompact::CheckpointMarkThreadRoots.
// Without a hook, `Runtime.getRuntime().gc()` from Java.perform() crashes the same way in spawn mode: the bridge
// hooks ActivityThread.handleBindApplication() itself to run Java.perform() callbacks once the app is ready.
//
// Cause: getArtMethodSpec() detects the access flags offset as 36 instead of 4, beyond the 32-byte ArtMethod. It
// looks for the first 32-bit word of getElapsedCpuTime()'s ArtMethod that equals `public static final native` once
// kAccFastInterpreterToInterpreterInvoke, kAccPublicApi and kAccNterpInvokeFastPathFlag are masked out. Android 17
// also sets kAccNterpEntryPointFastPathFlag (0x00100000) on that native method: 0x50300119 instead of 0x50200119
// of Android 15 and 16. Offset 4 doesn't match, and the scan matches the flags of the next ArtMethod in the class.
// So the bridge writes every access flags change 4 bytes into the next ArtMethod (or past the replacement's heap
// block), and reads the hooked method's original flags from there:
// - The replacement keeps the original's flags without kAccNative. A GC that walks a thread inside the hook finds
//   the replacement's generic JNI frame, takes it for compiled code and decodes the GC maps of a null method header.
// - The flags of the next method in the class change, and unhooking writes the wrong flags back.
//
// frooky hits this on every Java hook on Android 17, as soon as a GC runs while a hooked method is on a stack.
//
// Fix: compare only the low 16 bits (the Java modifiers) of each word within the ArtMethod. The first match is the
// access flags at offset 4: offset 0 holds the 32-bit reference to the declaring class, which is 8-byte aligned and
// so never matches the odd modifiers. Here, the offset in the bridge's memoized spec is corrected before the first
// Java.perform() and hook. A hook installed before has its flags written to the wrong place, and unhooking it then
// writes the wrong flags back, so that is logged as an error. Skipped for opaque jmethodIDs (ART's index IDs, odd
// values), which only the bridge can decode.
export function fixArtMethodAccessFlagsOffset(): void {
  if (artMethodSpecFixed) return;
  artMethodSpecFixed = true;
  const spec = getArtMethodSpec(Java.vm);
  Java.vm.perform(() => {
    const env = Java.vm.getEnv();
    const processClass = env.findClass("android/os/Process");
    const methodId: NativePointer = env.getStaticMethodId(processClass, "getElapsedCpuTime", "()J");
    env.deleteLocalRef(processClass);
    if (!methodId.and(1).isNull()) return;
    for (let offset = 0; offset < spec.size; offset += 4) {
      if ((methodId.add(offset).readU32() & ACCESS_FLAGS_MASK) !== GET_ELAPSED_CPU_TIME_MODIFIERS) continue;
      if (offset !== spec.offset.accessFlags) {
        logger.debug(`ArtMethod access flags are at offset ${offset}, not ${spec.offset.accessFlags} as frida-java-bridge detected`);
        const hookedBefore = (Java.classFactory as unknown as { _patchedMethods?: Set<unknown> })._patchedMethods?.size ?? 0;
        if (hookedBefore > 0) {
          logger.error(
            `frida-java-bridge hooked ${hookedBefore} method(s) with the wrong ArtMethod access flags offset, unhooking them corrupts their access flags`,
          );
        }
        spec.offset.accessFlags = offset;
      }
      return;
    }
  });
}
