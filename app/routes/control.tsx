import { useEffect, useMemo, useRef, useState } from "react";
import { getBus, send } from "../lib/bus";

/** ---- Tunable simulation constants ---- */
const BASE = {
  temp: 31.0,        // °C at 0% rain (air)
  hum: 68,           // % at 0% rain
  level: 0.35,       // m at 0% rain (local river)
  flow: 0.60,        // m/s at 0% rain (local river)
  pressure: 1011.0,  // hPa
  wind: 1.2,         // m/s
  soil: 42,          // % soil moisture
  turbidity: 8,      // NTU
  waterTemp: 28.0,   // °C
  upstreamLevel: 0.30 // m
};

// Max change at 100% rain
const GAIN = {
  tempDrop: 5.0,        // air temp up to -5°C
  humRise: 30.0,        // humidity up to +30%
  levelRise: 0.70,      // +0.70 m (0.35 -> 1.05)
  flowRise: 1.40,       // +1.40 m/s
  pressureDrop: 10.0,   // -10 hPa
  windRise: 6.0,        // +6 m/s
  soilRise: 35.0,       // +35 %
  turbidityRise: 210.0, // +210 NTU
  waterTempDrop: 2.0,   // -2 °C
  upstreamLevelRise: 0.85 // +0.85 m
};

// Easing (higher = faster convergence)
const TICK_MS = 200; // physics tick (5×/s)
const ALPHA = {
  temp: 0.15,
  hum: 0.25,
  level: 0.05,   // ~10–12s to overflow at 100% rain
  flow: 0.12,
  pressure: 0.12,
  wind: 0.12,
  soil: 0.05,
  turbidity: 0.10,
  waterTemp: 0.12,
  upstreamLevel: 0.08
};

// Visual/video threshold
const RAIN_THRESHOLD = 70;
// Simulated overflow level for prediction model
const FLOOD_LEVEL = 1.00; // m

/** Helpers */
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const easePow = (x: number, p = 1.4) => Math.pow(clamp(x, 0, 1), p);
const lerpToward = (cur: number, target: number, alpha: number) => cur + (target - cur) * alpha;
const jitter = (mag: number) => (Math.random() - 0.5) * mag;
const rainToMmPerHour = (r: number) => Math.round((r / 100) * 80); // 0..80 mm/h

/** Closed-form ETA to flood for discrete easing */
function etaToFloodSeconds(currentLevel: number, targetLevel: number): number {
  const deltaFlood = targetLevel - FLOOD_LEVEL; // T - flood
  if (deltaFlood <= 0) return Number.POSITIVE_INFINITY;
  const d0 = targetLevel - currentLevel;       // T - L0
  if (d0 <= deltaFlood) return 0;
  const a = ALPHA.level;
  const n = Math.log(deltaFlood / d0) / Math.log(1 - a); // ticks
  return Math.max(0, n * (TICK_MS / 1000));
}

/** --- MiniMap (unchanged if you already added it) --- */
function MiniMap({
  lat = 3.046682,
  lng = 101.446430,
  imageUrl = "/maps/klang-city.jpg",
  height = 120,
  variant = "banner",
}: {
  lat?: number; lng?: number; imageUrl?: string; height?: number; variant?: "banner" | "default";
}) {
  const bg = `url(${imageUrl}), linear-gradient(135deg, #e8eef6 0%, #f5f7fb 100%)`;
  const cls = `map-shell ${variant === "banner" ? "banner" : ""}`;
  return (
    <div className={cls} aria-label="Map" style={{ height }}>
      <div className="map-canvas" style={{ backgroundImage: bg }} />
      <div className="map-pin" title={`${lat.toFixed(6)}, ${lng.toFixed(6)}`} />
      <div className="map-coords">
        {lat.toFixed(6)}, {lng.toFixed(6)}
      </div>
    </div>
  );
}

type PMState = "idle" | "rampingUp" | "waitingFlood" | "holding" | "rampingDown";
type Toast = { id: number; title: string; message: string };

