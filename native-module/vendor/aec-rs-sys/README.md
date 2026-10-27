# Echo-only aec-rs-sys 1.0.0

SpeexDSP sources copied from the crates.io `aec-rs-sys`
1.0.0 archive (https://crates.io/crates/aec-rs-sys/1.0.0), which bundles SpeexDSP.
Only the echo canceller, portable KISS FFT and their required headers are retained.
Their BSD-3-Clause notices (including the KISS FFT notice) remain in each file.
Thirteen of the fifteen C/header files are byte-identical; only trailing blank
lines at EOF were removed from `kiss_fft.c` and `os_support.h` for git's
whitespace check. No C code changed.

Local changes: replace upstream's CMake/C++/bindgen build with `cc` (already in
Pika's dependency graph) and handwritten bindings to five stable `speex_echo_*`
functions. No system SpeexDSP, pkg-config, CMake, meson or libclang is needed by
this crate. Floating point / portable FFT is used on all targets, including
macOS arm64/x86_64 and Windows MSVC; only a C compiler is required beyond Rust.
The local Rust/build glue is MIT-licensed, like upstream aec-rs-sys; the C code
is BSD-3-Clause. See `LICENSE` and the retained source notices. Include these
notices when redistributing binaries.
