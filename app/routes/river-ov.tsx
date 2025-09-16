import React, { useEffect, useMemo, useState } from "react";
import VideoBackdrop from "~/components/VideoBackdrop";
import { addSensorsListener, type RiverSensors } from "~/utils/sensorBus";

/* ===================== MOVE OVERLAY HERE ===================== */
// Position of the big dot (anchor), relative to viewport.
const ANCHOR_LEFT = "16%"; // e.g., "16%", "240px"
const ANCHOR_TOP  = "18%"; // e.g., "18%", "120px"

// Offset of the card from the dot (positive = right/down, negative = left/up)
const CARD_DX = 220; // px
const CARD_DY = -40; // px
/* ============================================================= */

type SensorData = RiverSensors;

// Demo fallback if /control isn't publishing yet
function useSensorsFromBusWithDemo(): SensorData {
  const [d, setD] = useState<SensorData>({
    waterLevelM: 1.62,
    flowRateMs: 0.82,
    rainfallMmHr: 1.8,
    tempC: 28.6,
    humidityPct: 74,
    pressureHpa: 1006,
  });

  useEffect(() => {
    // Listen to live data from /control
    const off = addSensorsListener((incoming) => setD(incoming));
    // Gentle demo drift if nothing arrives
    const demoId = setInterval(() => {
      setD((prev) => ({
        waterLevelM: +(prev.waterLevelM + (Math.random() - 0.5) * 0.02).toFixed(2),
        flowRateMs: +(prev.flowRateMs + (Math.random() - 0.5) * 0.04).toFixed(2),
        rainfallMmHr: Math.max(0, +(prev.rainfallMmHr + (Math.random() - 0.5) * 0.5).toFixed(1)),
        tempC: +(prev.tempC + (Math.random() - 0.5) * 0.2).toFixed(1),
        humidityPct: Math.min(100, Math.max(0, Math.round(prev.humidityPct + (Math.random() - 0.5) * 2))),
        pressureHpa: Math.round(prev.pressureHpa + (Math.random() - 0.5) * 1.5),
      }));
    }, 1500);

    return () => {
      off();
      clearInterval(demoId);
    };
  }, []);

  return d;
}

export default function RiverOverlayRoute() {
  const data = useSensorsFromBusWithDemo();

  const dischargeProxy = useMemo(
    () => +(data.flowRateMs * data.waterLevelM).toFixed(2),
    [data.flowRateMs, data.waterLevelM]
  );

  // Compute absolute pixel values for the SVG callout container
  // We’ll derive numeric left/top for the anchor to size the SVG nicely.
  // CSS calc for parsing is unreliable in JS; we’ll let the SVG just cover a fixed box relative to anchor.
  const svgWidth = Math.abs(CARD_DX) + 60;  // padding for curve
  const svgHeight = Math.abs(CARD_DY) + 60; // padding for curve

  // Determine direction for the callout curve
  const toRight = CARD_DX >= 0;
  const toDown  = CARD_DY >= 0;

  // SVG start (dot center) and end (card near-corner) in local SVG coords
  const sx = toRight ? 20 : svgWidth - 20;
  const sy = toDown ? 20 : svgHeight - 20;
  const ex = toRight ? svgWidth - 20 : 20;
  const ey = toDown ? svgHeight - 20 : 20;

  return (
    <VideoBackdrop src="/videos/river-loop.mp4">
      {/* Breathing CSS (scoped) */}
      <style>{`
        @keyframes breathePulse {
          0%   { transform: scale(1);   opacity: 0.85; box-shadow: 0 0 0 0 rgba(255,122,0,0.7); }
          50%  { transform: scale(1.06); opacity: 1;   box-shadow: 0 0 0 18px rgba(255,122,0,0.0); }
          100% { transform: scale(1);   opacity: 0.85; box-shadow: 0 0 0 0 rgba(255,122,0,0.0); }
        }
      `}</style>

      {/* ===== Movable overlay anchor (dot + callout + card) ===== */}
      <div
        className="pointer-events-none absolute"
        style={{ left: ANCHOR_LEFT, top: ANCHOR_TOP }}
      >
        {/* Big orange breathing dot */}
        <div
          className="h-8 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            background: "#ff7a00",
            animation: "breathePulse 2.2s ease-in-out infinite",
            filter: "drop-shadow(0 0 8px rgba(255,122,0,0.75))",
          }}
        />

        {/* Callout SVG from dot -> card */}
        <div
          className="absolute"
          style={{
            left: toRight ? 0 : -svgWidth,
            top: toDown ? 0 : -svgHeight,
            width: svgWidth,
            height: svgHeight,
          }}
        >
          <svg
            width={svgWidth}
            height={svgHeight}
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="overflow-visible"
          >
            <defs>
              <linearGradient id="grad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="rgba(255,255,255,0.85)" />
                <stop offset="100%" stopColor="rgba(255,255,255,0.5)" />
              </linearGradient>
            </defs>
            {/* Soft guide curve */}
            <path
              d={`M ${sx} ${sy}
                  C ${sx + (toRight ? 80 : -80)} ${sy},
                    ${ex - (toRight ? 80 : -80)} ${ey},
                    ${ex} ${ey}`}
              fill="none"
              stroke="url(#grad)"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
        </div>

        {/* The card itself (70% transparency background) */}
        <div
          className="pointer-events-auto absolute w-[300px] max-w-[88vw] rounded-xl border p-4 text-white shadow-xl backdrop-blur"
          style={{
            left: CARD_DX,
            top: CARD_DY,
            background: "rgba(0,0,0,0.70)",    // 30% transparent (70% opacity)
            borderColor: "rgba(255,255,255,0.20)",
          }}
        >
          <div className="mb-2 text-sm font-semibold uppercase tracking-wide opacity-80">
            River Sensors
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <div className="opacity-80">Water Level</div>
            <div className="text-right font-semibold">{data.waterLevelM.toFixed(2)} m</div>

            <div className="opacity-80">Flow Speed</div>
            <div className="text-right font-semibold">{data.flowRateMs.toFixed(2)} m/s</div>

            <div className="opacity-80">Rainfall</div>
            <div className="text-right font-semibold">{data.rainfallMmHr.toFixed(1)} mm/h</div>

            <div className="opacity-80">Temperature</div>
            <div className="text-right font-semibold">{data.tempC.toFixed(1)} °C</div>

            <div className="opacity-80">Humidity</div>
            <div className="text-right font-semibold">{data.humidityPct.toFixed(1)}%</div>

            <div className="opacity-80">Pressure</div>
            <div className="text-right font-semibold">{data.pressureHpa.toFixed(1)} hPa</div>

            <div className="opacity-80">Discharge (proxy)</div>
            <div className="text-right font-semibold">
              {(data.flowRateMs * data.waterLevelM).toFixed(2)} m²/s
            </div>
          </div>
        </div>
      </div>

      {/* Bottom-right watermark / status */}
      <div className="absolute bottom-4 right-4">
        <div className="rounded-xl border border-white/15 bg-black/35 px-3 py-2 text-xs text-white opacity-90 backdrop-blur">
          Local demo • /river-ov
        </div>
      </div>
    </VideoBackdrop>
  );
}
