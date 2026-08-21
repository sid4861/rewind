import type { CapturedBody, SessionEventBase } from './common.js';

export type NetworkSource = 'fetch' | 'xhr' | 'websocket' | 'resource-timing';

export type NetworkPhase =
  | 'complete'
  | 'failed'
  | 'aborted'
  | 'timeout'
  /** Still in flight when recording stopped. */
  | 'pending';

export interface NetworkRequest {
  headers: Record<string, string>;
  /** Header *names* a redaction rule rewrote. Lets the player show "[REDACTED]"
   *  rather than leaving a developer to wonder whether it was ever sent. */
  redactedHeaders: string[];
  body: CapturedBody;
}

export interface NetworkResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  redactedHeaders: string[];
  body: CapturedBody;
  /** `response.type === 'opaque'` — body is unreadable by design, not missing. */
  opaque: boolean;
}

export interface NetworkTiming {
  /** Epoch ms at request start. Mirrors `timestamp`. */
  startMs: number;
  endMs: number | null;
  durationMs: number | null;
}

export interface NetworkEvent extends SessionEventBase {
  source: NetworkSource;
  method: string;
  /** Absolute. Denylisted query params are already rewritten. */
  url: string;
  redactedQueryParams: string[];
  request: NetworkRequest;
  /** Null when the request never produced a response (failed/aborted/pending). */
  response: NetworkResponse | null;
  timing: NetworkTiming;
  phase: NetworkPhase;
  error: { name: string; message: string } | null;
}
