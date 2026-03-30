import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
} from "remotion";

const COLORS = {
  bg: "#0f0f23",
  bgLight: "#1a1a3e",
  accent: "#6366f1",
  cyan: "#22d3ee",
  green: "#22c55e",
  orange: "#f59e0b",
  text: "#ffffff",
  textMuted: "#94a3b8",
  panel: "#1e1e3a",
  panelBorder: "#2e2e4a",
};

// ─── Scene 1: Opening ───────────────────────────────────────────────

const Opening: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoScale = spring({ frame, fps, config: { damping: 12, stiffness: 80 } });
  const titleOpacity = interpolate(frame, [30, 60], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const titleY = interpolate(frame, [30, 60], [30, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const subtitleOpacity = interpolate(frame, [50, 80], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse at 50% 40%, ${COLORS.bgLight} 0%, ${COLORS.bg} 70%)`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {/* Logo circle */}
      <div
        style={{
          width: 140,
          height: 140,
          borderRadius: 32,
          background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.cyan})`,
          transform: `scale(${logoScale})`,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          fontSize: 72,
          boxShadow: `0 0 60px ${COLORS.accent}44`,
        }}
      >
        <span role="img">⚡</span>
      </div>

      {/* Title */}
      <div
        style={{
          marginTop: 40,
          fontSize: 72,
          fontWeight: 800,
          color: COLORS.text,
          fontFamily: "SF Pro Display, -apple-system, sans-serif",
          opacity: titleOpacity,
          transform: `translateY(${titleY}px)`,
          letterSpacing: -1,
        }}
      >
        Pika
      </div>

      {/* Subtitle */}
      <div
        style={{
          marginTop: 16,
          fontSize: 28,
          color: COLORS.textMuted,
          fontFamily: "SF Pro Display, -apple-system, sans-serif",
          opacity: subtitleOpacity,
          letterSpacing: 2,
        }}
      >
        AI Interview Copilot & Meeting Assistant
      </div>

      {/* Feature pills */}
      <div style={{ display: "flex", gap: 16, marginTop: 40, opacity: subtitleOpacity }}>
        {["Real-time Transcription", "AI Answers", "Screenshot Analysis"].map((text, i) => {
          const pillOpacity = interpolate(frame, [60 + i * 8, 75 + i * 8], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          return (
            <div
              key={text}
              style={{
                padding: "10px 24px",
                borderRadius: 999,
                background: `${COLORS.accent}22`,
                border: `1px solid ${COLORS.accent}44`,
                color: COLORS.cyan,
                fontSize: 16,
                fontFamily: "SF Mono, monospace",
                opacity: pillOpacity,
              }}
            >
              {text}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ─── Scene 2: Real-time Transcription ───────────────────────────────

const transcriptLines = [
  { speaker: "Interviewer", text: "Can you explain how you would design a rate limiter?", color: COLORS.cyan },
  { speaker: "You", text: "Sure! I'd start with a sliding window approach...", color: COLORS.green },
  { speaker: "Interviewer", text: "What about distributed systems?", color: COLORS.cyan },
  { speaker: "You", text: "We could use Redis with a token bucket algorithm...", color: COLORS.green },
  { speaker: "Interviewer", text: "How would you handle edge cases?", color: COLORS.cyan },
];

const WaveBar: React.FC<{ height: number; delay: number; color: string }> = ({ height, delay, color }) => {
  const frame = useCurrentFrame();
  const wave = Math.sin((frame + delay * 5) * 0.15) * 0.5 + 0.5;
  const h = height * (0.3 + wave * 0.7);
  return (
    <div
      style={{
        width: 4,
        height: h,
        borderRadius: 2,
        background: color,
        opacity: 0.8,
      }}
    />
  );
};

const Transcription: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        background: COLORS.bg,
        padding: 60,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", opacity: titleOpacity }}>
        <div style={{ fontSize: 36, fontWeight: 700, color: COLORS.text, fontFamily: "SF Pro Display, sans-serif" }}>
          Live Transcription
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 16px",
            borderRadius: 999,
            background: `${COLORS.green}22`,
            border: `1px solid ${COLORS.green}44`,
          }}
        >
          <div style={{ width: 8, height: 8, borderRadius: 4, background: COLORS.green }} />
          <span style={{ color: COLORS.green, fontSize: 14, fontFamily: "SF Mono, monospace" }}>
            {"<500ms latency"}
          </span>
        </div>
      </div>

      {/* Audio waveform */}
      <div
        style={{
          marginTop: 30,
          display: "flex",
          alignItems: "center",
          gap: 20,
          opacity: titleOpacity,
        }}
      >
        <div style={{ color: COLORS.cyan, fontSize: 14, width: 100, fontFamily: "SF Mono, monospace" }}>
          Interviewer
        </div>
        <div style={{ display: "flex", gap: 3, alignItems: "center", height: 40 }}>
          {Array.from({ length: 40 }).map((_, i) => (
            <WaveBar key={`i-${i}`} height={40} delay={i} color={COLORS.cyan} />
          ))}
        </div>
      </div>
      <div
        style={{
          marginTop: 12,
          display: "flex",
          alignItems: "center",
          gap: 20,
          opacity: titleOpacity,
        }}
      >
        <div style={{ color: COLORS.green, fontSize: 14, width: 100, fontFamily: "SF Mono, monospace" }}>You</div>
        <div style={{ display: "flex", gap: 3, alignItems: "center", height: 40 }}>
          {Array.from({ length: 40 }).map((_, i) => (
            <WaveBar key={`y-${i}`} height={40} delay={i + 20} color={COLORS.green} />
          ))}
        </div>
      </div>

      {/* Transcript panel */}
      <div
        style={{
          marginTop: 40,
          flex: 1,
          background: COLORS.panel,
          borderRadius: 16,
          border: `1px solid ${COLORS.panelBorder}`,
          padding: 32,
          overflow: "hidden",
        }}
      >
        {transcriptLines.map((line, i) => {
          const lineStart = 30 + i * 45;
          const opacity = interpolate(frame, [lineStart, lineStart + 15], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const y = interpolate(frame, [lineStart, lineStart + 15], [20, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const charCount = Math.floor(
            interpolate(frame, [lineStart, lineStart + 40], [0, line.text.length], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })
          );

          return (
            <div
              key={i}
              style={{
                opacity,
                transform: `translateY(${y}px)`,
                marginBottom: 20,
                display: "flex",
                gap: 16,
              }}
            >
              <span
                style={{
                  color: line.color,
                  fontSize: 16,
                  fontWeight: 600,
                  width: 110,
                  flexShrink: 0,
                  fontFamily: "SF Mono, monospace",
                }}
              >
                {line.speaker}
              </span>
              <span style={{ color: COLORS.text, fontSize: 18, fontFamily: "SF Pro Display, sans-serif" }}>
                {line.text.slice(0, charCount)}
                {charCount < line.text.length && (
                  <span style={{ opacity: Math.sin(frame * 0.3) > 0 ? 1 : 0, color: COLORS.accent }}>|</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

// ─── Scene 3: AI Answer Suggestions ─────────────────────────────────

const aiAnswer = `A rate limiter controls request frequency. Here's a recommended approach:

1. **Sliding Window Counter** — Track requests in time buckets
2. **Token Bucket** — For burst tolerance with steady rate
3. **Redis Backend** — For distributed consistency

Time Complexity: O(1) per request
Space Complexity: O(n) where n = unique users`;

const providers = ["OpenAI", "Claude", "Gemini", "Groq", "Ollama"];

const AISuggestions: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const panelSlide = interpolate(frame, [0, 25], [600, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const panelOpacity = interpolate(frame, [0, 25], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const charCount = Math.floor(
    interpolate(frame, [30, 200], [0, aiAnswer.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
  );

  const activeProvider = Math.floor(
    interpolate(frame, [220, 280], [0, providers.length - 0.01], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
  );

  const shortcutPulse = Math.sin(frame * 0.1) * 0.3 + 0.7;

  return (
    <AbsoluteFill style={{ background: COLORS.bg, display: "flex" }}>
      {/* Left: Mini transcript */}
      <div style={{ width: "45%", padding: 50, display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 20, color: COLORS.textMuted, marginBottom: 24, fontFamily: "SF Mono, monospace" }}>
          Transcript
        </div>
        <div
          style={{
            flex: 1,
            background: COLORS.panel,
            borderRadius: 12,
            border: `1px solid ${COLORS.panelBorder}`,
            padding: 24,
          }}
        >
          {transcriptLines.slice(0, 3).map((line, i) => (
            <div key={i} style={{ marginBottom: 16 }}>
              <span style={{ color: line.color, fontSize: 13, fontFamily: "SF Mono, monospace" }}>{line.speaker}: </span>
              <span style={{ color: COLORS.text, fontSize: 15, fontFamily: "SF Pro Display, sans-serif" }}>{line.text}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right: AI Panel */}
      <div
        style={{
          width: "55%",
          padding: 50,
          paddingLeft: 0,
          transform: `translateX(${panelSlide}px)`,
          opacity: panelOpacity,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 20, color: COLORS.accent, fontFamily: "SF Mono, monospace" }}>AI Suggestion</div>
          <div
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              background: `${COLORS.accent}22`,
              border: `1px solid ${COLORS.accent}44`,
              color: COLORS.accent,
              fontSize: 13,
              fontFamily: "SF Mono, monospace",
              opacity: shortcutPulse,
            }}
          >
            Cmd+K
          </div>
        </div>

        <div
          style={{
            flex: 1,
            background: `linear-gradient(135deg, ${COLORS.panel}, ${COLORS.accent}11)`,
            borderRadius: 12,
            border: `1px solid ${COLORS.accent}33`,
            padding: 28,
            boxShadow: `0 0 40px ${COLORS.accent}11`,
          }}
        >
          <pre
            style={{
              color: COLORS.text,
              fontSize: 16,
              fontFamily: "SF Pro Display, sans-serif",
              whiteSpace: "pre-wrap",
              lineHeight: 1.7,
              margin: 0,
            }}
          >
            {aiAnswer.slice(0, charCount)}
            {charCount < aiAnswer.length && (
              <span style={{ color: COLORS.accent, opacity: Math.sin(frame * 0.3) > 0 ? 1 : 0 }}>|</span>
            )}
          </pre>
        </div>

        {/* Provider selector */}
        <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
          {providers.map((p, i) => (
            <div
              key={p}
              style={{
                padding: "8px 18px",
                borderRadius: 8,
                background: i === activeProvider ? COLORS.accent : `${COLORS.panel}`,
                border: `1px solid ${i === activeProvider ? COLORS.accent : COLORS.panelBorder}`,
                color: i === activeProvider ? "#fff" : COLORS.textMuted,
                fontSize: 13,
                fontWeight: i === activeProvider ? 700 : 400,
                fontFamily: "SF Mono, monospace",
              }}
            >
              {p}
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ─── Scene 4: Screenshot Analysis ───────────────────────────────────

const codeSnippet = `function twoSum(nums, target) {
  const map = new Map();
  for (let i = 0; i < nums.length; i++) {
    const comp = target - nums[i];
    if (map.has(comp)) return [map.get(comp), i];
    map.set(nums[i], i);
  }
}`;

const analysisText = `Solution: Hash Map Approach

Use a hash map to store complements while iterating:
- For each number, check if its complement exists
- If found, return both indices immediately

Time: O(n) — single pass
Space: O(n) — hash map storage

Optimal solution with no sorting needed.`;

const ScreenshotAnalysis: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Cropper animation
  const cropperScale = spring({ frame, fps, config: { damping: 15, stiffness: 100 }, delay: 10 });
  const cropperBorder = interpolate(frame, [20, 40], [0, 2], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Analysis slide-in
  const analysisOpacity = interpolate(frame, [80, 100], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const analysisX = interpolate(frame, [80, 100], [40, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const analysisChars = Math.floor(
    interpolate(frame, [100, 240], [0, analysisText.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
  );

  // Scanning line
  const scanY = interpolate(frame, [40, 75], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: COLORS.bg, display: "flex" }}>
      {/* Left: Code Screenshot */}
      <div style={{ width: "50%", padding: 60, display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 20, color: COLORS.orange, marginBottom: 24, fontFamily: "SF Mono, monospace" }}>
          Screenshot Capture
        </div>
        <div
          style={{
            flex: 1,
            background: "#1e1e2e",
            borderRadius: 12,
            border: `${cropperBorder}px solid ${COLORS.orange}`,
            padding: 32,
            transform: `scale(${cropperScale})`,
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Code content */}
          <pre
            style={{
              color: "#e2e8f0",
              fontSize: 16,
              fontFamily: "SF Mono, Menlo, monospace",
              lineHeight: 1.8,
              margin: 0,
            }}
          >
            {codeSnippet}
          </pre>

          {/* Scanning line */}
          {frame >= 40 && frame <= 75 && (
            <div
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                top: `${scanY}%`,
                height: 2,
                background: `linear-gradient(90deg, transparent, ${COLORS.cyan}, transparent)`,
                boxShadow: `0 0 20px ${COLORS.cyan}`,
              }}
            />
          )}

          {/* Corner markers */}
          {[{ top: 0, left: 0 }, { top: 0, right: 0 }, { bottom: 0, left: 0 }, { bottom: 0, right: 0 }].map(
            (pos, i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  ...pos,
                  width: 20,
                  height: 20,
                  borderTop: pos.top === 0 ? `3px solid ${COLORS.orange}` : "none",
                  borderBottom: pos.bottom === 0 ? `3px solid ${COLORS.orange}` : "none",
                  borderLeft: pos.left === 0 ? `3px solid ${COLORS.orange}` : "none",
                  borderRight: pos.right === 0 ? `3px solid ${COLORS.orange}` : "none",
                  opacity: cropperScale,
                } as React.CSSProperties}
              />
            )
          )}
        </div>
      </div>

      {/* Right: Analysis */}
      <div
        style={{
          width: "50%",
          padding: 60,
          paddingLeft: 0,
          display: "flex",
          flexDirection: "column",
          opacity: analysisOpacity,
          transform: `translateX(${analysisX}px)`,
        }}
      >
        <div style={{ fontSize: 20, color: COLORS.cyan, marginBottom: 24, fontFamily: "SF Mono, monospace" }}>
          AI Analysis
        </div>
        <div
          style={{
            flex: 1,
            background: `linear-gradient(135deg, ${COLORS.panel}, ${COLORS.cyan}11)`,
            borderRadius: 12,
            border: `1px solid ${COLORS.cyan}33`,
            padding: 28,
            boxShadow: `0 0 40px ${COLORS.cyan}11`,
          }}
        >
          <pre
            style={{
              color: COLORS.text,
              fontSize: 17,
              fontFamily: "SF Pro Display, sans-serif",
              whiteSpace: "pre-wrap",
              lineHeight: 1.8,
              margin: 0,
            }}
          >
            {analysisText.slice(0, analysisChars)}
          </pre>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ─── Scene 5: Stealth Mode ──────────────────────────────────────────

const disguises = [
  { name: "Pika", icon: "⚡", color: COLORS.accent },
  { name: "Terminal", icon: "⬛", color: "#64748b" },
  { name: "Activity Monitor", icon: "📊", color: "#22c55e" },
  { name: "Settings", icon: "⚙️", color: "#94a3b8" },
];

const StealthMode: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Window opacity animation
  const windowOpacity = interpolate(
    frame,
    [30, 50, 60, 80],
    [1, 0.15, 0.15, 0.8],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Disguise cycling
  const disguiseIndex = Math.min(
    Math.floor(interpolate(frame, [100, 200], [0, disguises.length - 0.01], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })),
    disguises.length - 1
  );

  const badgeOpacity = interpolate(frame, [210, 230], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        background: COLORS.bg,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div style={{ fontSize: 42, fontWeight: 700, color: COLORS.text, marginBottom: 50, opacity: titleOpacity, fontFamily: "SF Pro Display, sans-serif" }}>
        Stealth Mode
      </div>

      {/* Window mockup */}
      <div
        style={{
          width: 700,
          height: 400,
          background: COLORS.panel,
          borderRadius: 12,
          border: `1px solid ${COLORS.panelBorder}`,
          opacity: windowOpacity,
          overflow: "hidden",
          boxShadow: `0 20px 60px rgba(0,0,0,0.5)`,
        }}
      >
        {/* Title bar */}
        <div
          style={{
            height: 36,
            background: "#252545",
            display: "flex",
            alignItems: "center",
            padding: "0 12px",
            gap: 8,
          }}
        >
          <div style={{ width: 12, height: 12, borderRadius: 6, background: "#ff5f57" }} />
          <div style={{ width: 12, height: 12, borderRadius: 6, background: "#febc2e" }} />
          <div style={{ width: 12, height: 12, borderRadius: 6, background: "#28c840" }} />
          <span style={{ color: COLORS.textMuted, fontSize: 13, marginLeft: 12, fontFamily: "SF Mono, monospace" }}>
            {disguises[disguiseIndex].icon} {disguises[disguiseIndex].name}
          </span>
        </div>
        <div style={{ padding: 30, display: "flex", justifyContent: "center", alignItems: "center", height: "calc(100% - 36px)" }}>
          <span style={{ fontSize: 64 }}>{disguises[disguiseIndex].icon}</span>
        </div>
      </div>

      {/* Disguise selector */}
      <div style={{ display: "flex", gap: 20, marginTop: 40 }}>
        {disguises.map((d, i) => (
          <div
            key={d.name}
            style={{
              padding: "12px 24px",
              borderRadius: 12,
              background: i === disguiseIndex ? `${d.color}22` : COLORS.panel,
              border: `2px solid ${i === disguiseIndex ? d.color : COLORS.panelBorder}`,
              color: i === disguiseIndex ? d.color : COLORS.textMuted,
              fontSize: 15,
              fontWeight: i === disguiseIndex ? 700 : 400,
              fontFamily: "SF Mono, monospace",
              display: "flex",
              gap: 8,
              alignItems: "center",
            }}
          >
            <span>{d.icon}</span> {d.name}
          </div>
        ))}
      </div>

      {/* Invisible badge */}
      <div
        style={{
          marginTop: 40,
          padding: "12px 32px",
          borderRadius: 999,
          background: `${COLORS.green}22`,
          border: `1px solid ${COLORS.green}44`,
          color: COLORS.green,
          fontSize: 18,
          fontFamily: "SF Mono, monospace",
          opacity: badgeOpacity,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        🔒 Invisible on Screen Share
      </div>
    </AbsoluteFill>
  );
};

// ─── Scene 6: Closing ───────────────────────────────────────────────

const features = [
  { icon: "🎙️", label: "Transcription" },
  { icon: "🤖", label: "AI Answers" },
  { icon: "📸", label: "Screenshots" },
  { icon: "🔒", label: "Stealth" },
  { icon: "🌐", label: "Multi-Provider" },
  { icon: "⚡", label: "Low Latency" },
];

const Closing: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleScale = spring({ frame: frame - 20, fps, config: { damping: 12, stiffness: 80 } });
  const ctaOpacity = interpolate(frame, [80, 100], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse at 50% 50%, ${COLORS.accent}22 0%, ${COLORS.bg} 70%)`,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      {/* Feature icons grid */}
      <div style={{ display: "flex", gap: 32, marginBottom: 50 }}>
        {features.map((f, i) => {
          const iconScale = spring({ frame: frame - i * 4, fps, config: { damping: 12, stiffness: 100 } });
          return (
            <div
              key={f.label}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
                transform: `scale(${iconScale})`,
              }}
            >
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 16,
                  background: COLORS.panel,
                  border: `1px solid ${COLORS.panelBorder}`,
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  fontSize: 28,
                }}
              >
                {f.icon}
              </div>
              <span style={{ color: COLORS.textMuted, fontSize: 12, fontFamily: "SF Mono, monospace" }}>{f.label}</span>
            </div>
          );
        })}
      </div>

      {/* Title */}
      <div
        style={{
          fontSize: 56,
          fontWeight: 800,
          color: COLORS.text,
          fontFamily: "SF Pro Display, sans-serif",
          transform: `scale(${Math.max(0, titleScale)})`,
          letterSpacing: -1,
        }}
      >
        Your AI Interview Copilot
      </div>

      {/* CTA */}
      <div style={{ opacity: ctaOpacity, marginTop: 40, display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <div
          style={{
            padding: "16px 48px",
            borderRadius: 12,
            background: `linear-gradient(135deg, ${COLORS.accent}, ${COLORS.cyan})`,
            color: "#fff",
            fontSize: 22,
            fontWeight: 700,
            fontFamily: "SF Pro Display, sans-serif",
            boxShadow: `0 0 40px ${COLORS.accent}44`,
          }}
        >
          Download Pika
        </div>
        <span style={{ color: COLORS.textMuted, fontSize: 14, fontFamily: "SF Mono, monospace" }}>v2.0.8</span>
      </div>
    </AbsoluteFill>
  );
};

// ─── Scene transitions (fade) ───────────────────────────────────────

const FadeTransition: React.FC<{ durationInFrames: number }> = ({ durationInFrames }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <AbsoluteFill style={{ background: COLORS.bg, opacity }} />
  );
};

// ─── Main Composition ───────────────────────────────────────────────

export const PikaDemo: React.FC = () => {
  return (
    <AbsoluteFill style={{ background: COLORS.bg }}>
      {/* Scene 1: Opening (0-90) */}
      <Sequence from={0} durationInFrames={105}>
        <Opening />
      </Sequence>
      <Sequence from={90} durationInFrames={15}>
        <FadeTransition durationInFrames={15} />
      </Sequence>

      {/* Scene 2: Transcription (90-360) */}
      <Sequence from={90} durationInFrames={285}>
        <Transcription />
      </Sequence>
      <Sequence from={360} durationInFrames={15}>
        <FadeTransition durationInFrames={15} />
      </Sequence>

      {/* Scene 3: AI Suggestions (360-660) */}
      <Sequence from={360} durationInFrames={315}>
        <AISuggestions />
      </Sequence>
      <Sequence from={660} durationInFrames={15}>
        <FadeTransition durationInFrames={15} />
      </Sequence>

      {/* Scene 4: Screenshot Analysis (660-960) */}
      <Sequence from={660} durationInFrames={315}>
        <ScreenshotAnalysis />
      </Sequence>
      <Sequence from={960} durationInFrames={15}>
        <FadeTransition durationInFrames={15} />
      </Sequence>

      {/* Scene 5: Stealth Mode (960-1200) */}
      <Sequence from={960} durationInFrames={255}>
        <StealthMode />
      </Sequence>
      <Sequence from={1200} durationInFrames={15}>
        <FadeTransition durationInFrames={15} />
      </Sequence>

      {/* Scene 6: Closing (1200-1350) */}
      <Sequence from={1200} durationInFrames={150}>
        <Closing />
      </Sequence>
    </AbsoluteFill>
  );
};
