import { useEffect, useRef, useState } from "react";
import { getBus } from "../lib/bus";
import type { FloodAction } from "../lib/types";

const NORMAL = "/videos/river-normal.mp4";
const FLOOD  = "/videos/river-flood.mp4";

export default function River() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"NORMAL" | "RAIN">("NORMAL");

  useEffect(() => {
    const v = videoRef.current!;
    v.autoplay = true;
    v.loop = true;
    v.src = NORMAL;
    v.play().catch(() => {});
  }, []);

  useEffect(() => {
    const bus = getBus();
    bus.onmessage = (ev: MessageEvent<FloodAction>) => {
      const a = ev.data;
      if (a?.type === "TRIGGER_STATE") {
        setState(a.state);
        const v = videoRef.current!;
        const target = a.state === "RAIN" ? FLOOD : NORMAL;
        if (v.src.endsWith(target)) return;
        v.pause();
        v.src = target;
        v.play().catch(() => {});
      }
    };
    return () => bus.close();
  }, []);

  return (
    <div className="fullscreen">
      <video ref={videoRef} />
    </div>
  );
}
