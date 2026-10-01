import { FrookyAgent } from "../../FrookyAgent";
import { Decoder } from "../decoders/baseDecoder";
import { Decodable, Param, RetType } from "../decoders/decodable";
import { DecodedValue } from "../decoders/decodedValue";
import { DecoderResolver } from "../decoders/decoderResolver";
import { DEFAULT_DECODER_SETTINGS } from "../defaultValues";
import { LogEvent } from "../event/logEvent";
import { logger } from "../logger";
import { PlatformStackTrace } from "../platformStackTrace";
import { FilterMismatchError } from "../utils";
import { Hook } from "./hook";
import { HookManager, ParamDecoder } from "./hookManager";

function createFakeFrookyAgent(targetReady: Promise<void> = Promise.resolve()): FrookyAgent {
  return { addEventToLog: (_event: LogEvent) => {}, targetReady } as unknown as FrookyAgent;
}

type TestValue = string;

class FakeDecoder extends Decoder<TestValue> {
  readonly decoderName = "FakeDecoder";

  constructor(
    decodable: Decodable,
    private readonly decodeFn: (value: TestValue, arg?: any) => DecodedValue = (value) => ({
      type: decodable.type,
      name: decodable.name,
      value,
    }),
  ) {
    super(decodable);
  }

  public decode(value: TestValue, arg?: any): DecodedValue {
    return this.decodeFn(value, arg);
  }
}

class FakeDecoderResolver implements DecoderResolver<TestValue> {
  public readonly resolveCalls: Decodable[] = [];

  constructor(private readonly makeDecoder: (decodable: Decodable) => Decoder<TestValue> = (decodable) => new FakeDecoder(decodable)) {}

  public resolveDecoder(decodable: Decodable): Decoder<TestValue> {
    this.resolveCalls.push(decodable);
    return this.makeDecoder(decodable);
  }
}

const fakeStackTrace: PlatformStackTrace = {
  build: () => ({ platformStackTrace: [], nativeStackTrace: [] }),
};

// exposes HookManager's protected members
class TestHookManager extends HookManager<unknown, Hook, TestValue> {
  public async resolveHooks(): Promise<Promise<Hook[] | null>[]> {
    return [];
  }

  public registerHooks(): number {
    return 0;
  }

  public unregisterHooks(): void {}

  public exposedPollUntilResolved<T>(fn: () => T | null, label: string, timeoutSeconds: number): Promise<T> {
    return this.pollUntilResolved(fn, label, timeoutSeconds);
  }

  public exposedResolveParamDecoders(params: Param[]): ParamDecoder<TestValue>[] {
    return this.resolveParamDecoders(params);
  }

  public exposedResolveRetTypeDecoder(retType: RetType): Decoder<TestValue> {
    return this.resolveRetTypeDecoder(retType);
  }

  public exposedMatchesFilter(decodedValue: DecodedValue, argFilter?: RegExp[]): boolean {
    return this.matchesFilter(decodedValue, argFilter);
  }

  public exposedDecodeArgs(args: TestValue[], paramDecoders: ParamDecoder<TestValue>[], target?: string, returnValue?: DecodedValue): DecodedValue[] {
    return this.decodeArgs(args, paramDecoders, target, returnValue);
  }
}

function createManager(
  resolver: DecoderResolver<TestValue> = new FakeDecoderResolver(),
  stackTrace: PlatformStackTrace = fakeStackTrace,
  frookyAgent: FrookyAgent = createFakeFrookyAgent(),
): TestHookManager {
  return new TestHookManager(resolver, stackTrace, frookyAgent);
}

function makeParam(overrides: Partial<Param> = {}): Param {
  return {
    type: "int",
    name: "arg0",
    direction: "in",
    settings: { ...DEFAULT_DECODER_SETTINGS },
    ...overrides,
  };
}

