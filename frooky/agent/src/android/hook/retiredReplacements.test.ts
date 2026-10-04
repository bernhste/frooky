import Java from "frida-java-bridge";
import { sleepMilliseconds } from "../../shared/utils";
import { countCalls, ReplacementCalls, RetiredReplacements } from "./retiredReplacements";

const IDLE_MS = 50;

// a static method that is neither native nor an intrinsic
function toBinaryString(): Java.Method {
  return Java.use("java.lang.Integer").toBinaryString.overload("int");
}

// hooks `method` with a replacement that counts its calls in the returned ReplacementCalls
function hook(method: Java.Method): ReplacementCalls {
  const calls: ReplacementCalls = { inFlight: 0, finished: 0 };
  method.implementation = countCalls(calls, function (value: number): string {
    return method.call(this, value);
  });
  return calls;
}

describe("countCalls()", () => {
  it("counts a call as in flight while it runs and as finished once it returns or throws", () => {
    const calls: ReplacementCalls = { inFlight: 0, finished: 0 };
    let inFlightDuringCall = -1;
    const implementation = countCalls(calls, function (fail: boolean) {
      inFlightDuringCall = calls.inFlight;
      if (fail) throw new Error("fails");
      return "returned";
    });

    expect(implementation.call(null as unknown as Java.Wrapper, false)).toBe("returned");
    expect(() => implementation.call(null as unknown as Java.Wrapper, true)).toThrow("fails");

    expect(inFlightDuringCall).toBe(1);
    expect(calls).toEqual({ inFlight: 0, finished: 2 });
  });
});

describe("RetiredReplacements", () => {
  it("reverts the method and releases its replacement once no call has been in it for idleMs", async () => {
    const retired = new RetiredReplacements(IDLE_MS);
    const method = toBinaryString();
    const calls = hook(method);
    expect(Java.use("java.lang.Integer").toBinaryString(5)).toBe("101");

    retired.revert(method, calls);

    expect(method.implementation).toBeNull();
    expect(retired.size).toBe(1);
    await sleepMilliseconds(IDLE_MS * 4);
    expect(retired.size).toBe(0);
  });

  it("keeps a replacement while a call is in it", async () => {
    const retired = new RetiredReplacements(IDLE_MS);
    const method = toBinaryString();
    const calls = hook(method);
    // a thread still inside the replacement, e.g. blocked in the original method
    calls.inFlight++;

    retired.revert(method, calls);
    await sleepMilliseconds(IDLE_MS * 4);
    expect(retired.size).toBe(1);

    calls.inFlight--;
    calls.finished++;
    await sleepMilliseconds(IDLE_MS * 4);
    expect(retired.size).toBe(0);
  });

  it("keeps a replacement while calls keep finishing in it", async () => {
    const retired = new RetiredReplacements(IDLE_MS);
    const method = toBinaryString();
    const calls = hook(method);

    retired.revert(method, calls);
    // threads that ART routed to the replacement before the revert, finishing one after another
    const finishing = setInterval(() => calls.finished++, IDLE_MS / 5);
    try {
      await sleepMilliseconds(IDLE_MS * 4);
      expect(retired.size).toBe(1);
    } finally {
      clearInterval(finishing);
    }
    await sleepMilliseconds(IDLE_MS * 4);
    expect(retired.size).toBe(0);
  });
});
