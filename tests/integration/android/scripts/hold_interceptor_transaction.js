// When libloadTime.so loads, starts a thread that stays in a hook callback of this script for 300ms. Frida keeps an
// Interceptor transaction open meanwhile, so hooks that frooky installs while the library loads are only committed
// if frooky waits for them, see NativeHookManager.waitUntilCommitted().
const libc = Process.getModuleByName("libc.so");
const cm = new CModule(
  `
  extern int pthread_create(void *, const void *, void *(*)(void *), void *);
  __attribute__((noinline)) int frooky_test_target(int n) { return n + 1; }
  static void *thread_main(void *arg) { frooky_test_target(1); return 0; }
  void start_thread(void) { unsigned long t; pthread_create(&t, 0, thread_main, 0); }
  `,
  { pthread_create: libc.getExportByName("pthread_create") },
);
// exclusive: keeps this script's JS lock, so the callback stays open
const usleep = new NativeFunction(
  libc.getExportByName("usleep"),
  "int",
  ["uint"],
  { scheduling: "exclusive" },
);
const startThread = new NativeFunction(cm.start_thread, "void", [], {
  scheduling: "exclusive",
});
Interceptor.attach(cm.frooky_test_target, {
  onEnter() {
    usleep(300000);
  },
});
Process.attachModuleObserver({
  onAdded(module) {
    if (module.name !== "libloadTime.so") return;
    startThread();
    // the new thread enters its hook callback before this observer returns and frooky's runs
    usleep(20000);
  },
});
globalThis.frookyTestModule = cm;
