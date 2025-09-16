import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * FloodDemoControl.tsx
 * Fresh, typed, flicker-free demo with:
 * - Place + map header
 * - AI Flood Prediction row: Status, Likelihood, ETA
 * - Sensor readings + display-only rain slider
 * - Deterministic demo flow: ramp up → peak hold → ramp down → idle
 */

/* ============================================================
   Types
   ============================================================ */
type FloodStage = "normal" | "watch" | "warning" | "danger" | "subsiding";
type StatusLabel = "NORMAL" | "WATCH" | "WARNING" | "DANGER" | "SUBSIDING";
type SimPhase = "idle" | "rampUp" | "peakHold" | "rampDown";

type Sensors = {
  airTemp: number;       // °C
  humidity: number;      // %
  level: number;         // m (river level)
  flow: number;          // m/s
  pressure: number;      // hPa
  wind: number;          // m/s
  soil: number;          // %
  turbidity: number;     // NTU
  waterTemp: number;     // °C
  upstreamLevel: number; // m
  rainRate: number;      // mm/h
  dischargeQ: number;    // m³/s
};

/* ============================================================
   Tunables
   ============================================================ */
const TICK_MS = 250; // sensor update rate

// Likelihood smoothing & step clamp to avoid flicker/skip
const EMA_ALPHA = 0.25; // 0..1
const MAX_STEP = 4;     // max Δ% per tick

// Status thresholds (by likelihood %)
const BUCKETS = {
  NORMAL_MAX: 39,
  WATCH_MIN: 40,
  WATCH_MAX: 69,
  WARNING_MIN: 70,
  WARNING_MAX: 79,
  DANGER_MIN: 80,
};

// ETA logic
const COUNTDOWN_START_PCT = 95; // start countdown at 95..98%
const COUNTDOWN_START_S = 20;   // 20 → 1
const PEAK_NOW_PCT = 99;        // show "Now" at 99..100%
const PEAK_HOLD_MS = 15000;     // hold 15s near 99..100 before ramping down

// Rain ramp rates
const RAMP_UP_STEP = 4;   // % per tick (approx)
const RAMP_DOWN_STEP = 3; // % per tick

// Subsiding behaviour: show "Subsiding" until sensors are back near baseline
const BASELINE_EPS = 0.03; // 3% tolerance per-sensor for "close enough"

// Map/status colors
const statusColorMap: Record<StatusLabel, string> = {
  NORMAL: "#2ecc71",
  WATCH: "#f1c40f",
  WARNING: "#e67e22",
  DANGER: "#e74c3c",
  SUBSIDING: "#95a5a6",
};

const stageToStatusLabel: Record<FloodStage, StatusLabel> = {
  normal: "NORMAL",
  watch: "WATCH",
  warning: "WARNING",
  danger: "DANGER",
  subsiding: "SUBSIDING",
};

/* ============================================================
   Baselines & helpers
   ============================================================ */
const BASE: Sensors = {
  airTemp: 31.0,
  humidity: 70.0,
  level: 1.20,
  flow: 0.80,
  pressure: 1008.0,
  wind: 1.5,
  soil: 25.0,
  turbidity: 10.0,
  waterTemp: 29.0,
  upstreamLevel: 1.10,
  rainRate: 0.0,
  dischargeQ: 96.0, // 1.2 m * 0.8 m/s * 100 (arbitrary cross-section factor)
};

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function easePow(x: number, p: number) {
  const c = clamp01(x);
  return Math.pow(c, p);
}
function approxEqual(a: number, b: number, epsAbs: number) {
  return Math.abs(a - b) <= epsAbs;
}

/* ============================================================
   Component
   ============================================================ */
