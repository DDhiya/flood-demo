import React from "react";

export function OverlayCard({
  title,
  children,
  className = "",
}: {
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`pointer-events-auto rounded-xl border border-white/15 bg-black/35 p-4 text-white shadow-xl backdrop-blur ${className}`}
    >
      {title ? <div className="mb-2 text-sm font-semibold uppercase tracking-wide opacity-80">{title}</div> : null}
      <div className="space-y-2">{children}</div>
    </div>
  );
}
