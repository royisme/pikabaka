// Silence Suppression for Streaming STT - Low Latency Optimized
//
// ONE GATE: RMS volume against an adaptive threshold. The threshold follows the noise floor, the quietest frame
// of the last few seconds (speech never raises it, a steady hum does). There is no voice detector: the one that
// was here rejected quiet speech, sentence endings and soft consonants.
//
// DESIGN PRINCIPLES:
// 1. Google STT requires timing continuity - never send gaps
// 2. During silence, send keepalive frames every 100ms
// 3. During speech, send ALL frames immediately with NO delay
// 4. The send hangover keeps a pause inside a sentence in the audio; the speech-ended signal is separate and
//    shorter, so the speech service can close the turn quickly
//
// LATENCY BUDGET:
// - Speech onset: 0ms delay (immediate)
// - Speech ended: `speech_end_after` after the last loud frame

use std::collections::VecDeque;
use std::time::{Duration, Instant};

/// The noise floor is the quietest frame heard in the last FLOOR_WINDOW, taken from buckets of FLOOR_BUCKET. Speech
/// does not raise it (a speaker pauses between words) and a steady hum does, so the gate cannot stay open on noise.
const FLOOR_BUCKET: Duration = Duration::from_millis(100);
const FLOOR_BUCKETS: usize = 50;

/// Configuration for silence suppression
/// Optimized for low latency with adaptive threshold
pub struct SilenceSuppressionConfig {
    /// Initial RMS threshold for speech detection (i16 scale: 0-32767)
    /// Acts as starting value; adaptive tracking adjusts this over time.
    pub speech_threshold_rms: f32,

    /// Duration to continue sending full audio after speech ends
    /// This does NOT add latency - only affects when we switch to keepalives
    pub speech_hangover: Duration,

    /// Silence after the last loud frame that counts as the end of the speech (reported once, independent of the hangover)
    pub speech_end_after: Duration,

    /// How often to send a keepalive frame during silence
    pub silence_keepalive_interval: Duration,

    /// Multiplier above the noise floor to detect speech (default: 3.0)
    pub adaptive_multiplier: f32,

    /// Minimum floor for the adaptive threshold (prevents false triggers in dead silence)
    pub adaptive_min_floor: f32,


    /// Native sample rate of the audio being processed (e.g. 48000)
    /// Used to size the preroll and to turn sample counts into milliseconds.
    pub native_sample_rate: u32,

    /// How much audio from just before speech is sent with the first speech frame. The gate needs a
    /// frame or two to see speech, so without this the quiet start of a word (s, f, t) is lost.
    pub preroll: Duration,
}

impl Default for SilenceSuppressionConfig {
    fn default() -> Self {
        Self {
            speech_threshold_rms: 100.0,
            speech_hangover: Duration::from_millis(1200),
            speech_end_after: Duration::from_millis(1000),
            silence_keepalive_interval: Duration::from_millis(100),
            adaptive_multiplier: 3.0,
            adaptive_min_floor: 20.0,
            native_sample_rate: 48000,
            preroll: Duration::from_millis(0),
        }
    }
}

impl SilenceSuppressionConfig {
    /// Create config for system audio (very permissive - system audio is quieter)
    pub fn for_system_audio() -> Self {
        Self {
            speech_threshold_rms: 30.0,
            speech_hangover: Duration::from_millis(1200),
            speech_end_after: Duration::from_millis(1000),
            silence_keepalive_interval: Duration::from_millis(100),
            adaptive_multiplier: 3.0,
            adaptive_min_floor: 10.0,
            native_sample_rate: 48000,
            preroll: Duration::from_millis(300),
        }
    }

    /// Create config for microphone (standard)
    pub fn for_microphone() -> Self {
        Self {
            speech_threshold_rms: 100.0,
            speech_hangover: Duration::from_millis(1200),
            speech_end_after: Duration::from_millis(1000),
            silence_keepalive_interval: Duration::from_millis(100),
            adaptive_multiplier: 3.0,
            adaptive_min_floor: 20.0,
            native_sample_rate: 48000,
            preroll: Duration::from_millis(300),
        }
    }
}

