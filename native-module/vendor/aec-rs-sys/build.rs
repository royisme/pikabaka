fn main() {
    println!("cargo:rerun-if-changed=libspeexdsp");
    println!("cargo:rerun-if-changed=include");
    cc::Build::new()
        .std("c11")
        .files([
            "libspeexdsp/mdf.c",
            "libspeexdsp/fftwrap.c",
            "libspeexdsp/kiss_fft.c",
            "libspeexdsp/kiss_fftr.c",
        ])
        .include("include")
        .include("libspeexdsp")
        .define("FLOATING_POINT", "1")
        .define("USE_KISS_FFT", "1")
        .define("EXPORT", "")
        .define("_USE_MATH_DEFINES", "1")
        .warnings(false)
        .compile("speexdsp");
}
