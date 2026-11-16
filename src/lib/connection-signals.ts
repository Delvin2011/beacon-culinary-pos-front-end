// What the till learns about the connection, from the /health ping and from ordinary requests.
// A module-level channel so authFetch (in AuthProvider) can report without depending on where the
// ConnectionProvider is mounted. Nobody listening (outside the POS) means the reports are dropped.

import { RequestTimeoutError } from "@/lib/net";

export type OfflineReason = "no-connection" | "server-down";

// ok: the server answered and can record sales. fail: no answer, or the server says it can't record sales.
export type ConnectionSignal = { ok: true } | { ok: false; reason: OfflineReason };

type Listener = (signal: ConnectionSignal) => void;
const listeners = new Set<Listener>();

export function subscribeConnectionSignals(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function reportConnectionSignal(signal: ConnectionSignal): void {
  listeners.forEach((listener) => listener(signal));
}

// An ordinary API response. 502/503/504 mean the API (or its database) can't serve; a 500 is one endpoint's bug,
// and every other status proves the server is reachable.
export function signalForResponse(status: number): ConnectionSignal | null {
  if (status === 502 || status === 503 || status === 504) return { ok: false, reason: "server-down" };
  if (status === 500) return null;
  return { ok: true };
}

// A thrown request error. A caller cancelling its own request says nothing about the connection.
export function signalForError(err: unknown): ConnectionSignal | null {
  if (err instanceof RequestTimeoutError || err instanceof TypeError) return { ok: false, reason: "no-connection" };
  return null;
}

// GET /health (contract section 6): 200 UP is online; 503 DOWN can't record sales; no answer is offline.
// A 404 means this server has no /health yet (before the O1 backend is deployed): ignored, so the till falls
// back to the outcomes of ordinary requests.
export function signalForHealth(status: number): ConnectionSignal | null {
  if (status === 200) return { ok: true };
  if (status === 503) return { ok: false, reason: "server-down" };
  if (status === 502 || status === 504) return { ok: false, reason: "server-down" };
  return null;
}
