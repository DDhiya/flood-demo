import type { FloodAction } from "./types";

const CHANNEL = "flood-sim";

export function getBus() {
  return new BroadcastChannel(CHANNEL);
}

export function send(action: FloodAction) {
  const ch = getBus();
  ch.postMessage(action);
  ch.close();
}
