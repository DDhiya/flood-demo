// Simple BroadcastChannel-based bus for sharing sensor data between routes.
// In /control, call publishSensors({...}). In /river-ov, call useSensorsFromBus().

export type RiverSensors = {
  waterLevelM: number;
  flowRateMs: number;
  rainfallMmHr: number;
  tempC: number;
  humidityPct: number;
  pressureHpa: number;
};

const CH_NAME = "fs-flood-sensors";
let channel: BroadcastChannel | null = null;

function getChannel() {
  if (typeof window === "undefined") return null;
  if (!channel) {
    try {
      channel = new BroadcastChannel(CH_NAME);
    } catch {
      channel = null; // older browsers—could polyfill with storage events if needed
    }
  }
  return channel;
}

export function publishSensors(data: RiverSensors) {
  const ch = getChannel();
  if (ch) ch.postMessage({ kind: "river", data });
  // Optional: also mirror to localStorage for very old browsers:
  try {
    localStorage.setItem("fs_river_sensors", JSON.stringify({ t: Date.now(), data }));
    window.dispatchEvent(new StorageEvent("storage", { key: "fs_river_sensors" }));
  } catch {}
}

export function addSensorsListener(cb: (d: RiverSensors) => void) {
  const ch = getChannel();
  const onMsg = (e: MessageEvent) => {
    if (e?.data?.kind === "river" && e.data.data) cb(e.data.data as RiverSensors);
  };
  ch?.addEventListener("message", onMsg);

  // Fallback: pick up last snapshot in localStorage immediately
  try {
    const raw = localStorage.getItem("fs_river_sensors");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.data) cb(parsed.data as RiverSensors);
    }
  } catch {}

  // Fallback listener via storage events (different tabs)
  const onStorage = (e: StorageEvent) => {
    if (e.key === "fs_river_sensors" && e.newValue) {
      try {
        const parsed = JSON.parse(e.newValue);
        if (parsed?.data) cb(parsed.data as RiverSensors);
      } catch {}
    }
  };
  window.addEventListener("storage", onStorage);

  return () => {
    ch?.removeEventListener("message", onMsg);
    window.removeEventListener("storage", onStorage);
  };
}

// --- Add types for Sky overlay ---
export type SkyData = {
  floodLikelihoodPct: number;
  etaSeconds: number;
  status?: "NORMAL" | "WATCH" | "WARNING" | "DANGER";
};

// --- Publishers ---
export function publishSky(data: SkyData) {
  const ch = getChannel();
  if (ch) ch.postMessage({ kind: "sky", data });
  try {
    localStorage.setItem("fs_sky", JSON.stringify({ t: Date.now(), data }));
    window.dispatchEvent(new StorageEvent("storage", { key: "fs_sky" }));
  } catch {}
}

// --- Listeners ---
export function addSkyListener(cb: (d: SkyData) => void) {
  const ch = getChannel();
  const onMsg = (e: MessageEvent) => {
    if (e?.data?.kind === "sky" && e.data.data) cb(e.data.data as SkyData);
  };
  ch?.addEventListener("message", onMsg);

  // pick up last snapshot immediately
  try {
    const raw = localStorage.getItem("fs_sky");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.data) cb(parsed.data as SkyData);
    }
  } catch {}

  const onStorage = (e: StorageEvent) => {
    if (e.key === "fs_sky" && e.newValue) {
      try {
        const parsed = JSON.parse(e.newValue);
        if (parsed?.data) cb(parsed.data as SkyData);
      } catch {}
    }
  };
  window.addEventListener("storage", onStorage);

  return () => {
    ch?.removeEventListener("message", onMsg);
    window.removeEventListener("storage", onStorage);
  };
}

