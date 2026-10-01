#include <jni.h>
#include <stdio.h>
#include <stdbool.h>

#define NOINLINE __attribute__((noinline))
#define EXPORT __attribute__((visibility("default")))

/* ---------- receive by reference ---------- */
NOINLINE EXPORT bool *receive_bool_ref(bool *minValue, bool *maxValue) { return minValue; }
NOINLINE EXPORT char *receive_char_ref(char *minValue, char *maxValue) { return minValue; }
NOINLINE EXPORT signed char *receive_schar_ref(signed char *minValue, signed char *maxValue) { return minValue; }
NOINLINE EXPORT unsigned char *receive_uchar_ref(unsigned char *minValue, unsigned char *maxValue) { return minValue; }
NOINLINE EXPORT short *receive_short_ref(short *minValue, short *maxValue) { return minValue; }
NOINLINE EXPORT unsigned short *receive_ushort_ref(unsigned short *minValue, unsigned short *maxValue) { return minValue; }
NOINLINE EXPORT int *receive_int_ref(int *minValue, int *maxValue) { return minValue; }
NOINLINE EXPORT unsigned int *receive_uint_ref(unsigned int *minValue, unsigned int *maxValue) { return minValue; }
NOINLINE EXPORT long *receive_long_ref(long *minValue, long *maxValue) { return minValue; }
NOINLINE EXPORT unsigned long *receive_ulong_ref(unsigned long *minValue, unsigned long *maxValue) { return minValue; }
NOINLINE EXPORT long long *receive_llong_ref(long long *minValue, long long *maxValue) { return minValue; }
NOINLINE EXPORT unsigned long long *receive_ullong_ref(unsigned long long *minValue, unsigned long long *maxValue) { return minValue; }
NOINLINE EXPORT float *receive_float_ref(float *minValue, float *maxValue) { return minValue; }
NOINLINE EXPORT double *receive_double_ref(double *minValue, double *maxValue) { return minValue; }
NOINLINE EXPORT long double *receive_ldouble_ref(long double *minValue, long double *maxValue) { return minValue; }
NOINLINE EXPORT unsigned char *receive_byte_array(unsigned char *data, int length)
{
    for (int i = 0; i < length; i++)
    {
        data[i] = data[i] ^ 0xFF;
    }
    return data;
}
NOINLINE EXPORT unsigned char *reverse_byte_array(unsigned char *data, int length)
{
    for (int i = 0, j = length - 1; i < j; i++, j--)
    {
        unsigned char tmp = data[i];
        data[i] = data[j];
        data[j] = tmp;
    }
    return data;
}

// Output parameter: copies a NUL-terminated secret into `out`.
NOINLINE EXPORT int get_secret(char *out, int out_len)
{
    const char secret[] = "s3cr3t";
    if (out_len < (int)sizeof(secret))
        return -1;
    for (int i = 0; i < (int)sizeof(secret); i++)
        out[i] = secret[i];
    return (int)sizeof(secret) - 1;
}

// A buffer of `len` bytes without a terminator, like write(2).
NOINLINE EXPORT int send_message(const void *buf, int len)
{
    (void)buf;
    return len;
}

// Like read(2): writes up to `len` bytes into `buf` and returns how many it wrote.
NOINLINE EXPORT int read_message(char *buf, int len)
{
    const char message[] = "Hello frooky";
    int n = (int)sizeof(message) - 1;
    if (n > len)
        n = len;
    for (int i = 0; i < n; i++)
        buf[i] = message[i];
    return n;
}

// An array of `count` ints.
NOINLINE EXPORT int sum_ints(const int *values, int count)
{
    int sum = 0;
    for (int i = 0; i < count; i++)
        sum += values[i];
    return sum;
}

// An array of `count` strings, like the argv of main().
NOINLINE EXPORT int count_chars(const char **strings, int count)
{
    int total = 0;
    for (int i = 0; i < count; i++)
        for (const char *c = strings[i]; *c; c++)
            total++;
    return total;
}

// A NULL-terminated array of strings, like the argv of execve(2).
NOINLINE EXPORT int count_args(char *const argv[])
{
    int count = 0;
    while (argv[count])
        count++;
    return count;
}

// Output parameter: points `*out` to a string, like getline(3) or asprintf(3) do.
NOINLINE EXPORT int get_version(const char **out)
{
    *out = "1.2.3";
    return 0;
}

JNIEXPORT jstring JNICALL
Java_org_owasp_mastestapp_MastgTest_receiveFundamentalReferenceJNI(JNIEnv *env, jobject thiz)
{
    (void)thiz;

    bool minBool = false, maxBool = true;
    char minChar = 'A', maxChar = 'Z';
    signed char minSc = -128, maxSc = 127;
    unsigned char minUc = 0, maxUc = 255;
    short minS = -32768, maxS = 32767;
    unsigned short minUs = 0, maxUs = 65535;
    int minI = -2147483648, maxI = 2147483647;
    unsigned int minUi = 0u, maxUi = 4294967295u;
    long minL = -2147483648L, maxL = 2147483647L;
    unsigned long minUl = 0UL, maxUl = 4294967295UL;
    long long minLl = -9223372036854775807LL, maxLl = 9223372036854775807LL;
    unsigned long long minUll = 0ULL, maxUll = 18446744073709551615ULL;
    float minF = -3.4028235e38f, maxF = 3.4028235e38f;
    double minD = -1.7976931348623157e308, maxD = 1.7976931348623157e308;
    long double minLd = -1.18973149535723176e4932L, maxLd = 1.18973149535723176e4932L;
    unsigned char data[] = {0x48, 0x65, 0x6C, 0x6C, 0x6F};
    unsigned char welcome[] = "Welcome OWASP MASCon";

    receive_bool_ref(&minBool, &maxBool);
    receive_char_ref(&minChar, &maxChar);
    receive_schar_ref(&minSc, &maxSc);
    receive_uchar_ref(&minUc, &maxUc);
    receive_short_ref(&minS, &maxS);
    receive_ushort_ref(&minUs, &maxUs);
    receive_int_ref(&minI, &maxI);
    receive_uint_ref(&minUi, &maxUi);
    receive_long_ref(&minL, &maxL);
    receive_ulong_ref(&minUl, &maxUl);
    receive_llong_ref(&minLl, &maxLl);
    receive_ullong_ref(&minUll, &maxUll);
    receive_float_ref(&minF, &maxF);
    receive_double_ref(&minD, &maxD);
    receive_ldouble_ref(&minLd, &maxLd);
    receive_byte_array(data, 5);
    reverse_byte_array(welcome, (int)(sizeof(welcome) - 1));

    char secret[16];
    get_secret(secret, (int)sizeof(secret));
    const char message[] = "Hello frooky";
    send_message(message, (int)(sizeof(message) - 1));

    // the bytes after the message aren't written by read_message
    char inbox[32];
    for (int i = 0; i < (int)sizeof(inbox); i++)
        inbox[i] = '-';
    read_message(inbox, (int)sizeof(inbox));

    int values[] = {3, 1, 4, 1, 5};
    sum_ints(values, 5);
    const char *names[] = {"alpha", "beta", "gamma"};
    count_chars(names, 3);
    char *const argv[] = {"ls", "-l", "/sdcard", NULL};
    count_args(argv);
    const char *version = NULL;
    get_version(&version);

    return (*env)->NewStringUTF(env, "Called functions with primitives received by reference (e.g. void receive_int(int *minValue, int *maxValue)).");
}
