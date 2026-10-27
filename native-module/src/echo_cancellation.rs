//! Internal, DSP-thread-only speaker reference and SpeexDSP microphone cleaning.
use std::collections::VecDeque;
use std::ptr::NonNull;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use aec_rs_sys::*;
use once_cell::sync::Lazy;

// shortcut: fixed tap/microphone latency compensation; calibrate on real devices
// before adding a delay estimator. A leading reference keeps the filter causal
// even when the system tap arrives later than the microphone.
const REFERENCE_LEAD: Duration = Duration::from_millis(40);
pub const MICROPHONE_LOOKAHEAD_MS: usize = 60;
const FILTER_MS: usize = 250;
const REFERENCE_TIMEOUT: Duration = Duration::from_millis(100);
const HISTORY: Duration = Duration::from_secs(1);

static REFERENCE: Lazy<Mutex<EchoReference>> = Lazy::new(|| Mutex::new(EchoReference::default()));

pub fn sample_duration(samples: usize, rate: u32) -> Duration {
    Duration::from_secs_f64(samples as f64 / rate as f64)
}

/// Count samples between observations instead of timestamping every DSP poll.
/// This avoids turning 5ms scheduler jitter into a changing acoustic path.
#[derive(Default)]
pub struct CaptureClock(Option<Instant>);

impl CaptureClock {
    pub fn observe(&mut self, buffered: usize, incoming: usize, rate: u32, now: Instant) -> bool {
        let discontinuity = self.0.is_none_or(|start| {
            now.saturating_duration_since(start + sample_duration(buffered + incoming, rate))
                > REFERENCE_TIMEOUT
        });
        if discontinuity {
            self.0 = Some(now - sample_duration(buffered + incoming, rate));
        }
        discontinuity
    }

    pub fn take_frame(&mut self, samples: usize, rate: u32) -> Instant {
        let start = self.0.expect("observe audio before taking a frame");
        self.0 = Some(start + sample_duration(samples, rate));
        start
    }
}

struct ReferenceFrame {
    start: Instant,
    rate: u32,
    samples: Vec<i16>,
}

#[derive(Default)]
struct EchoReference {
    generation: u64,
    running: bool,
    last_arrival: Option<Instant>,
    frames: VecDeque<ReferenceFrame>,
}

impl EchoReference {
    fn recent(&self, now: Instant) -> bool {
        self.running
            && self
                .last_arrival
                .is_some_and(|last| now.saturating_duration_since(last) < REFERENCE_TIMEOUT)
    }

    fn push(&mut self, frame: ReferenceFrame, now: Instant) {
        self.last_arrival = Some(now);
        self.frames.push_back(frame);
        while self
            .frames
            .front()
            .is_some_and(|f| now.saturating_duration_since(f.start) > HISTORY)
        {
            self.frames.pop_front();
        }
    }

    fn read(&self, start: Instant, rate: u32, output: &mut [i16], now: Instant) -> bool {
        if !self.recent(now) {
            return false;
        }
        let mut frames = self.frames.iter().peekable();
        for (i, sample) in output.iter_mut().enumerate() {
            let at = start + sample_duration(i, rate);
            while frames
                .peek()
                .is_some_and(|f| at >= f.start + sample_duration(f.samples.len(), f.rate))
            {
                frames.next();
            }
            let Some(frame) = frames.peek() else {
                return false;
            };
            if at < frame.start {
                return false; // Never substitute stale samples across a gap.
            }
            let pos = at.duration_since(frame.start).as_secs_f64() * frame.rate as f64;
            let index = (pos as usize).min(frame.samples.len() - 1);
            let next = (index + 1).min(frame.samples.len() - 1);
            let fraction = pos - index as f64;
            *sample = (frame.samples[index] as f64 * (1.0 - fraction)
                + frame.samples[next] as f64 * fraction) as i16;
        }
        true
    }
}

/// Lifetime is the system DSP thread, including early exits and restarts.
pub struct ReferenceWriter(u64);

impl ReferenceWriter {
    pub fn new() -> Self {
        let mut reference = REFERENCE.lock().unwrap();
        reference.generation += 1;
        reference.running = true;
        reference.last_arrival = None;
        reference.frames.clear();
        Self(reference.generation)
    }