/// Silence suppression state machine with an adaptive threshold
pub struct SilenceSuppressor {
    config: SilenceSuppressionConfig,
    state: SuppressionState,
    last_speech_time: Instant,
    last_keepalive_time: Instant,
    frames_sent: u64,
    frames_suppressed: u64,
    /// Lowest frame level of each finished FLOOR_BUCKET, over the last FLOOR_WINDOW
    floor_buckets: VecDeque<f32>,
    bucket_min: f32,
    bucket_started: Instant,
    /// Lowest and highest frame level seen, for the line logged at the end
    min_rms: f32,
    max_rms: f32,
    /// Current adaptive speech threshold
    adaptive_threshold: f32,
    /// A loud frame was heard and the speech-ended signal has not been reported yet
    end_pending: bool,
    /// The most recent audio that was not sent (config.preroll long)
    preroll: VecDeque<i16>,
    /// Numbers for the line logged when the suppressor is dropped (samples at the native rate)
    passed_samples: u64,
    suppressed_samples: u64,
    speech_starts: u64,
    speech_ends: u64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum SuppressionState {
    Active,     // Speech detected, send everything
    Hangover,   // Speech ended recently, still sending
    Suppressed, // Confirmed silence, send keepalives only
}

/// Result of processing a frame
#[derive(Debug, Clone)]
pub enum FrameAction {
    /// Send this frame to STT
    Send(Vec<i16>),
    /// Replace with silence keepalive frame
    SendSilence,
    /// Suppress this frame (timing maintained by keepalives)
    Suppress,
}

impl SilenceSuppressor {
    pub fn new(config: SilenceSuppressionConfig) -> Self {
        let now = Instant::now();
        let initial_threshold = config.speech_threshold_rms;

        println!(
            "[SilenceSuppressor] Created: threshold={} (adaptive), hangover={}ms, speech_end_after={}ms, \
             keepalive={}ms, preroll={}ms, native_rate={}Hz",
            config.speech_threshold_rms,
            config.speech_hangover.as_millis(),
            config.speech_end_after.as_millis(),
            config.silence_keepalive_interval.as_millis(),
            config.preroll.as_millis(),
            config.native_sample_rate,
        );

        Self {
            floor_buckets: VecDeque::new(),
            bucket_min: f32::MAX,
            bucket_started: now,
            min_rms: f32::MAX,
            max_rms: 0.0,
            adaptive_threshold: initial_threshold,
            config,
            state: SuppressionState::Active, // Start in active to not miss first words
            last_speech_time: now,
            last_keepalive_time: now,
            frames_sent: 0,
            frames_suppressed: 0,
            end_pending: false,
            preroll: VecDeque::new(),
            passed_samples: 0,
            suppressed_samples: 0,
            speech_starts: 0,
            speech_ends: 0,
        }
    }

    /// Process a frame and determine what to do with it.
    /// Returns (FrameAction, speech_just_ended)
    /// `speech_just_ended` is true once, `speech_end_after` after the last loud frame.
    /// CRITICAL: Speech frames are NEVER delayed.
    pub fn process(&mut self, frame: &[i16]) -> (FrameAction, bool) {
        let now = Instant::now();
        let rms = calculate_rms(frame);
        self.track_floor(now, rms);

        // ALWAYS check for speech first - immediate response
        if rms >= self.adaptive_threshold {
            let from_silence = self.state == SuppressionState::Suppressed;
            if from_silence {
                self.speech_starts += 1;
            }
            self.state = SuppressionState::Active;
            self.last_speech_time = now;
            self.frames_sent += 1;
            self.end_pending = true;
            let mut out = Vec::with_capacity(self.preroll.len() + frame.len());
            if from_silence {
                out.extend(self.preroll.drain(..));
            }
            out.extend_from_slice(frame);
            self.passed_samples += out.len() as u64;
            return (FrameAction::Send(out), false);
        }

        // Quiet frame: the end of the speech is reported once, whatever the send hangover is
        let speech_just_ended =
            self.end_pending && now.duration_since(self.last_speech_time) >= self.config.speech_end_after;
        if speech_just_ended {
            self.end_pending = false;
            self.speech_ends += 1;
        }

        match self.state {
            SuppressionState::Active | SuppressionState::Hangover => {
                if now.duration_since(self.last_speech_time) > self.config.speech_hangover {
                    self.state = SuppressionState::Suppressed;
                } else {
                    // Still in hangover - send full frame
                    self.state = SuppressionState::Hangover;
                    self.frames_sent += 1;
                    self.passed_samples += frame.len() as u64;
                    return (FrameAction::Send(frame.to_vec()), speech_just_ended);
                }
            }
            SuppressionState::Suppressed => {}
        }

        // Keep the latest unsent audio so the start of the next word can be sent with it
        let keep = (self.config.native_sample_rate as u64 * self.config.preroll.as_millis() as u64 / 1000) as usize;
        if keep > 0 {
            self.preroll.extend(frame.iter().copied());
            while self.preroll.len() > keep {
                self.preroll.pop_front();
            }
        }

        self.suppressed_samples += frame.len() as u64;

        // Check if time for keepalive
        if now.duration_since(self.last_keepalive_time) >= self.config.silence_keepalive_interval {
            self.last_keepalive_time = now;
            self.frames_sent += 1;
            (FrameAction::SendSilence, speech_just_ended)
        } else {
            self.frames_suppressed += 1;
            (FrameAction::Suppress, speech_just_ended)
        }
    }

