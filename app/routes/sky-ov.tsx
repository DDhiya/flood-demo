import React, { useEffect, useMemo, useRef, useState } from "react";
import VideoBackdrop from "~/components/VideoBackdrop";
import { addSkyListener, type SkyData } from "~/utils/sensorBus";

/* ===================== MOVE OVERLAY HERE ===================== */
const ANCHOR_LEFT = "84%";
const ANCHOR_TOP  = "50%";
const CARD_DX = -340; // negative -> card to the LEFT of the dot
const CARD_DY = -100;
/* ============================================================= */

// Helper: coerce & sanitize incoming payloads (preserve status if provided)
function normalizeSky(input: Partial<SkyData> | undefined, prev: SkyData): SkyData {
  const pct = Number(input?.floodLikelihoodPct);
  const eta = Number(input?.etaSeconds);
  const floodLikelihoodPct = Number.isFinite(pct) ? Math.min(100, Math.max(0, Math.round(pct))) : prev.floodLikelihoodPct;
  const etaSeconds = Number.isFinite(eta) ? Math.max(0, Math.floor(eta)) : prev.etaSeconds;
  const status = (typeof input?.status === "string" ? input!.status : prev.status) as SkyData["status"];
  return { floodLikelihoodPct, etaSeconds, status };
}

// Debounce helper
function useDebounced<T>(value: T, delay = 150) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return v;
}

// Live bus with demo fallback that STOPS once live data arrives
function useSkyFromBusWithDemo(): SkyData {
  const [d, setD] = useState<SkyData>({ floodLikelihoodPct: 10, etaSeconds: 600, status: "NORMAL" as SkyData["status"] });
  const hasLiveRef = useRef(false);

  useEffect(() => {
    const off = addSkyListener((incoming) => {
      hasLiveRef.current = true;
      setD((prev) => normalizeSky(incoming, prev));
    });

    const id = setInterval(() => {
      if (hasLiveRef.current) return; // stop demo once live data is seen
      setD((prev) => {
        const nextPct = Math.max(5, Math.min(70, prev.floodLikelihoodPct + (Math.random() - 0.5) * 2));
        return { ...prev, floodLikelihoodPct: Math.round(nextPct) }; // keep eta high; don't count to 0 in demo
      });
    }, 1000);

    return () => {
      off();
      clearInterval(id);
    };
  }, []);

  return d;
}

function formatEta(sec: number) {
  if (sec <= 0) return "Now";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

export default function SkyOverlayRoute() {
  const raw = useSkyFromBusWithDemo();
  const data = useDebounced(raw, 150);

  // Map control-lite status to colors
  const statusColorMap = {
    NORMAL: "bg-emerald-600/80",
    WATCH: "bg-yellow-500/80",
    WARNING: "bg-orange-500/80",
    DANGER: "bg-red-600/80",
  } as const;

  const badge = {
    label: data.status ?? "NORMAL",
    cls: statusColorMap[data.status as keyof typeof statusColorMap] ?? statusColorMap.NORMAL,
  };

  // Callout SVG sizing based on offsets
  const svgWidth = Math.abs(CARD_DX) + 60;
  const svgHeight = Math.abs(CARD_DY) + 60;
  const toRight = CARD_DX >= 0;
  const toDown  = CARD_DY >= 0;
  const sx = toRight ? 20 : svgWidth - 20;
  const sy = toDown ? 20 : svgHeight - 20;
  const ex = toRight ? svgWidth - 20 : 20;
  const ey = toDown ? svgHeight - 20 : 20;

  return (
    <VideoBackdrop src="/videos/sky-loop.mp4">
      {/* breathing dot animation */}
      <style>{`
        @keyframes breathePulse {
          0%   { transform: scale(1);   opacity: 0.85; box-shadow: 0 0 0 0 rgba(255,122,0,0.7); }
          50%  { transform: scale(1.06); opacity: 1;   box-shadow: 0 0 0 18px rgba(255,122,0,0.0); }
          100% { transform: scale(1);   opacity: 0.85; box-shadow: 0 0 0 0 rgba(255,122,0,0.0); }
      `}</style>

      {/* >>> ANCHOR WRAPPER — positions the whole overlay <<< */}
      <div className="pointer-events-none absolute" style={{ left: ANCHOR_LEFT, top: ANCHOR_TOP }}>
        {/* Big orange breathing dot at the anchor */}
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
          <svg width={svgWidth} height={svgHeight} viewBox={`0 0 ${svgWidth} ${svgHeight}`} className="overflow-visible">
            <defs>
              <linearGradient id="gradSky" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="rgba(255,255,255,0.85)" />
                <stop offset="100%" stopColor="rgba(255,255,255,0.5)" />
              </linearGradient>
            </defs>
            <path
              d={`M ${sx} ${sy}
                  C ${sx + (toRight ? 80 : -80)} ${sy},
                    ${ex - (toRight ? 80 : -80)} ${ey},
                    ${ex} ${ey}`}
              fill="none"
              stroke="url(#gradSky)"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
        </div>

        {/* The CARD — positioned relative to the anchor via offsets */}
        <div
          className="pointer-events-auto absolute w-[320px] max-w-[88vw] rounded-xl border p-4 text-white shadow-xl backdrop-blur"
          style={{
            left: CARD_DX,
            top: CARD_DY,
            background: "rgba(0,0,0,0.30)",
            borderColor: "rgba(255,255,255,0.20)",
          }}
        >
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-semibold uppercase tracking-wider opacity-80">Flood Status</div>
            <span className={`rounded-full px-3 py-1 text-xs font-bold text-white ${badge.cls}`}>
              {badge.label}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div className="opacity-80">Flood Likelihood</div>
            <div className="text-right text-lg font-bold">{data.floodLikelihoodPct}%</div>

            <div className="opacity-80">Estimated Time to Flood</div>
            <div className="text-right font-semibold">
              {data.etaSeconds > 0 ? formatEta(data.etaSeconds) : "—"}
            </div>
          </div>
        </div>
      </div>

      {/* watermark */}
      <div className="absolute bottom-4 right-4">
        <div className="rounded-xl border border-white/15 bg-black/35 px-3 py-2 text-xs text-white opacity-90 backdrop-blur">
          Local demo • /sky-ov
        </div>
      </div>
    </VideoBackdrop>
  );
}
