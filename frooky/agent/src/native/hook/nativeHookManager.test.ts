import { FrookyAgent } from "../../FrookyAgent";
import { DEFAULT_DECODER_SETTINGS, DEFAULT_HOOK_SETTINGS } from "../../shared/defaultValues";
import { normalizeInputParams, normalizeInputRetType } from "../../shared/inputParsing/inputDecodableTypes";
import { InputParamSettings } from "../../shared/inputParsing/inputSettings";
import { NativeOffsetHookDeclaration, NativeSymbolHookDeclaration } from "../../shared/hook/hookDeclaration";
import { enterHookCode, leaveHookCode } from "../../shared/hook/hookCodeGuard";
import { filteredCallCount } from "../../shared/hook/hook";
import { logger } from "../../shared/logger";
import { PlatformStackTrace } from "../../shared/platformStackTrace";
import { sleepMilliseconds } from "../../shared/utils";
import { NativeHook } from "./nativeHook";
import { addressHashCode, NativeHookEvent } from "./nativeHookEvent";
import { isWaiting, Resolution, Waiting } from "../../shared/hook/hookManager";
import { NativeHookManager } from "./nativeHookManager";

// resolveHooks() installs nothing, so it can run against always-loaded libc.so exports like malloc
const stackTrace: PlatformStackTrace = { build: () => ({ platformStackTrace: [], nativeStackTrace: [] }) };
const frookyAgent = {} as FrookyAgent;
// kept alive for the whole file: the Interceptor may still touch a function after detach()
const cm = new CModule(`
  int countdown (int n) { return (n == 0) ? 0 : countdown (n - 1) + 1; }
  void write_val (int val, int *out) { *out = val * 2; }
  int add_one (int n) { return n + 1; }
  // like read(2): writes 5 bytes into a larger buffer, returns how many, or -1 for an error
  int fill_hello (char *buf, int len, int fail) {
    if (fail) return -1;
    const char hello[] = "hello";
    for (int i = 0; i < 5; i++) buf[i] = hello[i];
    return 5;
  }
`);

// Bionic's errno is `*__errno()`. Module level like `cm`: its code must outlive the hooks on it.
const cmErrno = new CModule(
  `
  extern int *__errno (void);
  int unlink_missing (int fail) {
    if (!fail) return 0;
    *__errno () = 2;
    return -1;
  }
`,
  { __errno: Module.getGlobalExportByName("__errno") },
);

// qsort() calls compare_ints() from libc.so, a NativeFunction call comes from Frida's agent: a callerFilter on
// libc.so passes the first and drops the second
const cmCompare = new CModule(
  `
  extern int *__errno (void);
  int compare_ints (const int *a, const int *b) {
    int result = (*a > *b) - (*a < *b);
    if (result < 0) *__errno () = 2;
    return result;
  }
`,
  { __errno: Module.getGlobalExportByName("__errno") },
);
const qsort = new NativeFunction(Module.getGlobalExportByName("qsort"), "void", ["pointer", "size_t", "size_t", "pointer"]);

// sorts [first, second] with compare_ints(), one call from libc.so
function sortTwo(first: number, second: number): void {
  const values = Memory.alloc(8);
  values.writeS32(first);
  values.add(4).writeS32(second);
  qsort(values, 2, 4, cmCompare.compare_ints);
}

// Interceptor changes are only committed once no thread runs a JS callback, which can take a moment
// while the app keeps hitting other hooks (e.g. frida-java-bridge's), so call until the hook fires
async function untilHooked(call: () => void, fired: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !fired(); i++) {
    call();
    if (!fired()) await sleepMilliseconds(10);
  }
}

// true if `promise` hasn't settled within 100 ms
async function isPending(promise: Promise<unknown>): Promise<boolean> {
  return Promise.race([promise.then(() => false), sleepMilliseconds(100).then(() => true)]);
}

// what a Resolution that waits for its class or module waits on: `waiting` settles once that loads
async function waitingOf<T>(resolution: Resolution<T>): Promise<Waiting<T>> {
  const result = await resolution;
  if (!isWaiting(result)) throw new Error("expected the hook to wait for its class or module");
  return result;
}