export default function FloodDemoControl() {
  /* ------------------ Simulation state ------------------ */
  const [phase, setPhase] = useState<SimPhase>("idle");
  const [rain, setRain] = useState<number>(0); // 0..100 (% intensity)

  // Live sensor readings (move toward targets)
  const [S, setS] = useState<Sensors>({ ...BASE });

  // Likelihood (smoothed)
  const [lk, setLk] = useState<number>(0); // 0..100
  const lkRef = useRef(0);

  // Stage derived from lk + phase (subsiding override)
  const [stage, setStage] = useState<FloodStage>("normal");

  // ETA display
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null); // 20..1 while counting
  const [etaNow, setEtaNow] = useState<boolean>(false);              // "Now"
  const countdownTimerRef = useRef<number | null>(null);
  const peakHoldTimerRef = useRef<number | null>(null);

  // One-shot alert when entering DANGER the first time
  const dangerAlertedRef = useRef<boolean>(false);
  // Track when rampUp started and how long we've been in 'danger'
  const rampUpSinceRef = useRef<number | null>(null);
  const dangerSinceRef = useRef<number | null>(null);

  /* ------------------ Targets from rain ------------------ */
  const targets: Sensors = useMemo(() => {
    const x = clamp01(rain / 100);
    const x1 = easePow(x, 1.12);
    const x2 = easePow(x, 1.35);
    const x3 = easePow(x, 1.7);

    // Map rain → sensor targets (plausible responses)
    const airTemp = BASE.airTemp - 2.5 * x1;
    const humidity = BASE.humidity + 25 * x1;
    const level = BASE.level + 0.75 * x2;
    const flow = BASE.flow + 0.9 * x1;
    const pressure = BASE.pressure - 9 * x1;
    const wind = BASE.wind + 3.2 * x1;
    const soil = BASE.soil + 35 * x1;
    const turbidity = BASE.turbidity + 85 * x3;
    const waterTemp = BASE.waterTemp - 1.4 * x1;
    const upstreamLevel = BASE.upstreamLevel + 0.8 * x2;
    const rainRate = BASE.rainRate + 120 * x1;

    // Simple discharge model
    const dischargeQ = (level * flow) * 100;

    return {
      airTemp,
      humidity,
      level,
      flow,
      pressure,
      wind,
      soil,
      turbidity,
      waterTemp,
      upstreamLevel,
      rainRate,
      dischargeQ,
    };
  }, [rain]);

  /* ------------------ Likelihood algorithm ------------------ */
  const rawLikelihood = useMemo(() => {
    // Normalize key drivers relative to baseline & plausible scale
    const fLevel = clamp01((S.level - BASE.level) / 0.75);            // 0..1
    const fFlow = clamp01((S.flow - BASE.flow) / 0.9);
    const fUp = clamp01((S.upstreamLevel - BASE.upstreamLevel) / 0.8);
    const fTurb = clamp01((S.turbidity - BASE.turbidity) / 85);
    const fRain = clamp01((S.rainRate - BASE.rainRate) / 120);
    const fPdrop = clamp01((BASE.pressure - S.pressure) / 9);

    // Weighted sum (must sum to 1.0)
    const score =
      0.27 * fLevel +
      0.20 * fFlow +
      0.20 * fUp +
      0.14 * fTurb +
      0.14 * fRain +
      0.05 * fPdrop;

    return clamp01(score) * 100; // %
  }, [S]);

  /* Smooth + clamp likelihood changes to avoid flicker or bucket skipping */
  useEffect(() => {
    setLk(prev => {
      const ema = prev + EMA_ALPHA * (rawLikelihood - prev);
      const clamped = Math.max(prev - MAX_STEP, Math.min(prev + MAX_STEP, ema));
      lkRef.current = clamped;
      return clamped;
    });
  }, [rawLikelihood]);

  /* ------------------ Stage logic ------------------ */
  useEffect(() => {
    // Are we close to baseline?
    const close =
      approxEqual(S.airTemp, BASE.airTemp, Math.abs(BASE.airTemp) * BASELINE_EPS) &&
      approxEqual(S.humidity, BASE.humidity, Math.abs(BASE.humidity) * BASELINE_EPS) &&
      approxEqual(S.level, BASE.level, Math.abs(BASE.level) * BASELINE_EPS) &&
      approxEqual(S.flow, BASE.flow, Math.abs(BASE.flow) * BASELINE_EPS) &&
      approxEqual(S.pressure, BASE.pressure, Math.abs(BASE.pressure) * BASELINE_EPS) &&
      approxEqual(S.wind, BASE.wind, Math.abs(BASE.wind) * BASELINE_EPS) &&
      approxEqual(S.soil, BASE.soil, Math.abs(BASE.soil) * BASELINE_EPS) &&
      approxEqual(S.turbidity, BASE.turbidity, Math.abs(BASE.turbidity) * BASELINE_EPS) &&
      approxEqual(S.waterTemp, BASE.waterTemp, Math.abs(BASE.waterTemp) * BASELINE_EPS) &&
      approxEqual(S.upstreamLevel, BASE.upstreamLevel, Math.abs(BASE.upstreamLevel) * BASELINE_EPS) &&
      approxEqual(S.rainRate, BASE.rainRate, 1.0);

    if (phase === "rampDown" && !close) {
      setStage("subsiding");
      return;
    }

    // Otherwise, bucket by likelihood
    const p = Math.round(lk);
    if (p >= BUCKETS.DANGER_MIN) setStage("danger");
    else if (p >= BUCKETS.WARNING_MIN) setStage("warning");
    else if (p >= BUCKETS.WATCH_MIN) setStage("watch");
    else setStage("normal");

    // If we've returned to baseline during rampDown, finish
    if (phase === "rampDown" && close) {
      setPhase("idle");
      setEtaSeconds(null);
      setEtaNow(false);
      dangerAlertedRef.current = false;
    }
  }, [lk, phase, S]);

  /* ------------------ ETA logic ------------------ */
  useEffect(() => {
    // Clear countdown timer when conditions no longer hold
    const clearCountdown = () => {
      if (countdownTimerRef.current) {
        window.clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
    };

    if (etaNow) {
      clearCountdown();
      return;
    }

    const p = lkRef.current;

    // Start countdown at 95..98% if not already running
    if (p >= COUNTDOWN_START_PCT && p < PEAK_NOW_PCT && etaSeconds == null) {
      setEtaSeconds(COUNTDOWN_START_S);
      countdownTimerRef.current = window.setInterval(() => {
        setEtaSeconds(prev => {
          if (prev == null) return null;
          if (prev <= 1) {
            // If we reach 0 while still <99, pin at 1 (edge case protection)
            return 1;
          }
          return prev - 1;
        });
      }, 1000);
    }

    // At 99%+, show "Now"
    if (p >= PEAK_NOW_PCT) {
      setEtaNow(true);
      setEtaSeconds(null);
      clearCountdown();
    }

    // Drop below 95% cancels countdown
    if (p < COUNTDOWN_START_PCT && etaSeconds != null) {
      setEtaSeconds(null);
      clearCountdown();
    }

    return () => {
      // cleanup on unmount
    };
  }, [lk, etaSeconds, etaNow]);

  // --- Toast state (bottom-right, non-blocking) ---
  type ToastItem = { id: number; text: string };

  const [toasts, setToasts] = useState<ToastItem[]>([]);

  function dismissToast(id: number) {
    setToasts(ts => ts.filter(t => t.id !== id));
  }

  function pushToast(text: string, ms = 6000) {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts(ts => [...ts, { id, text }]);
    // auto-dismiss
    window.setTimeout(() => {
      setToasts(ts => ts.filter(t => t.id !== id));
    }, ms);
  }

  /* ------------------ DANGER alert one-shot ------------------ */
  useEffect(() => {
    if (!dangerAlertedRef.current && stage === "danger") {
      dangerAlertedRef.current = true;
      // Pop once when first crossing into Danger
      // (Replace alert() with your toast system if needed)
      //alert("Residents are being sent SMS to proceed to the nearest PPS (Pusat Pemindahan Sementara).");
      pushToast("Residents are being sent SMS to proceed to the nearest PPS (Pusat Pemindahan Sementara).");
    }
  }, [stage]);

  useEffect(() => {
    if (phase === "rampUp" && stage === "danger") {
      if (dangerSinceRef.current == null) dangerSinceRef.current = performance.now();
    } else {
      dangerSinceRef.current = null;
    }
  }, [phase, stage]);

  /* ------------------ Tick: sensor easing & demo flow ------------------ */
  useEffect(() => {
    const id = window.setInterval(() => {
      // 1) Drive rain by phase
      setRain(prev => {
        if (phase === "rampUp") {
          const next = Math.min(100, prev + RAMP_UP_STEP);
          return next;
        }
        if (phase === "rampDown") {
          const next = Math.max(0, prev - RAMP_DOWN_STEP);
          return next;
        }
        return prev;
      });

      // 2) Ease sensors toward targets (with tiny jitter)
      setS(cur => {
        const t = 0.2; // easing factor per tick
        const j = 0.005; // jitter scale
        const nxt: Sensors = { ...cur };
        (Object.keys(cur) as (keyof Sensors)[]).forEach(k => {
          const target = targets[k];
          const current = cur[k];
          const jitter = (Math.random() - 0.5) * j * (Math.abs(target) + 1);
          nxt[k] = lerp(current, target, t) + jitter;
        });
        // Keep some invariants non-negative
        nxt.turbidity = Math.max(0, nxt.turbidity);
        nxt.humidity = clamp01(nxt.humidity / 100) * 100;
        nxt.soil = clamp01(nxt.soil / 100) * 100;
        return nxt;
      });
    }, TICK_MS);

    return () => {
      window.clearInterval(id);
    };
  }, [phase, targets]);

  useEffect(() => {
    if (phase !== "rampUp" || peakHoldTimerRef.current != null) return;

    const now = performance.now();
    const inDangerForMs =
      dangerSinceRef.current != null ? now - dangerSinceRef.current : 0;
    const rampUpForMs =
      rampUpSinceRef.current != null ? now - rampUpSinceRef.current : 0;

    const sustainedDanger = inDangerForMs >= 3000;     // 3s in danger
    const sustainedRain = rain >= 99;                   // rain has reached max
    const maxRampUpPassed = rampUpForMs >= 60000;       // 60s fallback

    if (lkRef.current >= PEAK_NOW_PCT || sustainedDanger || sustainedRain || maxRampUpPassed) {
      setPhase("peakHold");
      setRain(100);
      setEtaNow(true);
      setEtaSeconds(null);

      peakHoldTimerRef.current = window.setTimeout(() => {
        peakHoldTimerRef.current = null;
        setPhase("rampDown");
        setEtaNow(false);
        setEtaSeconds(null);
      }, PEAK_HOLD_MS);
    }
  }, [phase, rain, lk]);

  useEffect(() => {
    return () => {
      if (countdownTimerRef.current) {
        window.clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
      if (peakHoldTimerRef.current) {
        window.clearTimeout(peakHoldTimerRef.current);
        peakHoldTimerRef.current = null;
      }
    };
  }, []);

  /* ------------------ Demo controls ------------------ */
  const onStartDemo = () => {
    // Reset everything cleanly
    setPhase("rampUp");
    setEtaSeconds(null);
    setEtaNow(false);
    dangerAlertedRef.current = false;
    rampUpSinceRef.current = performance.now();
    dangerSinceRef.current = null;
  };

  /* ------------------ Derived UI bits ------------------ */
  const statusLabel: StatusLabel =
    phase === "rampDown" && stage === "subsiding"
      ? "SUBSIDING"
      : stageToStatusLabel[stage];

  const statusColor = statusColorMap[statusLabel];

  const etaText = (() => {
    if (phase === "rampDown" && stage === "subsiding") return "Flood is subsiding";
    if (etaNow) return "Now";
    if (etaSeconds != null) return `${etaSeconds}s`;
    return "No flood expected";
  })();

  /* ------------------ Render ------------------ */
  return (
    <div
      style={{
        fontFamily: "Inter, system-ui, Arial",
        lineHeight: 1.3,
        color: "#111", // black text
        padding: 16,
        maxWidth: 1100,
        margin: "0 auto",
        background: "#FFFAF8", // slightly off-white page background
      }}
    >
      {/* Header: place + map */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            padding: 16,
            border: "1px solid #e7e5e4",
            borderRadius: 12,
            background: "#fff",
            boxShadow: "0 1px 0 rgba(17,17,17,0.03)",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 20, color: "#111" }}>
            Klang River — Klang City
          </h2>
          <div style={{ marginTop: 8, fontSize: 14, color: "#444" }}>
            Coordinates:&nbsp;
            <strong style={{ color: "#111" }}>3.043°N, 101.449°E</strong>
          </div>
          <div style={{ marginTop: 8, fontSize: 14, color: "#666" }}>
            Monitoring station: Midstream (demo)
          </div>
        </div>

        <div
          style={{
            position: "relative",
            padding: 0,
            border: "1px solid #e7e5e4",
            borderRadius: 12,
            overflow: "hidden",
            height: 150,
            background: "#fff",
            boxShadow: "0 1px 0 rgba(17,17,17,0.03)",
          }}
        >
          {/* Map image (full cover) */}
          <img
            src="./maps/klang-city.jpg"            // served from /public
            alt="Klang City map"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              objectPosition: "center",
              display: "block",
              pointerEvents: "none",
            }}
          />

          {/* Red pin overlay */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: "50%",
                background: "#F05B2D",
                boxShadow: "0 0 0 6px rgba(240,91,45,0.18)",
                border: "1px solid rgba(0,0,0,0.08)",
              }}
            />
          </div>

          {/* Caption */}
          <div
            style={{
              position: "absolute",
              bottom: 8,
              right: 12,
              fontSize: 12,
              color: "#666",
              background: "rgba(255,255,255,0.75)",
              padding: "2px 6px",
              borderRadius: 6,
            }}
          >
            Map (demo)
          </div>
        </div>
      </div>

      {/* AI Flood Prediction */}
      <div
        style={{
          border: "1px solid #e7e5e4",
          borderRadius: 12,
          padding: 16,
          marginBottom: 16,
          background: "#fff",
          boxShadow: "0 1px 0 rgba(17,17,17,0.03)",
        }}
      >
        <h3
          style={{
            margin: 0,
            marginBottom: 12,
            fontSize: 18,
            color: "#111",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span
            style={{
              width: 6,
              height: 18,
              background: "#F05B2D",
              borderRadius: 3,
              display: "inline-block",
            }}
          />
          AI Flood Prediction
        </h3>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 12,
            marginTop: 8,
          }}
        >
          {/* Status */}
          <div
            style={{
              border: "1px solid #eee",
              borderRadius: 12,
              padding: 12,
              background: "#FFFAF8",
            }}
          >
            <div style={{ fontSize: 12, color: "#555", marginBottom: 4 }}>
              Flood Status
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span
                style={{
                  width: 12,
                  height: 12,
                  display: "inline-block",
                  borderRadius: "50%",
                  background: statusColor, // dynamic status color
                  border: "1px solid rgba(0,0,0,0.1)",
                }}
              />
              <strong style={{ fontSize: 16, color: "#111" }}>{statusLabel}</strong>
            </div>
          </div>

          {/* Likelihood */}
          <div
            style={{
              border: "1px solid #eee",
              borderRadius: 12,
              padding: 12,
              background: "#fff",
            }}
          >
            <div style={{ fontSize: 12, color: "#555", marginBottom: 4 }}>
              Likelihood
            </div>
            <div style={{ fontSize: 16 }}>
              <strong style={{ color: "#F05B2D" }}>{Math.round(lk)}%</strong>
            </div>
          </div>

          {/* ETA */}
          <div
            style={{
              border: "1px solid #eee",
              borderRadius: 12,
              padding: 12,
              background: "#fff",
            }}
          >
            <div style={{ fontSize: 12, color: "#555", marginBottom: 4 }}>
              Estimated Time to Flood
            </div>
            <div style={{ fontSize: 16 }}>
              <strong
                style={{
                  color:
                    etaText === "Now"
                      ? "#D92D20" // deeper red when "Now"
                      : etaText === "Flood is subsiding"
                        ? "#6B7280" // grey
                        : "#111",
                }}
              >
                {etaText}
              </strong>
            </div>
          </div>
        </div>
      </div>

      {/* Sensors + Rain */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
        {/* Sensor Readings */}
        <div
          style={{
            border: "1px solid #e7e5e4",
            borderRadius: 12,
            padding: 16,
            background: "#fff",
            boxShadow: "0 1px 0 rgba(17,17,17,0.03)",
          }}
        >
          <h3 style={{ margin: 0, marginBottom: 12, fontSize: 18, color: "#111" }}>
            Sensor Readings
          </h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 10,
            }}
          >
            <Field label="Air Temperature" value={`${S.airTemp.toFixed(1)} °C`} />
            <Field label="Humidity" value={`${S.humidity.toFixed(0)} %`} />
            <Field label="River Level" value={`${S.level.toFixed(2)} m`} />
            <Field label="Flow Speed" value={`${S.flow.toFixed(2)} m/s`} />
            <Field
              label="Barometric Pressure"
              value={`${S.pressure.toFixed(1)} hPa`}
            />
            <Field label="Wind Speed" value={`${S.wind.toFixed(1)} m/s`} />
            <Field label="Soil Moisture" value={`${S.soil.toFixed(0)} %`} />
            <Field label="Turbidity" value={`${S.turbidity.toFixed(0)} NTU`} />
            <Field label="Water Temperature" value={`${S.waterTemp.toFixed(1)} °C`} />
            <Field
              label="Upstream Level"
              value={`${S.upstreamLevel.toFixed(2)} m`}
            />
            <Field label="Rainfall Rate" value={`${S.rainRate.toFixed(0)} mm/h`} />
            <Field label="Discharge (Q)" value={`${S.dischargeQ.toFixed(1)} m³/s`} />
          </div>
        </div>

        {/* Rain Intensity (display only) */}
        <div
          style={{
            border: "1px solid #e7e5e4",
            borderRadius: 12,
            padding: 16,
            background: "#fff",
            boxShadow: "0 1px 0 rgba(17,17,17,0.03)",
          }}
        >
          <h3 style={{ margin: 0, marginBottom: 12, fontSize: 18, color: "#111" }}>
            Rain Intensity
          </h3>
          <div style={{ marginTop: 12 }}>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(rain)}
              readOnly
              style={{
                width: "100%",
                accentColor: "#F05B2D", // orange accent
              }}
            />
            <div style={{ marginTop: 8, fontSize: 14, color: "#F05B2D" }}>
              {Math.round(rain)}%
            </div>
          </div>
          <button
            onClick={onStartDemo}
            disabled={phase !== "idle"}
            style={{
              marginTop: 16,
              padding: "10px 14px",
              borderRadius: 10,
              border: "1px solid #eaecf0",
              background: phase === "idle" ? "#F05B2D" : "#9ca3af",
              color: "#fff",
              cursor: phase === "idle" ? "pointer" : "not-allowed",
              boxShadow: phase === "idle" ? "0 6px 16px rgba(240,91,45,0.25)" : "none",
            }}
          >
            Start Demo Mode
          </button>
          <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>
            Slider is display-only. Click Start to run the scripted simulation.
          </div>

          {/* --- New: Brochure QR section --- */}
          <div style={{ marginTop: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#111" }}>
              Scan for brochure!
            </div>

            <div style={{ marginTop: 8, width: "100%", aspectRatio: "1 / 1", borderRadius: 12, overflow: "hidden", background: "#FFFAF8" }}>
              <img
                src="./images/qr-code.jpg"
                alt="Brochure QR"
                style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
              />
            </div>

          </div>
        </div>

      </div>

      {/* Toasts (bottom-right) */}
      <div
        style={{
          position: "fixed",
          right: 16,
          bottom: 16,
          display: "grid",
          gap: 8,
          zIndex: 9999,
        }}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            style={{
              minWidth: 280,
              maxWidth: 360,
              background: "#111827", // dark toast
              color: "#fff",
              padding: "12px 14px",
              borderRadius: 12,
              boxShadow: "0 10px 25px rgba(0,0,0,0.25)",
              border: "1px solid rgba(255,255,255,0.08)",
              display: "grid",
              gridTemplateColumns: "1fr auto",
              alignItems: "start",
              gap: 10,
              transform: "translateY(0)",
              transition: "opacity 200ms ease, transform 200ms ease",
              // orange accent on the left edge
              boxSizing: "border-box",
              position: "relative",
            }}
            role="status"
            aria-live="polite"
          >
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: 4,
                background: "#F05B2D",
                borderTopLeftRadius: 12,
                borderBottomLeftRadius: 12,
              }}
            />
            <div style={{ fontSize: 14, lineHeight: 1.4, paddingLeft: 4 }}>
              {t.text}
            </div>
            <button
              onClick={() => dismissToast(t.id)}
              aria-label="Dismiss notification"
              style={{
                background: "transparent",
                border: "none",
                color: "#d1d5db",
                cursor: "pointer",
                padding: 0,
                margin: 0,
                fontSize: 16,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   Small presentational helper
   ============================================================ */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid #f1f5f9", borderRadius: 10, padding: 10 }}>
      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 4 }}>{label}</div>
      <div style={{ fontWeight: 600 }}>{value}</div>
    </div>
  );
}
