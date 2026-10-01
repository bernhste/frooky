import { enterHookCode, leaveHookCode } from "./hookCodeGuard";

describe("hookCodeGuard", () => {
  it("lets a thread enter hook code once until it leaves", () => {
    const tid = enterHookCode();
    try {
      expect(tid).toBe(Process.getCurrentThreadId());
      expect(enterHookCode()).toBeUndefined();
    } finally {
      leaveHookCode(tid!);
    }

    const again = enterHookCode();
    expect(again).toBe(Process.getCurrentThreadId());
    leaveHookCode(again!);
  });
});

export {};
