# Value Passing Native

The app implements a native c library which passes various native values to functions which in turn return the same value again.

For the examples in `docs/examples/native/`, the libraries also have:

- `get_secret`, which writes into an output buffer, and `send_message`, which takes a buffer without a terminator
- `track_event`, called both directly by the JNI method and through `sdk_flush`, for stack traces and stack trace filters
- `read_status`, which opens `/proc/self/status` through libc
- `count_args`, which takes a NULL-terminated `argv`
- `open_log`, `open_socket` and `write_log`, which open `/dev/null` and a UDP socket and write to both, for file descriptors and `open`/`socket` flags
- `report_load_stage` in `libloadStage.so`, called from `libloadTime.so`'s constructor and from its `JNI_OnLoad` while it loads. The app loads `libloadStage.so` first, so a hook on it is installed before these calls
- `set_log_level`, `set_permissions` and `map_page`, which take an enum, a bitmask and `mmap` flags