describe("HookManager", () => {
  describe("pollUntilResolved()", () => {
    it("throws when timeoutSeconds is negative", async () => {
      const manager = createManager();
      await expect(manager.exposedPollUntilResolved(() => null, "thing", -1)).rejects.toThrow("Timeout must not be less than 0.");
    });

    it("resolves immediately when fn() returns a non-null result on the first call", async () => {
      const manager = createManager();
      const result = await manager.exposedPollUntilResolved(() => "resolved-value", "thing", 5);
      expect(result).toBe("resolved-value");
    });

    it("throws a timeout error naming the label once the deadline passes without a result", async () => {
      const manager = createManager();
      await expect(manager.exposedPollUntilResolved(() => null, "my-label", 0)).rejects.toThrow(
        "my-label not found within 0 seconds. Skipping the hooks declared for it.",
      );
    });

    it("retries fn() until it returns a non-null result", async () => {
      const manager = createManager();
      let callCount = 0;

      const result = await manager.exposedPollUntilResolved(
        () => {
          callCount++;
          return callCount < 2 ? null : "resolved-on-retry";
        },
        "thing",
        5,
      );

      expect(result).toBe("resolved-on-retry");
      expect(callCount).toBe(2);
    });

    it("retries once the target is ready and only then starts the timeout", async () => {
      let markTargetReady!: () => void;
      const manager = createManager(undefined, undefined, createFakeFrookyAgent(new Promise<void>((resolve) => (markTargetReady = resolve))));
      let targetReady = false;
      let callCount = 0;

      // a timeout of 0 would fail right away if it started before the target was ready
      const resultPromise = manager.exposedPollUntilResolved(
        () => {
          callCount++;
          return targetReady ? "resolved-when-ready" : null;
        },
        "thing",
        0,
      );
      await new Promise((r) => setTimeout(r, 50));
      expect(callCount).toBe(1);

      targetReady = true;
      markTargetReady();

      expect(await resultPromise).toBe("resolved-when-ready");
      expect(callCount).toBe(2);
    });
  });

  describe("resolveParamDecoders()", () => {
    let warnSpy: Mock;

    beforeEach(() => {
      warnSpy = spyOn(logger, "warn");
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it("resolves a decoder for each param and carries argIndex/direction/name/argFilter through", () => {
      const manager = createManager();
      const params: Param[] = [
        makeParam({ name: "a", type: "int", direction: "in" }),
        makeParam({ name: "b", type: "string", direction: "out", settings: { ...DEFAULT_DECODER_SETTINGS, argFilter: ["^x"] } }),
      ];

      const result = manager.exposedResolveParamDecoders(params);

      expect(result.length).toBe(2);
      expect(result[0].argIndex).toBe(0);
      expect(result[0].direction).toBe("in");
      expect(result[0].name).toBe("a");
      expect(result[0].argFilter).toBeUndefined();
      expect(result[1].argIndex).toBe(1);
      expect(result[1].direction).toBe("out");
      expect(result[1].name).toBe("b");
      expect(result[1].argFilter).toEqual([/^x/]);
    });

    it("does not forward the 'direction' field to the decoder resolver", () => {
      const resolver = new FakeDecoderResolver();
      const manager = createManager(resolver);
      const params: Param[] = [makeParam({ name: "a", type: "int", direction: "out" })];

      manager.exposedResolveParamDecoders(params);

      expect(resolver.resolveCalls).toEqual([{ type: "int", name: "a", settings: DEFAULT_DECODER_SETTINGS }]);
    });

    it("resolves the decoder of a param a role names, with that param's own type and settings", () => {
      const resolver = new FakeDecoderResolver();
      const manager = createManager(resolver);
      // the buffer's custom decoder must not be applied to the length it references
      const bufferSettings = { ...DEFAULT_DECODER_SETTINGS, decoder: "string", decoderArgs: { length: "length" } };
      const lengthSettings = { ...DEFAULT_DECODER_SETTINGS, maxItems: 5 };
      const params: Param[] = [
        makeParam({ name: "length", type: "int", settings: lengthSettings }),
        makeParam({ name: "buffer", type: "pointer", settings: bufferSettings }),
      ];

      const result = manager.exposedResolveParamDecoders(params);

      expect(result.length).toBe(2);
      const source = result[1].decoderArgs!.length!;
      expect(source.kind).toBe("param");
      expect(source.kind === "param" && source.index).toBe(0);
      expect(resolver.resolveCalls[2]).toEqual({ type: "int", settings: lengthSettings });
    });

    it("resolves a number and the return value as sources of roles", () => {
      const manager = createManager();
      const settings = { ...DEFAULT_DECODER_SETTINGS, decoderArgs: { offset: 4, length: "$ret" } };
      const params: Param[] = [makeParam({ name: "buffer", type: "pointer", direction: "out", settings })];

      const [buffer] = manager.exposedResolveParamDecoders(params);

      expect(buffer.decoderArgs).toEqual({ offset: { kind: "number", value: 4 }, length: { kind: "returnValue" } });
    });

    it("returns an empty array for an empty params list", () => {
      const manager = createManager();
      expect(manager.exposedResolveParamDecoders([])).toEqual([]);
    });

    it("resolves a role when the param using it and other params are unnamed", () => {
      const manager = createManager();
      const bufferSettings = { ...DEFAULT_DECODER_SETTINGS, decoderArgs: { length: "count" } };
      // e.g. write(int, const void *, size_t count): only the referenced param needs a name
      const params: Param[] = [
        makeParam({ name: undefined, type: "int" }),
        makeParam({ name: undefined, type: "const void *", settings: bufferSettings }),
        makeParam({ name: "count", type: "size_t" }),
      ];

      const result = manager.exposedResolveParamDecoders(params);

      expect(result.length).toBe(3);
      const source = result[1].decoderArgs!.length!;
      expect(source.kind === "param" && source.index).toBe(2);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("resolveRetTypeDecoder()", () => {
    it("delegates to the decoder resolver for the given retType", () => {
      const resolver = new FakeDecoderResolver();
      const manager = createManager(resolver);
      const retType: RetType = { type: "int", settings: DEFAULT_DECODER_SETTINGS };

      const decoder = manager.exposedResolveRetTypeDecoder(retType);

      expect(resolver.resolveCalls).toEqual([retType]);
      expect(decoder).toBeDefined();
    });
  });

  describe("matchesFilter()", () => {
    it("returns true when no argFilter is given", () => {
      const manager = createManager();
      expect(manager.exposedMatchesFilter({ type: "int", value: 42 }, undefined)).toBeTruthy();
    });

    it("returns true when argFilter is an empty array", () => {
      const manager = createManager();
      expect(manager.exposedMatchesFilter({ type: "int", value: 42 }, [])).toBeTruthy();
    });

    it("returns true for non-string/non-number values regardless of the filter", () => {
      const manager = createManager();
      expect(manager.exposedMatchesFilter({ type: "object", value: { nested: true } }, [/^won't match$/])).toBeTruthy();
      expect(manager.exposedMatchesFilter({ type: "bool", value: true }, [/^won't match$/])).toBeTruthy();
      expect(manager.exposedMatchesFilter({ type: "null", value: null }, [/^won't match$/])).toBeTruthy();
    });

    it("returns true when the string value matches one of the filter patterns", () => {
      const manager = createManager();
      expect(manager.exposedMatchesFilter({ type: "string", value: "hello world" }, [/^nope$/, /^hello/])).toBeTruthy();
    });

    it("returns false when the string value matches none of the filter patterns", () => {
      const manager = createManager();
      expect(manager.exposedMatchesFilter({ type: "string", value: "hello world" }, [/^nope$/])).toBeFalsy();
    });

    it("stringifies a numeric value before testing it against the filter patterns", () => {
      const manager = createManager();
      expect(manager.exposedMatchesFilter({ type: "int", value: 42 }, [/^42$/])).toBeTruthy();
      expect(manager.exposedMatchesFilter({ type: "int", value: 42 }, [/^43$/])).toBeFalsy();
    });
  });

  describe("decodeArgs()", () => {
    it("decodes each arg with its paramDecoder and returns the decoded values in order", () => {
      const manager = createManager();
      const decoderA = new FakeDecoder({ type: "int", settings: DEFAULT_DECODER_SETTINGS }, (value) => ({ type: "int", value: `decoded-${value}` }));
      const decoderB = new FakeDecoder({ type: "string", settings: DEFAULT_DECODER_SETTINGS }, (value) => ({
        type: "string",
        value: `decoded-${value}`,
      }));
      const paramDecoders: ParamDecoder<TestValue>[] = [
        { decoder: decoderA, argIndex: 0, direction: "in", name: "a" },
        { decoder: decoderB, argIndex: 1, direction: "in", name: "b" },
      ];

      const result = manager.exposedDecodeArgs(["x", "y"], paramDecoders);

      expect(result).toEqual([
        { type: "int", value: "decoded-x" },
        { type: "string", value: "decoded-y" },
      ]);
    });

    it("returns an empty array when there are no paramDecoders", () => {
      const manager = createManager();
      expect(manager.exposedDecodeArgs([], [])).toEqual([]);
    });

    it("throws FilterMismatchError and stops processing once a decoded value fails its argFilter", () => {
      const manager = createManager();
      const decoderA = new FakeDecoder({ type: "string", settings: DEFAULT_DECODER_SETTINGS }, (value) => ({ type: "string", value }));
      let decoderBCalled = false;
      const decoderB = new FakeDecoder({ type: "string", settings: DEFAULT_DECODER_SETTINGS }, (value) => {
        decoderBCalled = true;
        return { type: "string", value };
      });
      const paramDecoders: ParamDecoder<TestValue>[] = [
        { decoder: decoderA, argIndex: 0, direction: "in", name: "a", argFilter: [/^nope$/] },
        { decoder: decoderB, argIndex: 1, direction: "in", name: "b" },
      ];

      expect(() => manager.exposedDecodeArgs(["mismatch", "y"], paramDecoders)).toThrow(new FilterMismatchError());
      expect(decoderBCalled).toBeFalsy();
    });

    it("passes the value of each role to the decoder: a decoded param, a number and the return value", () => {
      const manager = createManager();
      const lengthDecoder = new FakeDecoder({ type: "int", settings: DEFAULT_DECODER_SETTINGS }, (value) => ({
        type: "int",
        value: Number(value),
      }));
      let receivedArgs: unknown;
      const bufferDecoder = new FakeDecoder({ type: "pointer", settings: DEFAULT_DECODER_SETTINGS }, (value, args) => {
        receivedArgs = args;
        return { type: "pointer", value };
      });
      const paramDecoders: ParamDecoder<TestValue>[] = [
        { decoder: lengthDecoder, argIndex: 0, direction: "in", name: "length" },
        {
          decoder: bufferDecoder,
          argIndex: 1,
          direction: "in",
          name: "buffer",
          decoderArgs: { length: { kind: "param", name: "length", index: 0, decoder: lengthDecoder }, offset: { kind: "number", value: 2 } },
        },
      ];

      manager.exposedDecodeArgs(["4", "buf-ptr"], paramDecoders);
      expect(receivedArgs).toEqual({ length: 4, offset: 2 });

      paramDecoders[1].decoderArgs = { length: { kind: "returnValue" } };
      manager.exposedDecodeArgs(["4", "buf-ptr"], paramDecoders, "hook", { type: "int", value: 3 });
      expect(receivedArgs).toEqual({ length: 3 });
    });
  });
});
