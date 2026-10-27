//! Echo-only bindings to the bundled SpeexDSP C implementation.
use std::ffi::{c_int, c_void};

#[repr(C)]
pub struct SpeexEchoState {
    _private: [u8; 0],
}

pub const SPEEX_ECHO_SET_SAMPLING_RATE: c_int = 24;

extern "C" {
    pub fn speex_echo_state_init(frame_size: c_int, filter_length: c_int) -> *mut SpeexEchoState;
    pub fn speex_echo_state_destroy(state: *mut SpeexEchoState);
    pub fn speex_echo_state_reset(state: *mut SpeexEchoState);
    pub fn speex_echo_ctl(state: *mut SpeexEchoState, request: c_int, ptr: *mut c_void) -> c_int;
    pub fn speex_echo_cancellation(
        state: *mut SpeexEchoState,
        rec: *const i16,
        play: *const i16,
        out: *mut i16,
    );
}
