import { isJsThread, JS_THREAD_POLL_MS, setTimeoutOnJsThread } from "./jsThread";
import { sleepMilliseconds } from "./utils";

// runs `fn` on a new thread and waits for it
function runOnNewThread(fn: () => void): void {
  const libc = Process.getModuleByName("libc.so");
  const cm = new CModule(
    `
    extern int pthread_create(void *, const void *, void *(*)(void *), void *);
    extern int pthread_join(unsigned long, void **);
    void run(void *(*fn)(void *)) {
      unsigned long thread;
      if (pthread_create(&thread, 0, fn, 0) == 0) pthread_join(thread, 0);
    }
    `,
    { pthread_create: libc.getExportByName("pthread_create"), pthread_join: libc.getExportByName("pthread_join") },
  );
  const onThread = new NativeCallback(
    () => {
      fn();
      return ptr(0);
    },
    "pointer",
    ["pointer"],
  );
  new NativeFunction(cm.run, "void", ["pointer"])(onThread);
}

describe("jsThread", () => {
  it("tells the JS thread from other threads", () => {
    let onOtherThread: boolean | undefined;
    runOnNewThread(() => (onOtherThread = isJsThread()));

    expect(isJsThread()).toBe(true);
    expect(onOtherThread).toBe(false);
  });

  describe("setTimeoutOnJsThread()", () => {
    it("runs the callback after the delay when called on the JS thread", async () => {
      let ran = false;
      setTimeoutOnJsThread(() => (ran = true), 30);

      expect(ran).toBe(false);
      await sleepMilliseconds(100);
      expect(ran).toBe(true);
    });

    it("runs the callback on the JS thread when called on another thread", async () => {
      let ranOnJsThread: boolean | undefined;
      runOnNewThread(() => setTimeoutOnJsThread(() => (ranOnJsThread = isJsThread()), 0));

      for (let i = 0; i < 50 && ranOnJsThread === undefined; i++) await sleepMilliseconds(JS_THREAD_POLL_MS);
      expect(ranOnJsThread).toBe(true);
    });
  });
});

export {};
