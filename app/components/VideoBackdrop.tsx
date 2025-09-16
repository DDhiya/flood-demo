import React from "react";

type Props = {
  src: string;
  className?: string;
  children?: React.ReactNode; // overlays
  autoPlay?: boolean;
  muted?: boolean;
  loop?: boolean;
};

export default function VideoBackdrop({
  src,
  className = "",
  children,
  autoPlay = true,
  muted = true,
  loop = true,
}: Props) {
  return (
    <div className={`relative h-screen w-screen overflow-hidden bg-black ${className}`}>
      <video
        className="absolute inset-0 h-full w-full object-cover"
        src={src}
        autoPlay={autoPlay}
        muted={muted}
        loop={loop}
        playsInline
      />
      {/* Overlay slot */}
      <div className="pointer-events-none absolute inset-0">{children}</div>
    </div>
  );
}
