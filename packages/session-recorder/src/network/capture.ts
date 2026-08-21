import {
  DEFAULT_BODY_CAP_BYTES,
  DEFAULT_NETWORK_BODY_BUDGET_BYTES,
  type CapturedBody,
  type Degradation,
  type NetworkEvent,
} from '@rewind/session-schema';
import type { RecorderClock } from '../clock';
import { createIdFactory } from '../ids';
import { createRedactor, type Redactor } from './redact';

export interface NetworkCaptureLimits {
  bodyCapBytes: number;
  totalBodyBudgetBytes: number;
}

export interface NetworkCaptureDeps {
  clock: RecorderClock;
  redactor: Redactor;
  limits?: Partial<NetworkCaptureLimits>;
  onDegradation: (kind: Degradation['kind'], detail: string) => void;
  onEvent: () => void;
}

/**
 * Owns the network event array, the redaction pass, and the size budget.
 *
 * The patches (`fetch`, XHR) know how to observe a request; they do not know
 * anything about redaction or budgets. Keeping that here means there is exactly
 * one place a body can enter the archive, and therefore exactly one place to
 * audit when asking "can a secret get in?".
 */
export function createNetworkCapture(deps: NetworkCaptureDeps) {
  const limits: NetworkCaptureLimits = {
    bodyCapBytes: deps.limits?.bodyCapBytes ?? DEFAULT_BODY_CAP_BYTES,
    totalBodyBudgetBytes:
      deps.limits?.totalBodyBudgetBytes ?? DEFAULT_NETWORK_BODY_BUDGET_BYTES,
  };

  const events: NetworkEvent[] = [];
  const nextId = createIdFactory('net');
  let bodyBytesUsed = 0;
  let budgetExhausted = false;

  /**
   * Drop a body once the cumulative budget is gone, keeping the entry itself.
   *
   * Metadata-only is far more useful than stopping capture: a developer can
   * still see that the call happened, its status and its timing, which is most
   * of what a waterfall is for.
   */
  function chargeBudget(body: CapturedBody): CapturedBody {
    if (body.content === null) return body;

    const cost = body.byteLength ?? body.content.length;
    if (budgetExhausted || bodyBytesUsed + cost > limits.totalBodyBudgetBytes) {
      if (!budgetExhausted) {
        budgetExhausted = true;
        deps.onDegradation(
          'network-body-budget',
          `Network body budget of ${Math.round(limits.totalBodyBudgetBytes / 1024 / 1024)}MB reached; keeping metadata only.`,
        );
      }
      return { ...body, content: null, omitted: 'size-budget' };
    }

    bodyBytesUsed += cost;
    return body;
  }

  return {
    events,
    limits,

    get bodyBytesUsed(): number {
      return bodyBytesUsed;
    },

    get budgetExhausted(): boolean {
      return budgetExhausted;
    },

    nextId,

    /**
     * The single entry point into the archive for network data.
     *
     * Redaction happens here, unconditionally, before the entry is pushed —
     * not at the call site, where a future patch could forget to call it.
     */
    record(
      draft: Omit<NetworkEvent, 'id' | 'timestamp'> & { id?: string; timestamp?: number },
    ): void {
      const redactor = deps.redactor;

      const { url, redactedParams } = redactor.redactUrl(draft.url);
      const request = redactor.redactHeaders(draft.request.headers);

      const requestBody = redactBody(redactor, draft.request.body, draft.request.headers);
      const responseHeaders = draft.response
        ? redactor.redactHeaders(draft.response.headers)
        : null;
      const responseBody = draft.response
        ? redactBody(redactor, draft.response.body, draft.response.headers)
        : null;

      const entry: NetworkEvent = {
        id: draft.id ?? nextId(),
        timestamp: draft.timestamp ?? deps.clock.now(),
        source: draft.source,
        method: draft.method,
        url,
        redactedQueryParams: redactedParams,
        request: {
          headers: request.headers,
          redactedHeaders: request.redactedNames,
          body: chargeBudget(requestBody),
        },
        response:
          draft.response && responseHeaders && responseBody
            ? {
                status: draft.response.status,
                statusText: draft.response.statusText,
                headers: responseHeaders.headers,
                redactedHeaders: responseHeaders.redactedNames,
                body: chargeBudget(responseBody),
                opaque: draft.response.opaque,
              }
            : null,
        timing: draft.timing,
        phase: draft.phase,
        error: draft.error,
      };

      const final = redactor.applyHook(entry);
      if (final === null) return;

      events.push(final);
      deps.onEvent();
    },
  };
}

function redactBody(
  redactor: Redactor,
  body: CapturedBody,
  headers: Record<string, string>,
): CapturedBody {
  if (body.content === null) return body;
  const contentType = headers['content-type'] ?? null;
  const { text, redacted } = redactor.redactBody(body.content, contentType);
  return { ...body, content: text, redacted: body.redacted || redacted };
}

export type NetworkCapture = ReturnType<typeof createNetworkCapture>;
export { createRedactor };