    pub fn publish(&self, samples: &[i16], rate: u32, start: Instant) {
        // Do not wait for the microphone or change system audio's buffering.
        if let Ok(mut reference) = REFERENCE.try_lock() {
            if reference.generation == self.0 {
                reference.push(
                    ReferenceFrame {
                        start,
                        rate,
                        samples: samples.to_vec(),
                    },
                    Instant::now(),
                );
            }
        }
    }
}

impl Drop for ReferenceWriter {
    fn drop(&mut self) {
        let mut reference = REFERENCE.lock().unwrap();
        if reference.generation == self.0 {
            reference.running = false;
            reference.last_arrival = None;
            reference.frames.clear();
        }
    }
}

pub fn reference_is_recent(now: Instant) -> bool {
    REFERENCE
        .try_lock()
        .is_ok_and(|reference| reference.recent(now))
}

struct SpeexEcho {
    state: NonNull<SpeexEchoState>,
    frame_size: usize,
}

impl SpeexEcho {
    fn new(rate: u32, frame_size: usize) -> Self {
        // The state lives and is used/destroyed on exactly one microphone DSP thread.
        let state = NonNull::new(unsafe {
            speex_echo_state_init(frame_size as i32, (rate as usize * FILTER_MS / 1000) as i32)
        })
        .expect("SpeexDSP echo state allocation failed");
        let mut sample_rate = rate as i32;
        let result = unsafe {
            speex_echo_ctl(
                state.as_ptr(),
                SPEEX_ECHO_SET_SAMPLING_RATE,
                (&mut sample_rate as *mut i32).cast(),
            )
        };
        assert_eq!(result, 0);
        Self { state, frame_size }
    }

    fn reset(&mut self) {
        unsafe { speex_echo_state_reset(self.state.as_ptr()) };
    }

    fn cancel(&mut self, mic: &[i16], reference: &[i16], output: &mut [i16]) {
        assert_eq!(mic.len(), self.frame_size);
        assert_eq!(reference.len(), self.frame_size);
        assert_eq!(output.len(), self.frame_size);
        // Separate, fully initialized frame-sized slices; no preprocessing/AGC
        // that could suppress near-end speech during double-talk.
        unsafe {
            speex_echo_cancellation(
                self.state.as_ptr(),
                mic.as_ptr(),
                reference.as_ptr(),
                output.as_mut_ptr(),
            );
        }
    }
}

impl Drop for SpeexEcho {
    fn drop(&mut self) {
        unsafe { speex_echo_state_destroy(self.state.as_ptr()) };
    }
}

pub struct MicrophoneEchoCanceller {
    echo: SpeexEcho,
    rate: u32,
    reference: Vec<i16>,
    output: Vec<i16>,
    generation: Option<u64>,
    last_signal: Option<Instant>,
}

impl MicrophoneEchoCanceller {
    pub fn new(rate: u32, frame_size: usize) -> Self {
        Self {
            echo: SpeexEcho::new(rate, frame_size),
            rate,
            reference: vec![0; frame_size],
            output: vec![0; frame_size],
            generation: None,
            last_signal: None,
        }
    }

    pub fn process(&mut self, mic: &mut [i16], start: Instant) {
        let generation = REFERENCE.try_lock().ok().and_then(|reference| {
            reference
                .read(
                    start + REFERENCE_LEAD,
                    self.rate,
                    &mut self.reference,
                    Instant::now(),
                )
                .then_some(reference.generation)
        });
        self.clean(mic, start, generation);
    }

