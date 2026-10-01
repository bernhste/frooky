#include <jni.h>

#define NOINLINE __attribute__((noinline))
#define EXPORT __attribute__((visibility("default")))

// Called while the library loads, before any of its JNI methods: `stage` is "constructor" or "JNI_OnLoad".
NOINLINE EXPORT const char *on_library_load(const char *stage) { return stage; }

__attribute__((constructor)) static void run_constructor(void) { on_library_load("constructor"); }

JNIEXPORT jint JNI_OnLoad(JavaVM *vm, void *reserved)
{
    (void)vm;
    (void)reserved;
    on_library_load("JNI_OnLoad");
    return JNI_VERSION_1_6;
}