    fn track_floor(&mut self, now: Instant, rms: f32) {
        self.min_rms = self.min_rms.min(rms);
        self.max_rms = self.max_rms.max(rms);
        self.bucket_min = self.bucket_min.min(rms);
        if now.duration_since(self.bucket_started) >= FLOOR_BUCKET {
            self.floor_buckets.push_back(self.bucket_min);
            if self.floor_buckets.len() > FLOOR_BUCKETS {
                self.floor_buckets.pop_front();
            }
            self.bucket_min = f32::MAX;
            self.bucket_started = now;
            let floor = self.floor_buckets.iter().copied().fold(f32::MAX, f32::min);
            self.adaptive_threshold = (floor * self.config.adaptive_multiplier).max(self.config.adaptive_min_floor);
        }
    }

    /// Get statistics
    pub fn stats(&self) -> (u64, u64) {
        (self.frames_sent, self.frames_suppressed)
    }

    /// Get current state for UI
    pub fn is_speech(&self) -> bool {
        matches!(
            self.state,
            SuppressionState::Active | SuppressionState::Hangover
        )
    }

    /// Get the current adaptive speech threshold
    pub fn adaptive_threshold(&self) -> f32 {
        self.adaptive_threshold
    }

    /// Reset state (e.g., when meeting ends)
    pub fn reset(&mut self) {
        let now = Instant::now();
        self.state = SuppressionState::Active;
        self.last_speech_time = now;
        self.last_keepalive_time = now;
        self.floor_buckets.clear();
        self.bucket_min = f32::MAX;
        self.adaptive_threshold = self.config.speech_threshold_rms;
        self.end_pending = false;
    }
}

impl Drop for SilenceSuppressor {
    fn drop(&mut self) {
        let ms = |samples: u64| samples * 1000 / self.config.native_sample_rate.max(1) as u64;
        println!(
            "[SilenceSuppressor] Finished: passed {} ms, suppressed {} ms, {} speech starts, {} speech ends, frame level {}-{}",
            ms(self.passed_samples),
            ms(self.suppressed_samples),
            self.speech_starts,
            self.speech_ends,
            if self.min_rms == f32::MAX { 0.0 } else { self.min_rms },
            self.max_rms,
        );
    }
}

/// Calculate RMS of i16 samples efficiently
fn calculate_rms(samples: &[i16]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }

    // Sample every 4th sample for speed (320/4 = 80 samples is plenty for RMS)
    let sum_of_squares: f64 = samples
        .iter()
        .step_by(4)
        .map(|&s| (s as f64) * (s as f64))
        .sum();

    let count = (samples.len() + 3) / 4;
    (sum_of_squares / count as f64).sqrt() as f32
}