    fn clean(&mut self, mic: &mut [i16], start: Instant, generation: Option<u64>) {
        if self.generation != generation {
            self.echo.reset();
            self.last_signal = None;
            self.generation = generation;
        }
        if generation.is_none() {
            return; // Bit-exact passthrough without a complete, fresh reference.
        }
        if self.reference.iter().any(|&sample| sample != 0) {
            self.last_signal = Some(start);
        }
        // Feed zeros through the echo tail, then bypass in genuine silence.
        if self.last_signal.is_none_or(|last| {
            start.saturating_duration_since(last) > Duration::from_millis(FILTER_MS as u64)
        }) {
            return;
        }
        self.echo.cancel(mic, &self.reference, &mut self.output);
        mic.copy_from_slice(&self.output);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::TAU;

    #[test]
    fn delayed_noise_echo_is_removed_and_near_end_tone_survives() {
        // Exercise both a conventional speech rate and the production hardware rate.
        for rate in [16_000, 48_000, 44_100] {
            let frame_size = rate as usize / 50;
            let mut cleaner = MicrophoneEchoCanceller::new(rate, frame_size);
            let count = rate as usize * 8;
            let delay = rate as usize * 7 / 1000;
            let mut rng = 123456789_u32;
            let far: Vec<i16> = (0..count)
                .map(|i| {
                    rng ^= rng << 13;
                    rng ^= rng >> 17;
                    rng ^= rng << 5;
                    if i < rate as usize * 7 {
                        (rng as i32 % 10000) as i16
                    } else {
                        0
                    }
                })
                .collect();
            let near: Vec<i16> = (0..count)
                .map(|i| {
                    if (rate as usize * 6..rate as usize * 13 / 2).contains(&i) {
                        (3000.0 * (TAU * 700.0 * i as f64 / rate as f64).sin()) as i16
                    } else {
                        0
                    }
                })
                .collect();
            let raw: Vec<i16> = (0..count)
                .map(|i| {
                    let echo = if i >= delay {
                        far[i - delay] as f64 * 0.55
                    } else {
                        0.0
                    };
                    (echo + near[i] as f64) as i16
                })
                .collect();
            let mut cleaned = raw.clone();
            let start = Instant::now();
            let tap_latency = Duration::from_millis(25);
            let mut reference = EchoReference {
                running: true,
                generation: 1,
                ..EchoReference::default()
            };
            let mut published = 0;
            for offset in (0..count).step_by(frame_size) {
                let mic_start = start + sample_duration(offset, rate);
                let now = mic_start
                    + sample_duration(frame_size, rate)
                    + Duration::from_millis(MICROPHONE_LOOKAHEAD_MS as u64);
                // Simulate a system tap arriving 25ms later than the microphone,
                // drained in frames while the microphone waits only its fixed lookahead.
                while start + tap_latency + sample_duration(published + frame_size, rate) <= now {
                    reference.push(
                        ReferenceFrame {
                            start: start + tap_latency + sample_duration(published, rate),
                            rate,
                            samples: (published..published + frame_size)
                                .map(|i| far.get(i).copied().unwrap_or(0))
                                .collect(),
                        },
                        now,
                    );
                    published += frame_size;
                }
                assert!(reference.read(
                    mic_start + REFERENCE_LEAD,
                    rate,
                    &mut cleaner.reference,
                    now
                ));
                cleaner.clean(
                    &mut cleaned[offset..offset + frame_size],
                    mic_start,
                    Some(1),
                );
            }
            let energy = |samples: &[i16]| samples.iter().map(|&v| (v as f64).powi(2)).sum::<f64>();
            let echo_only = rate as usize * 4..rate as usize * 6;
            let erle =
                10.0 * (energy(&raw[echo_only.clone()]) / energy(&cleaned[echo_only])).log10();
            // Project onto the known near-end tone during double-talk; residual
            // far-end noise must not count as preserved near-end energy.
            let tone = rate as usize * 6..rate as usize * 13 / 2;
            let input_energy = energy(&near[tone.clone()]);
            let projection = cleaned[tone.clone()]
                .iter()
                .zip(&near[tone])
                .map(|(&out, &input)| out as f64 * input as f64)
                .sum::<f64>()
                / input_energy;
            let near_db = 20.0 * projection.abs().log10();
            eprintln!("AEC {rate}Hz: ERLE={erle:.2} dB, near-end tone={near_db:.2} dB");
            assert!(erle >= 15.0, "echo-only ERLE: {erle:.2} dB");
            assert!(
                near_db.abs() <= 3.0,
                "near-end tone change: {near_db:.2} dB"
            );
        }
    }

    #[test]
    fn missing_stale_silent_and_restarted_reference_pass_through() {
        let start = Instant::now();
        let mut cleaner = MicrophoneEchoCanceller::new(16000, 320);
        let raw = [1234; 320];
        for generation in [None, Some(1), Some(2), None] {
            let mut mic = raw;
            cleaner.clean(&mut mic, start, generation);
            assert_eq!(mic, raw);
        }
        // Losing the reference after cancellation has actually run must also
        // bypass bit-for-bit, rather than emitting the previous filter's tail.
        cleaner.reference.fill(5000);
        let mut mic = raw;
        cleaner.clean(&mut mic, start, Some(3));
        assert_eq!(cleaner.last_signal, Some(start));
        mic = raw;
        cleaner.clean(&mut mic, start, None);
        assert_eq!(mic, raw);
        assert_eq!(cleaner.last_signal, None);
        cleaner.reference.fill(0);
        cleaner.clean(&mut mic, start, Some(4));
        assert_eq!(mic, raw);

        let mut reference = EchoReference {
            running: true,
            ..EchoReference::default()
        };
        reference.push(
            ReferenceFrame {
                start,
                rate: 16000,
                samples: vec![1; 320],
            },
            start,
        );
        let mut out = [0; 320];
        assert!(reference.read(start, 16000, &mut out, start));
        assert!(!reference.read(start, 16000, &mut out, start + REFERENCE_TIMEOUT));
        reference.running = false;
        assert!(!reference.read(start, 16000, &mut out, start));
    }

    #[test]
    fn reference_alignment_resampling_and_gaps() {
        let start = Instant::now();
        let mut reference = EchoReference {
            running: true,
            ..EchoReference::default()
        };
        for block in 0..10 {
            reference.push(
                ReferenceFrame {
                    start: start + Duration::from_millis(block * 20),
                    rate: 48000,
                    samples: (0..960)
                        .map(|i| (block as usize * 960 + i) as i16)
                        .collect(),
                },
                start + Duration::from_millis(block * 20),
            );
        }
        let mut out = [0; 320];
        assert!(reference.read(
            start + REFERENCE_LEAD,
            16000,
            &mut out,
            start + Duration::from_millis(200)
        ));
        for (i, sample) in out.iter().enumerate() {
            assert!((*sample - (1920 + i * 3) as i16).abs() <= 1);
        }
        reference.frames.remove(3);
        assert!(!reference.read(
            start + Duration::from_millis(55),
            16000,
            &mut out,
            start + Duration::from_millis(200)
        ));
    }

    #[test]
    fn writer_stop_restart_and_contention_do_not_reuse_old_audio() {
        let writer = ReferenceWriter::new();
        assert!(!reference_is_recent(Instant::now()));
        writer.publish(&[5; 960], 48000, Instant::now());
        assert!(reference_is_recent(Instant::now()));
        {
            let reference = REFERENCE.lock().unwrap();
            // Publishing is nonblocking, including when a microphone owns the lock.
            writer.publish(&[6; 960], 48000, Instant::now());
            assert_eq!(reference.frames.len(), 1);
        }
        let generation = writer.0;
        drop(writer);
        assert!(!reference_is_recent(Instant::now()));
        assert!(REFERENCE.lock().unwrap().frames.is_empty());
        let restarted = ReferenceWriter::new();
        assert_ne!(restarted.0, generation);
        assert!(!reference_is_recent(Instant::now()));
        let mut mic = [1234; 960];
        MicrophoneEchoCanceller::new(48000, 960).process(&mut mic, Instant::now());
        assert_eq!(mic, [1234; 960]);
    }

    #[test]
    fn capture_clock_ignores_poll_jitter_and_reanchors_after_stall() {
        let now = Instant::now();
        let mut clock = CaptureClock::default();
        assert!(clock.observe(0, 960, 48000, now));
        assert_eq!(
            clock.take_frame(960, 48000),
            now - Duration::from_millis(20)
        );
        assert!(!clock.observe(0, 960, 48000, now + Duration::from_millis(24)));
        assert_eq!(clock.take_frame(960, 48000), now);
        assert!(clock.observe(0, 960, 48000, now + Duration::from_secs(1)));
        assert_eq!(
            clock.take_frame(960, 48000),
            now + Duration::from_millis(980)
        );
    }
}
