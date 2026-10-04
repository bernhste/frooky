import Java from "frida-java-bridge";
import { getApi, getArtMethodSpec } from "frida-java-bridge/lib/android.js";
import { countCalls, ReplacementCalls, RetiredReplacements } from "./hook/retiredReplacements";
import { fixArtMethodAccessFlagsOffset, repairAccessFlags, resolveArtWalkStack } from "./javaBridgeWorkarounds";

const kAccNative = 0x0100;
const kAccPreCompiled = 0x00800000;
const kAccCompileDontBother = 0x02000000;
const kAccIntrinsic = 0x80000000;
// modifiers of Integer.toOctalString(int), a static method that is neither native nor an intrinsic
const kAccPublicStatic = 0x0009;
const JAVA_MODIFIERS_MASK = 0xffff;

type Mangled = { _m: { hookedMethodId: NativePointer; replacementMethodId: NativePointer } };

// unhooks like AndroidHookManager: an app thread can still be inside a hook the test reverts
const retiredReplacements = new RetiredReplacements();

// runs fn on the app's main thread, which always has a Java stack (the Looper frames)
function onMainThread<T>(fn: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    Java.perform(() => {
      Java.scheduleOnMainThread(() => {
        try {
          resolve(fn());
        } catch (e) {
          reject(e);
        }
      });
    });
  });
}

// the access flags of an ArtMethod, at the offset frida-java-bridge uses
function accessFlagsOf(artMethod: NativePointer): number {
  return artMethod.add(getArtMethodSpec(Java.vm).offset.accessFlags).readU32() >>> 0;
}

describe("repairAccessFlags()", () => {
  it("makes a hooked intrinsic and its replacement plain methods the JIT doesn't compile, until it is unhooked", () => {
    fixArtMethodAccessFlagsOffset();
    // an intrinsic on Android 15 to 17 that the app hardly calls
    const bitCount = Java.use("java.lang.Integer").bitCount.overload("int");
    const flagsBefore = accessFlagsOf(bitCount.handle);
    expect((flagsBefore & kAccIntrinsic) >>> 0).toBe(kAccIntrinsic);
    const replacementCalls: ReplacementCalls = { inFlight: 0, finished: 0 };
    let calls = 0;
    bitCount.implementation = countCalls(replacementCalls, function (value: number): number {
      calls++;
      return bitCount.call(this, value);
    });
    try {
      repairAccessFlags(bitCount);
      const { hookedMethodId, replacementMethodId } = (bitCount.implementation as unknown as Mangled)._m;
      const hookedFlags = accessFlagsOf(hookedMethodId);
      const replacementFlags = accessFlagsOf(replacementMethodId);
      expect((hookedFlags & (kAccIntrinsic | kAccCompileDontBother)) >>> 0).toBe(kAccCompileDontBother);
      expect(hookedFlags & JAVA_MODIFIERS_MASK).toBe(flagsBefore & JAVA_MODIFIERS_MASK);
      expect((replacementFlags & (kAccIntrinsic | kAccPreCompiled | kAccCompileDontBother | kAccNative)) >>> 0).toBe(
        kAccCompileDontBother | kAccNative,
      );

      const results = new Set<number>();
      for (let i = 0; i < 1000; i++) results.add(Java.use("java.lang.Integer").bitCount(0xff));
      expect([...results]).toEqual([8]);
      expect(calls).toBeGreaterThan(999);
    } finally {
      retiredReplacements.revert(bitCount, replacementCalls);
    }
    expect(accessFlagsOf(bitCount.handle)).toBe(flagsBefore);
  });
});

describe("resolveArtWalkStack()", () => {
  it("gives frida-java-bridge a StackVisitor::WalkStack(), so Java.backtrace() walks a thread's Java stack", async () => {
    resolveArtWalkStack();
    expect(getApi()["art::StackVisitor::WalkStack"]).toBeTruthy();
    const classNames = await onMainThread(() => Java.backtrace().frames.map((frame) => frame.className));
    expect(classNames).toContain("android.os.Looper");
  });
});

describe("fixArtMethodAccessFlagsOffset()", () => {
  it("points frida-java-bridge's access flags offset at the access flags within an ArtMethod", () => {
    fixArtMethodAccessFlagsOffset();
    const { size, offset } = getArtMethodSpec(Java.vm);
    const toOctalString = Java.use("java.lang.Integer").toOctalString.overload("int");
    expect(offset.accessFlags).toBeLessThan(size);
    expect(toOctalString.handle.add(offset.accessFlags).readU32() & JAVA_MODIFIERS_MASK).toBe(kAccPublicStatic);
  });

  it("makes the replacement of a hooked method native, so a GC while the hook runs walks its frame", () => {
    fixArtMethodAccessFlagsOffset();
    const { offset } = getArtMethodSpec(Java.vm);
    const runtime = Java.use("java.lang.Runtime").getRuntime();
    const toOctalString = Java.use("java.lang.Integer").toOctalString.overload("int");
    const replacementCalls: ReplacementCalls = { inFlight: 0, finished: 0 };
    toOctalString.implementation = countCalls(replacementCalls, function (value: number): string {
      // marks the roots of this thread too, with the replacement's generic JNI frame on its stack
      runtime.gc();
      return toOctalString.call(this, value);
    });
    try {
      const { replacementMethodId } = (toOctalString.implementation as unknown as Mangled)._m;
      expect(replacementMethodId.add(offset.accessFlags).readU32() & kAccNative).toBe(kAccNative);
      expect(Java.use("java.lang.Integer").toOctalString(8)).toBe("10");
    } finally {
      retiredReplacements.revert(toOctalString, replacementCalls);
    }
  });
});

export {};
