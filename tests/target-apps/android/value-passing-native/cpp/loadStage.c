#define NOINLINE __attribute__((noinline))
#define EXPORT __attribute__((visibility("default")))

// Called by libloadTime.so while it loads: `stage` is "constructor" or "JNI_OnLoad". The app loads this library
// before libloadTime.so, so a hook on it is installed before these calls.
NOINLINE EXPORT const char *report_load_stage(const char *stage) { return stage; }
