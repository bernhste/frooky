// When libloadTime.so loads, starts a thread that calls libloadStage.so!report_load_stage("other-thread"). A frooky
// hook on it with nativeStackTrace then walks that thread's stack while the loading thread is inside the linker.
const libc = Process.getModuleByName("libc.so");
let cm = null;
Process.attachModuleObserver({
  onAdded(module) {
    if (module.name === "libloadStage.so") {
      // enumerateExports(), not getExportByName(), which makes the linker abort while it loads the module
      const reportLoadStage = module
        .enumerateExports()
        .find((e) => e.name === "report_load_stage").address;
      cm = new CModule(
        `
        extern int pthread_create(void *, const void *, void *(*)(void *), void *);
        extern const char *report_load_stage(const char *);
        static void *thread_main(void *arg) { report_load_stage("other-thread"); return 0; }
        void start_thread(void) { unsigned long t; pthread_create(&t, 0, thread_main, 0); }
        `,
        {
          pthread_create: libc.getExportByName("pthread_create"),
          report_load_stage: reportLoadStage,
        },
      );
    }
    if (module.name === "libloadTime.so" && cm)
      new NativeFunction(cm.start_thread, "void", [], {
        scheduling: "exclusive",
      })();
  },
});