// the result of a Resolution, also one that comes later
async function eventually<T>(resolution: Resolution<T>): Promise<T> {
  const result = await resolution;
  return isWaiting(result) ? result.waiting : result;
}

// the results of Resolutions that the first lookup or the lookups at targetReady decide
async function resultsOf<T>(resolutions: Resolution<T>[]): Promise<T[]> {
  return Promise.all(
    resolutions.map(async (resolution) => {
      const result = await resolution;
      if (isWaiting(result)) throw new Error("expected a result, not a hook that waits for its class or module");
      return result;
    }),
  );
}

function nativeHook(module: string, symbol: string, overrides: Partial<NativeSymbolHookDeclaration> = {}): NativeSymbolHookDeclaration {
  return { module, symbol, hookSettings: DEFAULT_HOOK_SETTINGS, decoderSettings: DEFAULT_DECODER_SETTINGS, ...overrides };
}

function nativeOffsetHook(module: string, offset: string): NativeOffsetHookDeclaration {
  return { module, offset, hookSettings: DEFAULT_HOOK_SETTINGS, decoderSettings: DEFAULT_DECODER_SETTINGS };
}

describe("NativeHookManager", () => {
  describe("resolveHooks()", () => {
    it("resolves an exported symbol to its real address in the module", async () => {
      const manager = new NativeHookManager(stackTrace, frookyAgent);

      const results = await resultsOf(await manager.resolveHooks([nativeHook("libc.so", "malloc")]));

      expect(results.length).toBe(1);
      const hooks = results[0] as NativeHook[];
      expect(hooks).not.toBeNull();
      expect(hooks.length).toBe(1);
      expect(hooks[0].symbolName).toBe("malloc");
      expect(hooks[0].moduleName).toBe("libc.so");
      expect(hooks[0].symbolAddress.toString()).toBe(Process.getModuleByName("libc.so").getExportByName("malloc").toString());
    });

    it("resolves a offset to the module's base address plus the offset", async () => {
      const manager = new NativeHookManager(stackTrace, frookyAgent);
      const libc = Process.getModuleByName("libc.so");
      const mallocOffset = "0x" + libc.getExportByName("malloc").sub(libc.base).toString(16);

      const results = await resultsOf(await manager.resolveHooks([nativeOffsetHook("libc.so", mallocOffset)]));

      const hooks = results[0] as NativeHook[];
      expect(hooks).not.toBeNull();
      expect(hooks[0].symbolName).toBeUndefined();
      expect(hooks[0].offset).toBe(mallocOffset);
      expect(hooks[0].symbolAddress.toString()).toBe(libc.getExportByName("malloc").toString());
    });

    it("returns null when the offset is outside the module", async () => {
      const manager = new NativeHookManager(stackTrace, frookyAgent);
      const libc = Process.getModuleByName("libc.so");

      const results = await resultsOf(await manager.resolveHooks([nativeOffsetHook("libc.so", "0x" + libc.size.toString(16))]));

      expect(results).toEqual([null]);
    });

    it("returns null when the offset points to non-executable memory", async () => {
      const manager = new NativeHookManager(stackTrace, frookyAgent);

      // offset 0 is the ELF header, mapped read-only in libraries linked with separate code segments (lld, Android 10+)
      const results = await resultsOf(await manager.resolveHooks([nativeOffsetHook("libc.so", "0x0")]));

      expect(results).toEqual([null]);
    });

    it("keeps waiting for a module that isn't loaded", async () => {
      const manager = new NativeHookManager(stackTrace, frookyAgent);

      const [result] = await manager.resolveHooks([nativeHook("libDoesNotExist.so", "foo")]);

      expect(await isPending((await waitingOf(result)).waiting)).toBe(true);
    });

    it("returns null when the symbol does not exist in an otherwise resolved module", async () => {
      const manager = new NativeHookManager(stackTrace, frookyAgent);

      const results = await resultsOf(await manager.resolveHooks([nativeHook("libc.so", "thisSymbolDoesNotExist")]));

      expect(results).toEqual([null]);
    });

    it("resolves the module once and shares that same Module instance across every hook that references it", async () => {
      // Process.getModuleByName can't be spied on, so this checks that both hooks get the same Module instance
      const manager = new NativeHookManager(stackTrace, frookyAgent);

      const results = await resultsOf(await manager.resolveHooks([nativeHook("libc.so", "malloc"), nativeHook("libc.so", "free")]));

      const [mallocHooks, freeHooks] = results as NativeHook[][];
      expect(mallocHooks[0].module).toBe(freeHooks[0].module);
    });

    it("processes hooks for different modules independently", async () => {
      const manager = new NativeHookManager(stackTrace, frookyAgent);

      const results = await resultsOf(await manager.resolveHooks([nativeHook("libc.so", "malloc"), nativeHook("liblog.so", "__android_log_print")]));

      expect(results.length).toBe(2);
      expect(results.every((hooks) => hooks !== null && hooks.length === 1)).toBeTruthy();
    });

    it("installs the hooks of a module that loads later while it loads", async () => {
      // a system library the test app doesn't load by itself (checked on Android 15)
      const moduleName = "libcrypto_utils.so";
      const symbol = "android_pubkey_decode";
      expect(Process.findModuleByName(moduleName)).toBeNull();
      const manager = new NativeHookManager(stackTrace, frookyAgent);

      const pending = await manager.resolveHooks([nativeHook(moduleName, symbol)]);
      const module = Module.load(`/system/lib64/${moduleName}`);

      // no await since Module.load(): the hook was installed while the linker loaded the module
      expect(manager.hookIndex.describeHooksInModulesOf([module.base])).toEqual([`${moduleName}!${symbol}`]);
      expect(manager.hookIndex.isInHookedModule(module.base)).toBe(true);
      expect(manager.hookIndex.isInHookedModule(module.base.add(module.size))).toBe(false);
      const hooks = await eventually(pending[0]);
      expect(hooks![0].symbolAddress.toString()).toBe(module.getExportByName(symbol).toString());
      expect(manager.registerHooks(hooks!)).toBe(1);
      manager.unregisterHooks(hooks!);
    });

    it("resolves the hooks of a loaded module while another module of the batch is still waited for", async () => {
      const manager = new NativeHookManager(stackTrace, frookyAgent);

      const [missingModuleResult, resolvedResult] = await manager.resolveHooks([
        nativeHook("libDoesNotExist.so", "foo"),
        nativeHook("libc.so", "malloc"),
      ]);

      expect((await eventually(resolvedResult))![0].symbolName).toBe("malloc");
      expect(await isPending((await waitingOf(missingModuleResult)).waiting)).toBe(true);
    });
  });

  // installs a real Interceptor hook on libc's atoi() and calls it from the test; other threads of
  // the host process may call it too, so this only asserts on calls from before/after the detach
  describe("registerHooks() / unregisterHooks()", () => {
    it("warns when a hook's function is already hooked under another name", async () => {
      const manager = new NativeHookManager(stackTrace, frookyAgent);
      const [hooks] = await resultsOf(await manager.resolveHooks([nativeHook("libc.so", "atoi")]));
      const sameName: NativeHook = { ...hooks![0] };
      const alias: NativeHook = { ...hooks![0], symbolName: "atoi_alias" };
      const warnSpy = spyOn(logger, "warn");
      try {
        manager.registerHooks([hooks![0], sameName]);
        expect(warnSpy).not.toHaveBeenCalled();

        manager.registerHooks([alias]);
        const messages = warnSpy.mock.calls.map((call) => String(call[0]));
        expect(messages).toEqual([
          `libc.so!atoi_alias is the same function as libc.so!atoi (${alias.symbolAddress}): each call is recorded once per hook.`,
        ]);
      } finally {
        warnSpy.mockRestore();
        manager.unregisterHooks([hooks![0], sameName, alias]);
      }
    });

    it("detaches the Interceptor listener", async () => {
      const agent = { addEventToLog: fn() } as unknown as FrookyAgent;
      const manager = new NativeHookManager(stackTrace, agent);
      const [hooks] = await resultsOf(await manager.resolveHooks([nativeHook("libc.so", "atoi")]));
      const atoi = new NativeFunction(hooks![0].symbolAddress, "int", ["pointer"]);
      const input = Memory.allocUtf8String("42");

      expect(manager.registerHooks(hooks!)).toBe(1);
      expect(hooks![0].listener).toBeDefined();
      await untilHooked(
        () => atoi(input),
        () => (agent.addEventToLog as unknown as Mock).mock.calls.length > 0,
      );
      expect(atoi(input)).toBe(42);
      expect((agent.addEventToLog as unknown as Mock).mock.calls.length).toBeGreaterThan(0);

      manager.unregisterHooks(hooks!);
      expect(hooks![0].listener).toBeUndefined();
      (agent.addEventToLog as unknown as Mock).mockClear();
      expect(atoi(input)).toBe(42);
      expect((agent.addEventToLog as unknown as Mock).mock.calls.length).toBe(0);
    });

    it("drops a call from a module the callerFilter doesn't match, before decoding or building a stack trace", async () => {
      const events: NativeHookEvent[] = [];
      const agent = { addEventToLog: (event: NativeHookEvent) => events.push(event) } as unknown as FrookyAgent;
      let builds = 0;
      const countingStackTrace: PlatformStackTrace = {
        build: () => {
          builds++;
          return { platformStackTrace: [], nativeStackTrace: [] };
        },
      };
      const manager = new NativeHookManager(countingStackTrace, agent);
      const params = normalizeInputParams([["int", "n"]], DEFAULT_DECODER_SETTINGS);
      const hookSettings = { ...DEFAULT_HOOK_SETTINGS, nativeStackTrace: true, callerFilter: ["^never\\.so$"] };
      const [hooks] = await resultsOf(await manager.resolveHooks([nativeHook("libc.so", "atoi", { params, hookSettings })]));
      const hook: NativeHook = { ...hooks![0], symbolName: "add_one", symbolAddress: cm.add_one };
      // a hook without filter on the same function tells when the listener is committed
      const probe: NativeHook = { ...hooks![0], hookSettings: DEFAULT_HOOK_SETTINGS, symbolName: "add_one_probe", symbolAddress: cm.add_one };

      manager.registerHooks([hook, probe]);
      try {
        const addOne = new NativeFunction(cm.add_one, "int", ["int"]);
        await untilHooked(
          () => addOne(1),
          () => events.length > 0,
        );
      } finally {
        manager.unregisterHooks([hook, probe]);
      }

      expect(events.length).toBeGreaterThan(0);
      expect(events.every((event) => event.symbol === "add_one_probe")).toBeTruthy();
      expect(builds).toBe(0);
    });

    it("checks the callerFilter in native code and decodes the calls from matching modules", async () => {
      const events: NativeHookEvent[] = [];
      const agent = { addEventToLog: (event: NativeHookEvent) => events.push(event) } as unknown as FrookyAgent;
      const manager = new NativeHookManager(stackTrace, agent);
      const params = normalizeInputParams(
        [
          ["const int *", "a"],
          ["const int *", "b"],
        ],
        DEFAULT_DECODER_SETTINGS,
      );
      const retType = normalizeInputRetType(["int", { decoder: "errno" }], DEFAULT_DECODER_SETTINGS);
      const hookSettings = { ...DEFAULT_HOOK_SETTINGS, callerFilter: ["^libc\\.so$"] };
      const [hooks] = await resultsOf(await manager.resolveHooks([nativeHook("libc.so", "atoi", { params, retType, hookSettings })]));
      const hook: NativeHook = { ...hooks![0], symbolName: "compare_ints", symbolAddress: cmCompare.compare_ints };
      const debugSpy = spyOn(logger, "debug");

      manager.registerHooks([hook]);
      try {
        await untilHooked(
          () => sortTwo(1, 2),
          () => events.length > 0,
        );
        events.length = 0;
        const compareInts = new NativeFunction(cmCompare.compare_ints, "int", ["pointer", "pointer"]);
        const filteredBefore = filteredCallCount(hook);
        compareInts(Memory.alloc(8), Memory.alloc(8));
        compareInts(Memory.alloc(8), Memory.alloc(8));
        sortTwo(1, 2);

        expect(debugSpy.mock.calls.map((call) => String(call[0]))).toContain("Caller filter on libc.so!compare_ints: checked in native code");
        expect(filteredCallCount(hook) - filteredBefore).toBe(2);
        expect(events.length).toBe(1);
        expect(events[0].argsIn!.length).toBe(2);
        expect(events[0].returnValue!.value).toEqual({ value: -1, errno: { number: 2, name: "ENOENT", message: "No such file or directory" } });
      } finally {
        debugSpy.mockRestore();
        manager.unregisterHooks([hook]);
      }
    });

    it("switches to the JS listener while a hook on the same function needs native stack traces, and back", async () => {
      const events: NativeHookEvent[] = [];
      const agent = { addEventToLog: (event: NativeHookEvent) => events.push(event) } as unknown as FrookyAgent;
      const manager = new NativeHookManager(stackTrace, agent);
      const hookSettings = { ...DEFAULT_HOOK_SETTINGS, callerFilter: ["^libc\\.so$"] };
      const [hooks] = await resultsOf(await manager.resolveHooks([nativeHook("libc.so", "atoi", { hookSettings })]));
      const hook: NativeHook = { ...hooks![0], symbolName: "compare_ints", symbolAddress: cmCompare.compare_ints };
      const tracing: NativeHook = {
        ...hook,
        symbolName: "compare_ints_traced",
        hookSettings: { ...hookSettings, nativeStackTrace: true },
      };
      const debugSpy = spyOn(logger, "debug");
      const debugMessages = () => debugSpy.mock.calls.map((call) => String(call[0]));

      manager.registerHooks([hook]);
      try {
        manager.registerHooks([tracing]);
        expect(debugMessages()).toContain("Caller filter on libc.so!compare_ints_traced: checked in JS, as a hook records native stack traces");
        await untilHooked(
          () => sortTwo(1, 2),
          () => events.some((event) => event.symbol === "compare_ints_traced"),
        );
        expect(events.some((event) => event.symbol === "compare_ints")).toBeTruthy();

        manager.unregisterHooks([tracing]);
        expect(debugMessages()[debugMessages().length - 1]).toBe("Caller filter on libc.so!compare_ints: checked in native code");
        events.length = 0;
        await untilHooked(
          () => sortTwo(1, 2),
          () => events.length > 0,
        );
        expect(events.every((event) => event.symbol === "compare_ints")).toBeTruthy();
      } finally {
        debugSpy.mockRestore();
        manager.unregisterHooks([hook, tracing]);
      }
    });

    it("keeps the arguments and stack trace of each call apart when calls overlap", async () => {
      // countdown(3) recurses down to countdown(0), so every onEnter runs before the first onLeave
      const events: NativeHookEvent[] = [];
      const agent = { addEventToLog: (event: NativeHookEvent) => events.push(event) } as unknown as FrookyAgent;
      let enterCount = 0;
      const countingStackTrace: PlatformStackTrace = { build: () => ({ platformStackTrace: [`enter ${enterCount++}`], nativeStackTrace: [] }) };
      const manager = new NativeHookManager(countingStackTrace, agent);
      const params = normalizeInputParams([["int", "n"]], DEFAULT_DECODER_SETTINGS);
      const retType = normalizeInputRetType("int", DEFAULT_DECODER_SETTINGS);
      const [hooks] = await resultsOf(
        await manager.resolveHooks([
          nativeHook("libc.so", "atoi", { params, retType, hookSettings: { ...DEFAULT_HOOK_SETTINGS, platformStackTrace: true } }),
        ]),
      );
      const hook: NativeHook = { ...hooks![0], symbolName: "countdown", symbolAddress: cm.countdown };

      manager.registerHooks([hook]);
      await untilHooked(
        () => new NativeFunction(cm.countdown, "int", ["int"])(0),
        () => events.length > 0,
      );
      events.length = 0;
      enterCount = 0;
      try {
        expect(new NativeFunction(cm.countdown, "int", ["int"])(3)).toBe(3);
      } finally {
        manager.unregisterHooks([hook]);
      }

      // events are added on leave, innermost call first; countdown(n) was entered as call number 3 - n
      expect(events.map((event) => [event.argsIn![0].value, event.returnValue!.value, event.stackTrace!.platformStackTrace[0]])).toEqual([
        [0, 0, "enter 3"],
        [1, 1, "enter 2"],
        [2, 2, "enter 1"],
        [3, 3, "enter 0"],
      ]);
    });

    it("decodes out parameters in onLeave without accessing invalidated InvocationArgs", async () => {
      const events: NativeHookEvent[] = [];
      const agent = { addEventToLog: (event: NativeHookEvent) => events.push(event) } as unknown as FrookyAgent;
      const manager = new NativeHookManager(stackTrace, agent);
      const params = normalizeInputParams(
        [
          ["int", "val"],
          ["int *", "out", { direction: "out" }],
        ],
        DEFAULT_DECODER_SETTINGS,
      );
      const [hooks] = await resultsOf(await manager.resolveHooks([nativeHook("libc.so", "atoi", { params })]));
      const hook: NativeHook = { ...hooks![0], symbolName: "write_val", symbolAddress: cm.write_val };

      manager.registerHooks([hook]);
      const writeVal = new NativeFunction(cm.write_val, "void", ["int", "pointer"]);
      const outBuf = Memory.alloc(4);
      outBuf.writeInt(0);

      await untilHooked(
        () => writeVal(21, outBuf),
        () => events.length > 0,
      );
      events.length = 0;
      try {
        writeVal(21, outBuf);
      } finally {
        manager.unregisterHooks([hook]);
      }

      expect(events.length).toBe(1);
      expect(events[0].argsIn).toEqual([{ type: "int", name: "val", value: 21 }]);
      expect(events[0].argsOut).toEqual([{ type: "int *", name: "out", value: 42 }]);
    });

    it("decodes the errno of a call that returns -1 with decoder: errno", async () => {
      const events: NativeHookEvent[] = [];
      const agent = { addEventToLog: (event: NativeHookEvent) => events.push(event) } as unknown as FrookyAgent;
      const manager = new NativeHookManager(stackTrace, agent);
      const params = normalizeInputParams([["int", "fail"]], DEFAULT_DECODER_SETTINGS);
      const retType = normalizeInputRetType(["int", { decoder: "errno" }], DEFAULT_DECODER_SETTINGS);
      const [hooks] = await resultsOf(await manager.resolveHooks([nativeHook("libc.so", "atoi", { params, retType })]));
      const hook: NativeHook = { ...hooks![0], symbolName: "unlink_missing", symbolAddress: cmErrno.unlink_missing };

      manager.registerHooks([hook]);
      const unlinkMissing = new NativeFunction(cmErrno.unlink_missing, "int", ["int"]);
      await untilHooked(
        () => unlinkMissing(0),
        () => events.length > 0,
      );
      events.length = 0;
      try {
        unlinkMissing(0);
        unlinkMissing(1);
      } finally {
        manager.unregisterHooks([hook]);
      }

      expect(events.map((event) => event.returnValue!.value)).toEqual([
        { value: 0, errno: null },
        { value: -1, errno: { number: 2, name: "ENOENT", message: "No such file or directory" } },
      ]);
    });

    it("passes the decoded return value to an out param with the role length: $ret", async () => {
      const events: NativeHookEvent[] = [];
      const agent = { addEventToLog: (event: NativeHookEvent) => events.push(event) } as unknown as FrookyAgent;
      const manager = new NativeHookManager(stackTrace, agent);
      const params = normalizeInputParams(
        [
          ["void *", "buf", { direction: "out", decoderArgs: { length: "$ret" }, decoder: "string" }],
          ["int", "len"],
          ["int", "fail"],
        ],
        DEFAULT_DECODER_SETTINGS,
      );
      const retType = normalizeInputRetType("int", DEFAULT_DECODER_SETTINGS);
      const [hooks] = await resultsOf(await manager.resolveHooks([nativeHook("libc.so", "atoi", { params, retType })]));
      const hook: NativeHook = { ...hooks![0], symbolName: "fill_hello", symbolAddress: cm.fill_hello };

      manager.registerHooks([hook]);
      const fillHello = new NativeFunction(cm.fill_hello, "int", ["pointer", "int", "int"]);
      // the rest of the buffer isn't written: decoded with `len`, it would show up
      const buffer = Memory.allocUtf8String("xxxxxxxxxxxxxxx");

      await untilHooked(
        () => fillHello(buffer, 16, 0),
        () => events.length > 0,
      );
      events.length = 0;
      try {
        fillHello(buffer, 16, 0);
        fillHello(buffer, 16, 1);
      } finally {
        manager.unregisterHooks([hook]);
      }

      expect(events.map((event) => [event.argsOut, event.returnValue!.value])).toEqual([
        [[{ type: "void *", name: "buf", value: "hello" }], 5],
        // a negative length, e.g. -1 for an error, decodes as null
        [[{ type: "void *", name: "buf", value: null }], -1],
      ]);
    });

    it("doesn't record the calls that hook code makes, also the code of a Java hook", async () => {
      const events: NativeHookEvent[] = [];
      const agent = { addEventToLog: (event: NativeHookEvent) => events.push(event) } as unknown as FrookyAgent;
      const addOne = new NativeFunction(cm.add_one, "int", ["int"]);
      // stands in for a decoder or a stack trace that calls the hooked function
      const reentrantStackTrace: PlatformStackTrace = {
        build: () => ({ platformStackTrace: [`inner ${addOne(100)}`], nativeStackTrace: [] }),
      };
      const manager = new NativeHookManager(reentrantStackTrace, agent);
      const params = normalizeInputParams([["int", "n"]], DEFAULT_DECODER_SETTINGS);
      const [hooks] = await resultsOf(
        await manager.resolveHooks([nativeHook("libc.so", "atoi", { params, hookSettings: { ...DEFAULT_HOOK_SETTINGS, platformStackTrace: true } })]),
      );
      const hook: NativeHook = { ...hooks![0], symbolName: "add_one", symbolAddress: cm.add_one };

      manager.registerHooks([hook]);
      try {
        await untilHooked(
          () => addOne(0),
          () => events.length > 0,
        );
        events.length = 0;
        expect(addOne(1)).toBe(2);
        const tid = enterHookCode();
        try {
          expect(addOne(2)).toBe(3);
        } finally {
          leaveHookCode(tid!);
        }
      } finally {
        manager.unregisterHooks([hook]);
      }

      expect(events.map((event) => [event.argsIn![0].value, event.stackTrace!.platformStackTrace[0]])).toEqual([[1, "inner 101"]]);
    });

    describe("several hooks on the same function", () => {
      // each hook names its param differently, so an event tells which hook recorded it
      async function setup(...paramNames: (string | [string, InputParamSettings])[]) {
        const events: NativeHookEvent[] = [];
        const agent = { addEventToLog: (event: NativeHookEvent) => events.push(event) } as unknown as FrookyAgent;
        const manager = new NativeHookManager(stackTrace, agent);
        const retType = normalizeInputRetType("int", DEFAULT_DECODER_SETTINGS);
        const resolved = await resultsOf(
          await manager.resolveHooks(
            paramNames.map((param) => {
              const [name, settings] = typeof param === "string" ? [param, {}] : param;
              const params = normalizeInputParams([["int", name, settings]], DEFAULT_DECODER_SETTINGS);
              return nativeHook("libc.so", "atoi", { params, retType });
            }),
          ),
        );
        const hooks: NativeHook[] = resolved.map((hooks) => ({ ...hooks![0], symbolName: "add_one", symbolAddress: cm.add_one }));
        const addOne = new NativeFunction(cm.add_one, "int", ["int"]);
        const recordedBy = () => events.map((event) => event.argsIn![0].name).sort();
        return { manager, hooks, events, addOne, recordedBy };
      }

      it("records one event per hook for each call", async () => {
        const { manager, hooks, events, addOne, recordedBy } = await setup("first", "second");

        expect(manager.registerHooks(hooks)).toBe(2);
        try {
          await untilHooked(
            () => addOne(0),
            () => new Set(recordedBy()).size === 2,
          );
          events.length = 0;
          expect(addOne(41)).toBe(42);
        } finally {
          manager.unregisterHooks(hooks);
        }

        expect(recordedBy()).toEqual(["first", "second"]);
        expect(events.map((event) => [event.argsIn![0].value, event.returnValue!.value])).toEqual([
          [41, 42],
          [41, 42],
        ]);
      });

      it("keeps recording with the remaining hook when one of them is unregistered", async () => {
        const { manager, hooks, events, addOne, recordedBy } = await setup("first", "second");
        const [first, second] = hooks;

        manager.registerHooks([first]);
        manager.registerHooks([second]);
        try {
          await untilHooked(
            () => addOne(0),
            () => new Set(recordedBy()).size === 2,
          );
          manager.unregisterHooks([first]);
          events.length = 0;
          addOne(1);
        } finally {
          manager.unregisterHooks([first, second]);
        }

        expect(recordedBy()).toEqual(["second"]);
        expect(first.listener).toBeUndefined();
      });

      for (const [removed, remaining] of [
        ["A", ["B", "C"]],
        ["B", ["A", "C"]],
        ["C", ["A", "B"]],
      ] as const) {
        it(`keeps recording with the other hooks when hook ${removed} of A, B and C is unregistered`, async () => {
          const { manager, hooks, events, addOne, recordedBy } = await setup("A", "B", "C");
          const byName = { A: hooks[0], B: hooks[1], C: hooks[2] };

          manager.registerHooks(hooks);
          try {
            await untilHooked(
              () => addOne(0),
              () => new Set(recordedBy()).size === 3,
            );
            manager.unregisterHooks([byName[removed]]);
            events.length = 0;
            expect(addOne(1)).toBe(2);
          } finally {
            manager.unregisterHooks(hooks);
          }

          expect(recordedBy()).toEqual([...remaining]);
          expect(byName[removed].listener).toBeUndefined();
        });
      }

      it("hooks the function again after every hook was unregistered", async () => {
        const { manager, hooks, events, addOne, recordedBy } = await setup("first", "second");
        const [first, second] = hooks;
        manager.registerHooks([first]);
        manager.unregisterHooks([first]);

        manager.registerHooks([second]);
        try {
          await untilHooked(
            () => addOne(0),
            () => events.length > 0,
          );
          events.length = 0;
          addOne(1);
        } finally {
          manager.unregisterHooks([second]);
        }

        expect(recordedBy()).toEqual(["second"]);
      });

      it("records nothing once every hook is unregistered", async () => {
        const { manager, hooks, events, addOne, recordedBy } = await setup("first", "second");

        manager.registerHooks(hooks);
        await untilHooked(
          () => addOne(0),
          () => new Set(recordedBy()).size === 2,
        );
        manager.unregisterHooks(hooks);
        events.length = 0;
        expect(addOne(1)).toBe(2);

        expect(events.length).toBe(0);
      });

      it("records the same address and hashCode, the function's, from every hook", async () => {
        const events: NativeHookEvent[] = [];
        const agent = { addEventToLog: (event: NativeHookEvent) => events.push(event) } as unknown as FrookyAgent;
        const manager = new NativeHookManager(stackTrace, agent);
        const resolved = await resultsOf(await manager.resolveHooks([nativeHook("libc.so", "atoi"), nativeHook("libc.so", "atoi")]));
        const [first, second]: NativeHook[] = resolved.map((hooks) => ({
          ...hooks![0],
          symbolName: "add_one",
          symbolAddress: cm.add_one,
        }));
        const addOne = new NativeFunction(cm.add_one, "int", ["int"]);

        manager.registerHooks([first, second]);
        try {
          await untilHooked(
            () => addOne(0),
            () => events.length >= 2,
          );
          events.length = 0;
          addOne(1);
        } finally {
          manager.unregisterHooks([first, second]);
        }

        expect(events.map((event) => event.address)).toEqual([cm.add_one.toString(), cm.add_one.toString()]);
        expect(events.map((event) => event.hashCode)).toEqual([addressHashCode(cm.add_one), addressHashCode(cm.add_one)]);
      });

      it("records with the other hooks when one hook's filter does not match", async () => {
        const { manager, hooks, events, addOne, recordedBy } = await setup(["filtered", { argFilter: ["^0$"] }], "unfiltered");

        manager.registerHooks(hooks);
        try {
          await untilHooked(
            () => addOne(0),
            () => new Set(recordedBy()).size === 2,
          );
          events.length = 0;
          addOne(1);
        } finally {
          manager.unregisterHooks(hooks);
        }

        expect(recordedBy()).toEqual(["unfiltered"]);
      });
    });
  });
});

export {};
