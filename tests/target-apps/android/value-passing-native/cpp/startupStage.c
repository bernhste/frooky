#include <jni.h>
#include <stdlib.h>

#define NOINLINE __attribute__((noinline))
#define EXPORT __attribute__((visibility("default")))

// Built once per startup stage (see CMakeLists.txt), with STAGE "factory", "application" or "provider". The app loads
// each library at that stage of its startup (MastgTest.kt), so its constructor and JNI_OnLoad run there.

// Keeps the calls below from being tail calls, so their callers show up in stack traces.
static volatile const char *last_result;

// Called while the library loads: `step` is "constructor" or "JNI_OnLoad".
NOINLINE EXPORT const char *startup_step(const char *stage, const char *step)
{
    (void)stage;
    return step;
}

// Runs inside dlopen(), while the linker holds its lock. Exported, so stack traces name it. getenv() is a call into
// libc, which is loaded long before this library.
__attribute__((constructor)) EXPORT void startup_constructor(void)
{
    last_result = getenv("FROOKY_STARTUP_" STAGE);
    last_result = startup_step(STAGE, "constructor");
}

// runs after dlopen() has returned
JNIEXPORT jint JNI_OnLoad(JavaVM *vm, void *reserved)
{
    (void)vm;
    (void)reserved;
    last_result = getenv("FROOKY_STARTUP_" STAGE);
    last_result = startup_step(STAGE, "JNI_OnLoad");
    return JNI_VERSION_1_6;
}
