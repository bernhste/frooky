#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <jni.h>

#define NOINLINE __attribute__((noinline))
#define EXPORT __attribute__((visibility("default")))

const char *receive_cstring(const char *s) { return s; }

const char *receive_utf8(const char *s) { return s; }

NOINLINE EXPORT const char *track_event(const char *name) { return name; }

// Stands in for a third-party library that calls into the app, for stack trace filters.
NOINLINE EXPORT void sdk_flush(void) { track_event("sdk_flush"); }

// Opens a file through libc, for hooks on low-level functions such as open.
NOINLINE EXPORT int read_status(void)
{
    FILE *status = fopen("/proc/self/status", "r");
    if (status == NULL)
        return -1;
    int first = fgetc(status);
    fclose(status);
    return first;
}

JNIEXPORT jstring JNICALL
Java_org_owasp_mastestapp_MastgTest_receiveStringsJNI(JNIEnv *env, jobject thiz)
{
    receive_cstring("Welcome the first OWASP MASCon, CString!");
    receive_utf8("Welcome the first OWASP MASCon 📱❤️");
    track_event("button_click");
    sdk_flush();
    read_status();

    return (*env)->NewStringUTF(env, "Called functions which receive C-Sting, UTF-8-String and UTF-16-String.");
}
