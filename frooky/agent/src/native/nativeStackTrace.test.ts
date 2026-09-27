import { sleepMilliseconds } from "../shared/utils";
import { nativeStackFrames } from "./nativeStackTrace";

// kept alive for the whole file: the Interceptor may still touch a function after detach()
const cm = new CModule("int identity (int n) { return n; }");

// Interceptor changes are only committed once no thread runs a JS callback, which can take a moment
// while the app keeps hitting other hooks (e.g. frida-java-bridge's), so call until the hook fires
async function untilHooked(call: () => void, fired: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !fired(); i++) {
    call();
    if (!fired()) await sleepMilliseconds(10);
  }
}

// calls a native function twice and returns the frames captured inside its hook
async function framesInNativeHook(limit: number): Promise<string[][]> {
  const results: string[][] = [];
  const listener = Interceptor.attach(cm.identity, {
    onEnter() {
      results.push(nativeStackFrames(this.context, limit));
    },
  });
  try {
    const identity = new NativeFunction(cm.identity, "int", ["int"]);
    await untilHooked(
      () => identity(0),
      () => results.length > 0,
    );
    results.length = 0;
    identity(1);
    identity(2);
  } finally {
    listener.detach();
  }
  return results;
}

// one hook for the whole file: attaching to the same function again after a detach can take a long
// time to be committed
describe("nativeStackFrames()", () => {
  it("captures at most limit frames, formatted as 'symbol (module:address)', the same for repeated calls from the same site", async () => {
    const [first, second] = await framesInNativeHook(2);
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThan(3);
    for (const frame of first) expect(/ \(.*:0x[0-9a-f]+\)$/.test(frame)).toBeTruthy();
    expect(second).toEqual(first);
  });
});

export {};
