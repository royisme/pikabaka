// Voice Activity Detection - UI ONLY
//
// IMPORTANT: This VAD is for UI state display only.
// It does NOT gate or delay audio sent to Google STT.
// 
// The silence_suppression module handles audio gating.
// This module is for:
// - Showing "speaking" indicator in UI
// - Detecting utterance boundaries
// - Optional stream management (not used currently)

use std::time::{SystemTime, UNIX_EPOCH};

use crate::audio_config::{VAD_START_RMS, VAD_END_RMS, VAD_HANGOVER_MS};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum VadState {
    Idle,
    Speech,
    Hangover,
}

/// Voice Activity Detector for UI indication
/// Does NOT gate audio - only reports state
pub struct VadIndicator {
    state: VadState,
    start_threshold: f32,
    end_threshold: f32,
    hangover_duration_ms: u128,
    hangover_start_time: u128,
    pub last_rms: f32,
}

impl VadIndicator {
    pub fn new() -> Self {
        Self {
            state: VadState::Idle,
            start_threshold: VAD_START_RMS,
            end_threshold: VAD_END_RMS,
            hangover_duration_ms: VAD_HANGOVER_MS,
            hangover_start_time: 0,
            last_rms: 0.0,
        }
    }

    /// Update VAD state based on audio chunk
    /// Returns current state for UI display
    /// DOES NOT affect audio flow to STT
    pub fn update(&mut self, chunk: &[i16]) -> VadState {
        let rms = self.calculate_rms(chunk);
        self.last_rms = rms;
        let now = self.current_time_ms();

        match self.state {
            VadState::Idle => {
                if rms > self.start_threshold {
                    self.state = VadState::Speech;
                    println!("[VAD-UI] Speech detected (RMS: {})", rms as i32);
                }
            }
            VadState::Speech => {
                if rms < self.end_threshold {
                    self.state = VadState::Hangover;
                    self.hangover_start_time = now;
                }
            }
            VadState::Hangover => {
                if rms > self.start_threshold {
                    self.state = VadState::Speech;
                } else {
                    let time_in_hangover = now - self.hangover_start_time;
                    if time_in_hangover > self.hangover_duration_ms {
                        self.state = VadState::Idle;
                        println!("[VAD-UI] Speech ended");
                    }
                }
            }
        }

        self.state
    }

    /// Check if currently in speech state (for UI)
    pub fn is_speech(&self) -> bool {
        matches!(self.state, VadState::Speech | VadState::Hangover)
    }

    pub fn reset(&mut self) {
        self.state = VadState::Idle;
    }

    fn calculate_rms(&self, data: &[i16]) -> f32 {
        if data.is_empty() {
            return 0.0;
        }

        let step = 10;
        let mut sum: f32 = 0.0;
        let mut count = 0;
        
        let mut i = 0;
        while i < data.len() {
            let sample = data[i] as f32;
            sum += sample * sample;
            count += 1;
            i += step;
        }

        if count == 0 {
            return 0.0;
        }

        (sum / count as f32).sqrt()
    }

    fn current_time_ms(&self) -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    }
}

// Keep legacy VadGate for compatibility during migration
// This is the OLD interface that was used for gating
// NEW code should use SilenceSuppressor instead
pub type VadGate = VadIndicator;

impl VadGate {
    /// Legacy compatibility: process returns empty during silence
    /// WARNING: This is the OLD pattern that causes latency issues
    /// New code should use SilenceSuppressor directly
    pub fn process(&mut self, chunk: Vec<i16>) -> Vec<Vec<i16>> {
        let state = self.update(&chunk);
        match state {
            VadState::Speech | VadState::Hangover => vec![chunk],
            VadState::Idle => Vec::new(),
        }
    }
}
