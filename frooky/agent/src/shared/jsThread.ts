// Frida's JS thread: the thread that loads the script, which also runs RPC calls and timers. Hook callbacks, module
// observer callbacks and, in a spawned app, the Java.perform() callback run on the app's threads.
const jsThreadId = Process.getCurrentThreadId();

// how often the JS thread picks up the timers that app threads asked for
export const JS_THREAD_POLL_MS = 20;

const queuedTimers: { callback: () => void; delayMs: number }[] = [];

export function isJsThread(): boolean {
  return Process.getCurrentThreadId() === jsThreadId;
}

// setTimeout() for code that can run on an app thread: there, the JS thread starts the timer, up to JS_THREAD_POLL_MS
// later. An app thread that calls setTimeout() itself makes Frida wake the JS thread with libc's write() on that app
// thread. A hook on write() that walks the Java stack inside this call waits for a lock of Frida's main loop forever,
// e.g. at targetReady, which hangs the app's start-up.
export function setTimeoutOnJsThread(callback: () => void, delayMs: number): void {
  if (isJsThread()) setTimeout(callback, delayMs);
  else queuedTimers.push({ callback, delayMs });
}

setInterval(() => {
  for (const { callback, delayMs } of queuedTimers.splice(0)) setTimeout(callback, delayMs);
}, JS_THREAD_POLL_MS);