export default function Control() {
  const [rain, setRain] = useState(0);        // 0..100
  // core sensors
  const [temp, setTemp] = useState(BASE.temp);
  const [hum, setHum] = useState(BASE.hum);
  const [level, setLevel] = useState(BASE.level);
  const [flow, setFlow] = useState(BASE.flow);
  // new sensors
  const [pressure, setPressure] = useState(BASE.pressure);
  const [wind, setWind] = useState(BASE.wind);
  const [soil, setSoil] = useState(BASE.soil);
  const [turbidity, setTurbidity] = useState(BASE.turbidity);
  const [waterTemp, setWaterTemp] = useState(BASE.waterTemp);
  const [upLevel, setUpLevel] = useState(BASE.upstreamLevel);

  // Targets from the slider
  const targets = useMemo(() => {
    const x = rain / 100;
    const x1 = easePow(x, 1.2);
    const x2 = easePow(x, 1.6);
    const x3 = easePow(x, 1.9);

    const tTemp = BASE.temp - GAIN.tempDrop * x1;
    const tHum  = clamp(BASE.hum + GAIN.humRise * x2, 0, 100);
    const tLvl  = BASE.level + GAIN.levelRise * x3;
    const tFlow = BASE.flow + GAIN.flowRise * easePow(x, 1.2);

    const tPressure = BASE.pressure - GAIN.pressureDrop * x1;
    const tWind     = BASE.wind + GAIN.windRise * x1;
    const tSoil     = clamp(BASE.soil + GAIN.soilRise * x2, 0, 100);
    const tTurb     = BASE.turbidity + GAIN.turbidityRise * (0.5 * x2 + 0.5 * easePow(x, 1.4));
    const tWaterT   = BASE.waterTemp - GAIN.waterTempDrop * x1;
    const tUpLvl    = BASE.upstreamLevel + GAIN.upstreamLevelRise * x3;

    return { tTemp, tHum, tLvl, tFlow, tPressure, tWind, tSoil, tTurb, tWaterT, tUpLvl };
  }, [rain]);

  // Physics loop: keep FULL precision in state (no rounding here)
  useEffect(() => {
    const id = window.setInterval(() => {
      setTemp(v => lerpToward(v, targets.tTemp + jitter(0.06), ALPHA.temp));
      setHum(v  => lerpToward(v, targets.tHum  + jitter(0.4),  ALPHA.hum));
      setLevel(v=> lerpToward(v, targets.tLvl  + jitter(0.002), ALPHA.level));
      setFlow(v => lerpToward(v, targets.tFlow + jitter(0.02),  ALPHA.flow));

      setPressure(v => lerpToward(v, targets.tPressure + jitter(0.15), ALPHA.pressure));
      setWind(v     => lerpToward(v, targets.tWind     + jitter(0.05), ALPHA.wind));
      setSoil(v     => lerpToward(v, targets.tSoil     + jitter(0.25), ALPHA.soil));
      setTurbidity(v=> lerpToward(v, targets.tTurb     + jitter(1.0),  ALPHA.turbidity));
      setWaterTemp(v=> lerpToward(v, targets.tWaterT   + jitter(0.03), ALPHA.waterTemp));
      setUpLevel(v  => lerpToward(v, targets.tUpLvl    + jitter(0.002), ALPHA.upstreamLevel));
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [targets]);

  // Drive displays (/sky, /river) by rain threshold
  const wasRainingRef = useRef(false);
  useEffect(() => {
    send({ type: "SET_RAIN_LEVEL", value: rain });
    const nowRaining = rain >= RAIN_THRESHOLD;
    if (nowRaining !== wasRainingRef.current) {
      wasRainingRef.current = nowRaining;
      send({ type: "TRIGGER_STATE", state: nowRaining ? "RAIN" : "NORMAL" });
    }
  }, [rain]);

  // AI prediction model
  const etaSec = useMemo(() => etaToFloodSeconds(level, targets.tLvl), [level, targets.tLvl]);

  const timeScore = Number.isFinite(etaSec) ? clamp(1 - etaSec / 60, 0, 1) : 0;
  const levelScore = clamp(level / FLOOD_LEVEL, 0, 1);
  const rainScore  = rain / 100;
  const flowScore  = clamp((flow - BASE.flow) / GAIN.flowRise, 0, 1);

  const likelihood = Math.round(
    100 * (0.40 * timeScore + 0.25 * levelScore + 0.20 * rainScore + 0.15 * flowScore)
  );

  const status =
    level >= FLOOD_LEVEL || rain >= 90 ? "DANGER" :
    level >= 0.85 || rain >= 75 ? "WARNING" :
    level >= 0.70 || rain >= 50 ? "WATCH" : "NORMAL";

  const statusColorMap = {
    NORMAL:  "var(--status-normal)",
    WATCH:   "var(--status-watch)",
    WARNING: "var(--status-warning)",
    DANGER:  "var(--status-danger)",
  } as const;
  const statusColor = statusColorMap[status as keyof typeof statusColorMap];

  // PM Mode (with 20s hold) — unchanged from your fixed version
  const [pm, setPm] = useState<PMState>("idle");
  const rampIntervalRef = useRef<number | null>(null);
  const holdTimeoutRef = useRef<number | null>(null);
  const didStartHoldRef = useRef(false);

  function clearRamp() {
    if (rampIntervalRef.current) { window.clearInterval(rampIntervalRef.current); rampIntervalRef.current = null; }
  }
  function clearHold() {
    if (holdTimeoutRef.current) { window.clearTimeout(holdTimeoutRef.current); holdTimeoutRef.current = null; }
  }
  function resetPM() { clearRamp(); clearHold(); didStartHoldRef.current = false; setPm("idle"); }

  useEffect(() => () => { clearRamp(); clearHold(); }, []);

  const startPMMode = () => {
    resetPM();
    setRain(0);
    setPm("rampingUp");
    send({ type: "SCRIPT", name: "PM_MODE" });

    rampIntervalRef.current = window.setInterval(() => {
      setRain(prev => {
        const next = Math.min(100, prev + 10);
        if (next >= 100) { clearRamp(); setPm("waitingFlood"); }
        return next;
      });
    }, 800);
  };

  useEffect(() => {
    if (pm !== "waitingFlood") return;
    if (!Number.isFinite(etaSec) || etaSec > 0) return;
    if (didStartHoldRef.current) return;

    didStartHoldRef.current = true;
    setPm("holding");
    setRain(100);
    clearHold();
    holdTimeoutRef.current = window.setTimeout(() => {
      setPm("rampingDown");
      clearRamp();
      rampIntervalRef.current = window.setInterval(() => {
        setRain(prev => {
          const next = Math.max(0, prev - 5);
          if (next <= 0) {
            clearRamp();
            didStartHoldRef.current = false;
            setPm("idle");
            send({ type: "SCRIPT", name: "STOP" });
          }
          return next;
        });
      }, 1000);
    }, 20000); // 20s hold
  }, [pm, etaSec]);

  // Toast notification when ETA starts (keep your previous toast code if added)
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastIdRef = useRef(0);
  const etaStartedRef = useRef(false);
  useEffect(() => {
    const timerRunning = Number.isFinite(etaSec) && etaSec > 0;
    if (timerRunning && !etaStartedRef.current) {
      etaStartedRef.current = true;
      const secs = Math.max(1, Math.round(etaSec));
      const id = ++toastIdRef.current;
      setToasts(ts => [
        {
          id,
          title: "Early Flood Warning (Mock)",
          message:
            `Estimated flood in ~${secs}s for Klang River (Klang City). ` +
            `System will send SMS to residents and direct them to nearby PPS.`,
        },
        ...ts
      ]);
      const timeout = window.setTimeout(() => {
        setToasts(ts => ts.filter(t => t.id !== id));
      }, 8000);
      return () => window.clearTimeout(timeout);
    }
    if (!timerRunning) etaStartedRef.current = false;
  }, [etaSec]);
  function dismissToast(id: number) { setToasts(ts => ts.filter(t => t.id !== id)); }

  // ----- Derived values for display -----
  const rainfallRate = rainToMmPerHour(rain);       // mm/h
  const stagePct = Math.round(clamp(level / FLOOD_LEVEL, 0, 1.3) * 100); // % of flood stage
  // quick pseudo cross-section area model (m^2): base 12 + 30 * level(m)
  const areaM2 = 12 + 30 * level;
  const discharge = Math.max(0, areaM2 * flow);     // m^3/s (demo)

  const etaLabel =
    !Number.isFinite(etaSec) ? "No flood expected" :
    etaSec <= 0 ? "Now" : `${Math.max(1, Math.round(etaSec))} s`;

  const likeColor =
    (likelihood >= 85 && "var(--status-danger)") ||
    (likelihood >= 65 && "var(--status-warning)") ||
    (likelihood >= 40 && "var(--status-watch)") || "var(--status-normal)";

  return (
    <>
      {/* --- Compact top row --- */}
      <div className="toprow">
        <section className="panel panel-compact">
          <h3>Klang River (Klang City)</h3>
          <p className="muted">Coordinates: <b>3.046682, 101.446430</b></p>
          <p className="muted">Demo view focused on a Klang river reach. Values below are simulated.</p>
        </section>
        <section className="panel panel-compact">
          <MiniMap lat={3.046682} lng={101.446430} height={120} variant="banner" />
        </section>
      </div>

      {/* --- AI Prediction banner --- */}
      <section className="panel" style={{ marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>AI Flood Prediction</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
          <div>
            <div className="muted">Likelihood</div>
            <div style={{ fontSize: 28, fontWeight: 700, color: likeColor }}>{likelihood}%</div>
          </div>
          <div>
            <div className="muted">Estimated Time to Flood</div>
            <div style={{ fontSize: 28, fontWeight: 700 }}>{etaLabel}</div>
          </div>
          <div>
            <div className="muted">Model Status</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                width: 10, height: 10, borderRadius: 9999, background: "#34d399",
                boxShadow: "0 0 0 0 rgba(52,211,153,0.7)", animation: "pulse 1.8s infinite"
              }}/>
              <span>Running</span>
            </div>
          </div>
        </div>
        <style>{`
          @keyframes pulse {
            0% { box-shadow: 0 0 0 0 rgba(52,211,153,0.7); }
            70% { box-shadow: 0 0 0 12px rgba(52,211,153,0); }
            100% { box-shadow: 0 0 0 0 rgba(52,211,153,0); }
          }
        `}</style>
      </section>

      {/* --- Sensors + Controls (full width) --- */}
      <div className="grid">
        <section className="panel">
          <h2>Sensor Readings</h2>

          <div className="sensor-grid">
            <div className="sensor"><span className="label">Air Temp</span><span className="value">{temp.toFixed(1)} °C</span></div>
            <div className="sensor"><span className="label">Humidity</span><span className="value">{Math.round(hum)} %</span></div>

            <div className="sensor"><span className="label">River Level</span><span className="value">{level.toFixed(2)} m</span></div>
            <div className="sensor"><span className="label">Flow Speed</span><span className="value">{flow.toFixed(2)} m/s</span></div>

            <div className="sensor"><span className="label">Barometric Pressure</span><span className="value">{pressure.toFixed(1)} hPa</span></div>
            <div className="sensor"><span className="label">Wind Speed</span><span className="value">{wind.toFixed(2)} m/s</span></div>

            <div className="sensor"><span className="label">Soil Moisture</span><span className="value">{Math.round(soil)} %</span></div>
            <div className="sensor"><span className="label">Turbidity</span><span className="value">{Math.round(turbidity)} NTU</span></div>

            <div className="sensor"><span className="label">Water Temp</span><span className="value">{waterTemp.toFixed(1)} °C</span></div>
            <div className="sensor"><span className="label">Upstream Level</span><span className="value">{upLevel.toFixed(2)} m</span></div>

            <div className="sensor"><span className="label">Rainfall Rate</span><span className="value">{rainfallRate} mm/h</span></div>
            <div className="sensor"><span className="label">Discharge (Q)</span><span className="value">{discharge.toFixed(1)} m³/s</span></div>

            <div className="sensor"><span className="label">Stage (of flood)</span><span className="value">{stagePct}%</span></div>
            <div className="sensor"><span className="label">Status</span>
              <span className="value" style={{ color: statusColor }}>{status}</span>
            </div>
          </div>
        </section>

        <section className="panel">
          <h2>Rain Intensity</h2>
          <input
            type="range"
            min={0}
            max={100}
            value={rain}
            onChange={(e) => setRain(parseInt(e.target.value))}
            style={{ width: "100%" }}
          />
          <div style={{ marginTop: 8 }}>
            Current: <b>{rain}%</b>{" "}
            {rain >= RAIN_THRESHOLD ? "🌧️ RAIN STATE" : "☀️ NORMAL"}
          </div>

          <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn" onClick={() => setRain(0)}>Clear Sky (0%)</button>
            <button className="btn" onClick={() => setRain(70)}>Threshold (70%)</button>
            <button className="btn" onClick={() => setRain(100)}>Max Rain (100%)</button>
            <button className="btn btn-primary" onClick={startPMMode}>Demo Mode</button>
          </div>

          <p className="muted" style={{ marginTop: 12 }}>
            Open <code>/sky</code> and <code>/river</code> on the LED screens and press <b>F11</b>.
          </p>
        </section>
      </div>

      {/* --- Toasts (bottom-right) --- */}
      <div className="toast-wrap" aria-live="polite" aria-atomic="true">
        {toasts.map(t => (
          <div className="toast" key={t.id}>
            <button className="toast-close" aria-label="Close" onClick={() => dismissToast(t.id)}>×</button>
            <h4 className="toast-title">{t.title}</h4>
            <p className="toast-body">{t.message}</p>
            <div className="toast-actions">
              <span className="pps-chip">Balai MPKK Bukit Kapar</span>
              <span className="pps-chip">SK Sungai Binjai</span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
