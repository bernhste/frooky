#include <jni.h>
#include <stdio.h>
#include <stdbool.h>
#include <fcntl.h>
#include <unistd.h>
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/mman.h>
#include <sys/socket.h>

#define NOINLINE __attribute__((noinline))
#define EXPORT __attribute__((visibility("default")))

/* ---------- receive by value ---------- */
NOINLINE EXPORT bool receive_bool(bool minValue, bool maxValue) { return minValue; }
NOINLINE EXPORT char receive_char(char minValue, char maxValue) { return minValue; }
NOINLINE EXPORT signed char receive_schar(signed char minValue, signed char maxValue) { return minValue; }
NOINLINE EXPORT unsigned char receive_uchar(unsigned char minValue, unsigned char maxValue) { return minValue; }
NOINLINE EXPORT short receive_short(short minValue, short maxValue) { return minValue; }
NOINLINE EXPORT unsigned short receive_ushort(unsigned short minValue, unsigned short maxValue) { return minValue; }
NOINLINE EXPORT int receive_int(int minValue, int maxValue) { return minValue; }
NOINLINE EXPORT unsigned int receive_uint(unsigned int minValue, unsigned int maxValue) { return minValue; }
NOINLINE EXPORT long receive_long(long minValue, long maxValue) { return minValue; }
NOINLINE EXPORT unsigned long receive_ulong(unsigned long minValue, unsigned long maxValue) { return minValue; }
NOINLINE EXPORT long long receive_llong(long long minValue, long long maxValue) { return minValue; }
NOINLINE EXPORT unsigned long long receive_ullong(unsigned long long minValue, unsigned long long maxValue) { return minValue; }
NOINLINE EXPORT float receive_float(float minValue, float maxValue) { return minValue; }
NOINLINE EXPORT double receive_double(double minValue, double maxValue) { return minValue; }
NOINLINE EXPORT long double receive_ldouble(long double minValue, long double maxValue) { return minValue; }

/* ---------- receive by value: mixed argument register classes ---------- */
/* int and float/double arguments are passed in entirely separate CPU register files (see
 * frooky/agent/src/native/hook/nativeFloatArgs.ts) with independent counters, so interleaving
 * them exercises that a hooking tool tracks each parameter's *class-relative* index rather than
 * its raw position in the parameter list. */
NOINLINE EXPORT double receive_interleaved_types(int intArg1, double doubleArg1, int intArg2, float floatArg1, int intArg3, double doubleArg2)
{
    return doubleArg1;
}

/* more int arguments than fit in the general-purpose argument registers of any Android target
 * (6 on SysV x86-64, 8 on AAPCS64), so the tail of these spill onto the stack. */
NOINLINE EXPORT int receive_many_ints(int a, int b, int c, int d, int e, int f, int g, int h, int i, int j) { return a; }

/* ---------- file descriptors, flags and enums ---------- */
// Like open(2), returns the fd.
NOINLINE EXPORT int open_log(const char *path, int flags) { return open(path, flags, 0600); }

// Like socket(2), returns the fd.
NOINLINE EXPORT int open_socket(int domain, int type) { return socket(domain, type, 0); }

// Like write(2): writes `len` bytes of `buf` to `fd`.
NOINLINE EXPORT int write_log(int fd, const void *buf, int len) { return (int)write(fd, buf, (size_t)len); }

enum log_level
{
    LOG_LEVEL_DEBUG = 3,
    LOG_LEVEL_INFO = 4,
    LOG_LEVEL_WARN = 5
};
NOINLINE EXPORT int set_log_level(enum log_level level) { return (int)level; }

#define PERMISSION_READ 0x1
#define PERMISSION_WRITE 0x2
#define PERMISSION_SHARE 0x4
NOINLINE EXPORT unsigned int set_permissions(unsigned int permissions) { return permissions; }

// Like mmap(2): maps one page with `prot` and `flags`, then unmaps it.
NOINLINE EXPORT int map_page(int prot, int flags)
{
    void *page = mmap(NULL, 4096, prot, flags, -1, 0);
    if (page == MAP_FAILED)
        return -1;
    return munmap(page, 4096);
}

static void use_file_descriptors(void)
{
    int file = open_log("/dev/null", O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC);
    write_log(file, "started", 7);
    close(file);

    // UDP needs no listener: connect() only sets the peer address
    int sock = open_socket(AF_INET, SOCK_DGRAM | SOCK_CLOEXEC);
    struct sockaddr_in peer = {.sin_family = AF_INET, .sin_port = htons(9), .sin_addr = {.s_addr = htonl(INADDR_LOOPBACK)}};
    connect(sock, (struct sockaddr *)&peer, sizeof(peer));
    write_log(sock, "ping", 4);
    close(sock);

    set_log_level(LOG_LEVEL_WARN);
    // 0x100 has no name
    set_permissions(PERMISSION_READ | PERMISSION_SHARE | 0x100);
    map_page(PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS);
}

JNIEXPORT jstring JNICALL
Java_org_owasp_mastestapp_MastgTest_receiveFundamentalValueJNI(JNIEnv *env, jobject thiz)
{
    (void)thiz;

    receive_bool(false, true);
    receive_char('A', 'Z');
    receive_schar(-128, 127);
    receive_uchar(0, 255);
    receive_short(-32768, 32767);
    receive_ushort(0, 65535);
    receive_int(-2147483648, 2147483647);
    receive_uint(0u, 4294967295u);
    receive_long(-2147483648L, 2147483647L);
    receive_ulong(0UL, 4294967295UL);
    receive_llong(-9223372036854775807LL, 9223372036854775807LL);
    receive_ullong(0ULL, 18446744073709551615ULL);
    receive_float(-3.4028235e38f, 3.4028235e38f);
    receive_double(-1.7976931348623157e308, 1.7976931348623157e308);
    receive_ldouble(-1.18973149535723176e4932L, 1.18973149535723176e4932L);
    receive_interleaved_types(11, 2.5, 22, 3.5f, 33, 4.5);
    receive_many_ints(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
    use_file_descriptors();

    return (*env)->NewStringUTF(env, "Called functions with primitives received by value (e.g. void receive_int(int minValue, int maxValue)).");
}
