#include <jni.h>

#define NOINLINE __attribute__((noinline))
#define EXPORT __attribute__((visibility("default")))

// in libloadStage.so
const char *report_load_stage(const char *stage);

// The last stage reported, e.g. "constructor" once the constructor has run. Exported, so a module observer can read
// whether it runs before or after the constructor. Also keeps report_load_stage() from being a tail call, so the
// caller shows up in stack traces.
EXPORT volatile const char *load_time_last_stage;

// Called by the constructor, which runs inside dlopen() while the linker holds its lock. Exported, so stack traces
// name it.
NOINLINE EXPORT void load_time_constructor(void) { load_time_last_stage = report_load_stage("constructor"); }

__attribute__((constructor)) static void run_constructor(void) { load_time_constructor(); }

// runs after dlopen() has returned
JNIEXPORT jint JNI_OnLoad(JavaVM *vm, void *reserved)
{
    (void)vm;
    (void)reserved;
    load_time_last_stage = report_load_stage("JNI_OnLoad");
    return JNI_VERSION_1_6;
}