/// Generate a silence frame of given size
pub fn generate_silence_frame(size: usize) -> Vec<i16> {
    vec![0i16; size]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_speech_immediate() {
        let mut suppressor = SilenceSuppressor::new(SilenceSuppressionConfig {
            native_sample_rate: 16000,
            ..SilenceSuppressionConfig::default()
        });

        // Loud frame should be sent immediately (high amplitude sine-ish wave)
        let loud_frame: Vec<i16> = (0..320)
            .map(|i| ((i as f32 * 0.1).sin() * 10000.0) as i16)
            .collect();
        let (action, ended) = suppressor.process(&loud_frame);
        assert!(matches!(action, FrameAction::Send(_)));
        assert!(!ended, "Speech should not have 'ended' on a loud frame");
        assert!(suppressor.is_speech());
    }

    #[test]
    fn test_silence_keepalive() {
        let mut suppressor = SilenceSuppressor::new(SilenceSuppressionConfig {
            speech_threshold_rms: 100.0,
            speech_hangover: Duration::from_millis(0),
            speech_end_after: Duration::from_millis(0),
            silence_keepalive_interval: Duration::from_millis(50),
            adaptive_multiplier: 3.0,
            adaptive_min_floor: 20.0,
            native_sample_rate: 16000,
            preroll: Duration::from_millis(0),
        });

        let silent_frame: Vec<i16> = vec![0; 320];
        let (action, _ended) = suppressor.process(&silent_frame);
        assert!(matches!(
            action,
            FrameAction::SendSilence | FrameAction::Suppress
        ));
    }

    #[test]
    fn test_speech_ended_detection() {
        let mut suppressor = SilenceSuppressor::new(SilenceSuppressionConfig {
            speech_threshold_rms: 100.0,
            speech_hangover: Duration::from_millis(0),
            speech_end_after: Duration::from_millis(0),
            silence_keepalive_interval: Duration::from_millis(50),
            adaptive_multiplier: 3.0,
            adaptive_min_floor: 20.0,
            native_sample_rate: 16000,
            preroll: Duration::from_millis(0),
        });

        // Send a loud speech-like frame
        let loud_frame: Vec<i16> = (0..320)
            .map(|i| ((i as f32 * 0.1).sin() * 10000.0) as i16)
            .collect();
        let (_, ended) = suppressor.process(&loud_frame);
        assert!(!ended, "Speech should not end on a loud frame");

        // Send a silent frame (should trigger speech_ended)
        let silent_frame: Vec<i16> = vec![0; 320];
        let (_, ended) = suppressor.process(&silent_frame);
        assert!(ended, "Speech should have ended on transition to silence");

        // Another silent frame should NOT trigger speech_ended again
        let (_, ended) = suppressor.process(&silent_frame);
        assert!(!ended, "Speech_ended should only fire once per transition");
    }

    #[test]
    fn test_preroll_is_sent_with_the_first_speech_frame() {
        let mut suppressor = SilenceSuppressor::new(SilenceSuppressionConfig {
            speech_hangover: Duration::from_millis(0),
            silence_keepalive_interval: Duration::from_millis(1000),
            native_sample_rate: 16000,
            preroll: Duration::from_millis(40),
            ..SilenceSuppressionConfig::default()
        });
        let loud: Vec<i16> = (0..320).map(|i| ((i as f32 * 0.1).sin() * 10000.0) as i16).collect();
        let quiet: Vec<i16> = vec![0; 320];
        suppressor.process(&loud);
        std::thread::sleep(Duration::from_millis(5));
        for _ in 0..4 {
            suppressor.process(&quiet);
        }
        match suppressor.process(&loud).0 {
            FrameAction::Send(data) => assert_eq!(data.len(), 320 + 640, "40ms of unsent audio goes first"),
            _ => panic!("speech must be sent"),
        }
    }

    #[test]
    fn test_pause_inside_hangover_is_sent_and_end_is_reported_early() {
        let mut suppressor = SilenceSuppressor::new(SilenceSuppressionConfig {
            speech_hangover: Duration::from_millis(1000),
            speech_end_after: Duration::from_millis(20),
            native_sample_rate: 16000,
            ..SilenceSuppressionConfig::default()
        });
        let loud: Vec<i16> = (0..320).map(|i| ((i as f32 * 0.1).sin() * 10000.0) as i16).collect();
        let quiet: Vec<i16> = vec![0; 320];
        suppressor.process(&loud);
        std::thread::sleep(Duration::from_millis(30));
        let (action, ended) = suppressor.process(&quiet);
        assert!(matches!(action, FrameAction::Send(_)), "a short pause is still sent");
        assert!(ended, "the end is reported after speech_end_after, before the hangover is over");
        let (_, ended) = suppressor.process(&quiet);
        assert!(!ended, "and only once");
    }

    #[test]
    fn test_speech_does_not_raise_the_threshold() {
        let mut suppressor = SilenceSuppressor::new(SilenceSuppressionConfig {
            speech_hangover: Duration::from_millis(0),
            native_sample_rate: 16000,
            ..SilenceSuppressionConfig::default()
        });
        let loud: Vec<i16> = (0..320).map(|i| ((i as f32 * 0.1).sin() * 10000.0) as i16).collect();
        let before = suppressor.adaptive_threshold();
        for _ in 0..200 {
            suppressor.process(&loud);
        }
        assert_eq!(suppressor.adaptive_threshold(), before);
    }

    #[test]
    fn test_steady_hum_does_not_keep_the_gate_open() {
        let mut suppressor = SilenceSuppressor::new(SilenceSuppressionConfig {
            speech_threshold_rms: 100.0,
            speech_hangover: Duration::from_millis(0),
            native_sample_rate: 16000,
            ..SilenceSuppressionConfig::default()
        });
        let hum: Vec<i16> = (0..320).map(|i| ((i as f32 * 0.1).sin() * 400.0) as i16).collect();
        for _ in 0..30 {
            suppressor.process(&hum);
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(suppressor.adaptive_threshold() > 400.0, "the threshold rises above a steady hum");
        let (action, _) = suppressor.process(&hum);
        assert!(!matches!(action, FrameAction::Send(_)), "the hum is no longer sent");
    }
}
