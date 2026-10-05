#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <jni.h>
#include <uchar.h>
#include <unistd.h>

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

// A UTF-16 string of `len` code units without a terminator, like the `const jchar *` of JNI's GetStringChars.
NOINLINE EXPORT int receive_utf16(const char16_t *s, int len)
{
    (void)s;
    return len;
}

// A UTF-16 string that ends with a 0 code unit, like an ICU `const UChar *`.
NOINLINE EXPORT int receive_utf16_cstring(const char16_t *s)
{
    int length = 0;
    while (s[length])
        length++;
    return length;
}

// Base64 text of `len` bytes, like the input of OpenSSL's EVP_DecodeBlock. The text isn't terminated after `len`.
NOINLINE EXPORT int receive_base64(const char *encoded, int len)
{
    (void)encoded;
    return len;
}

// Like unlink(2): fails with ENOENT for a file that doesn't exist.
NOINLINE EXPORT int delete_cache(const char *path) { return unlink(path); }

JNIEXPORT jstring JNICALL
Java_org_owasp_mastestapp_MastgTest_receiveStringsJNI(JNIEnv *env, jobject thiz)
{
    receive_cstring("Welcome the first OWASP MASCon, CString!");
    receive_utf8("Welcome the first OWASP MASCon 📱❤️");
    track_event("button_click");
    sdk_flush();
    read_status();

    static const char16_t greeting[] = u"Grüezi";
    receive_utf16(greeting, (int)(sizeof(greeting) / sizeof(greeting[0])) - 1);
    receive_utf16_cstring(u"Hello UTF-16");
    delete_cache("/proc/self/frooky-missing-cache");
    // "Hello frooky", followed by bytes that aren't part of it, and 16 key bytes 0x00 to 0x0f
    receive_base64("SGVsbG8gZnJvb2t5|trailer", 16);
    receive_base64("AAECAwQFBgcICQoLDA0ODw==", 24);

    return (*env)->NewStringUTF(env, "Called functions which receive C-Sting, UTF-8-String and UTF-16-String.");
}
