import { z } from 'zod';
import type { SerializedValue } from '../types/console.js';

/* An archive is untrusted input as far as the player is concerned: hand-edited,
 * truncated, or produced by a different recorder build. These schemas exist so
 * that failure is a readable message rather than a crash three layers deep in
 * the Replayer. */

export const clockOriginSchema = z.object({
  epochMs: z.number(),
  perfMs: z.number(),
  timeOriginMs: z.number(),
});

const eventBaseShape = {
  id: z.string(),
  timestamp: z.number(),
};

export const capturedBodySchema = z.object({
  content: z.string().nullable(),
  encoding: z.enum(['utf8', 'base64']),
  byteLength: z.number().nullable(),
  truncated: z.boolean(),
  redacted: z.boolean(),
  omitted: z
    .enum(['content-type', 'size-budget', 'binary', 'stream', 'empty'])
    .nullable(),
});

export const fidelityModeSchema = z.enum(['balanced', 'high', 'max']);

/**
 * DOM events: strict envelope, opaque payload. rrweb owns the `data` shape, and
 * mirroring its union here would break on every rrweb upgrade for no gain — the
 * Replayer rejects malformed payloads anyway. `looseObject` preserves fields we
 * do not know about instead of stripping them.
 */
export const domEventSchema = z.looseObject({
  type: z.number(),
  timestamp: z.number(),
  data: z.unknown(),
});

const headersSchema = z.record(z.string(), z.string());

export const networkEventSchema = z.object({
  ...eventBaseShape,
  source: z.enum(['fetch', 'xhr', 'websocket', 'resource-timing']),
  method: z.string(),
  url: z.string(),
  redactedQueryParams: z.array(z.string()),
  request: z.object({
    headers: headersSchema,
    redactedHeaders: z.array(z.string()),
    body: capturedBodySchema,
  }),
  response: z
    .object({
      status: z.number(),
      statusText: z.string(),
      headers: headersSchema,
      redactedHeaders: z.array(z.string()),
      body: capturedBodySchema,
      opaque: z.boolean(),
    })
    .nullable(),
  timing: z.object({
    startMs: z.number(),
    endMs: z.number().nullable(),
    durationMs: z.number().nullable(),
  }),
  phase: z.enum(['complete', 'failed', 'aborted', 'timeout', 'pending']),
  error: z.object({ name: z.string(), message: z.string() }).nullable(),
});

export const serializedValueSchema: z.ZodType<SerializedValue> = z.lazy(() =>
  z.union([
    z.object({
      kind: z.literal('primitive'),
      value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    }),
    z.object({ kind: z.literal('undefined') }),
    z.object({ kind: z.literal('bigint'), value: z.string() }),
    z.object({ kind: z.literal('symbol'), description: z.string().nullable() }),
    z.object({ kind: z.literal('function'), name: z.string() }),
    z.object({
      kind: z.literal('error'),
      name: z.string(),
      message: z.string(),
      stack: z.string().nullable(),
    }),
    z.object({ kind: z.literal('date'), iso: z.string() }),
    z.object({ kind: z.literal('regexp'), source: z.string(), flags: z.string() }),
    z.object({ kind: z.literal('node'), nodeName: z.string(), preview: z.string() }),
    z.object({
      kind: z.literal('array'),
      items: z.array(serializedValueSchema),
      length: z.number(),
      truncated: z.boolean(),
    }),
    z.object({
      kind: z.literal('object'),
      ctor: z.string().nullable(),
      entries: z.array(z.tuple([z.string(), serializedValueSchema])),
      truncated: z.boolean(),
    }),
    z.object({
      kind: z.literal('map'),
      entries: z.array(z.tuple([serializedValueSchema, serializedValueSchema])),
      size: z.number(),
      truncated: z.boolean(),
    }),
    z.object({
      kind: z.literal('set'),
      values: z.array(serializedValueSchema),
      size: z.number(),
      truncated: z.boolean(),
    }),
    z.object({ kind: z.literal('circular'), path: z.string() }),
    z.object({ kind: z.literal('max-depth') }),
  ]),
);

export const consoleEventSchema = z.object({
  ...eventBaseShape,
  level: z.enum(['log', 'info', 'warn', 'error', 'debug']),
  args: z.array(serializedValueSchema),
  stack: z.string().nullable(),
});

export const sessionErrorEventSchema = z.object({
  ...eventBaseShape,
  source: z.enum(['window-error', 'unhandledrejection']),
  name: z.string(),
  message: z.string(),
  stack: z.string().nullable(),
  file: z.string().nullable(),
  line: z.number().nullable(),
  column: z.number().nullable(),
});

export const navigationEventSchema = z.object({
  ...eventBaseShape,
  kind: z.enum(['initial', 'pushState', 'replaceState', 'popstate', 'hashchange']),
  from: z.string().nullable(),
  to: z.string(),
});

export const markerSchema = z.object({ ...eventBaseShape, label: z.string() });

export const redactionReportSchema = z.object({
  maskAllInputs: z.boolean(),
  capturedHeaders: z.union([z.array(z.string()), z.literal('all')]).default([]),
  headerDenylist: z.array(z.string()),
  bodyKeyDenylist: z.array(z.string()),
  queryParamDenylist: z.array(z.string()),
  patternRules: z.array(z.string()),
  customHookActive: z.boolean(),
  counts: z.object({
    headers: z.number(),
    bodyKeys: z.number(),
    queryParams: z.number(),
    patterns: z.number(),
    droppedEntries: z.number(),
  }),
});

export const sessionMetaSchema = z.object({
  sessionId: z.string(),
  clock: clockOriginSchema,
  startedAt: z.string(),
  endedAt: z.string(),
  durationMs: z.number(),
  app: z.object({
    name: z.string(),
    version: z.string().nullable(),
    gitSha: z.string().nullable(),
    url: z.string(),
  }),
  environment: z.object({
    userAgent: z.string(),
    language: z.string(),
    timezone: z.string(),
    browser: z.object({ name: z.string(), version: z.string() }),
    os: z.object({ name: z.string(), version: z.string() }),
    viewport: z.object({ width: z.number(), height: z.number() }),
    screen: z.object({ width: z.number(), height: z.number() }),
    devicePixelRatio: z.number(),
    colorScheme: z.enum(['light', 'dark']),
    prefersReducedMotion: z.boolean(),
  }),
  tester: z.object({ name: z.string().nullable(), note: z.string().nullable() }),
  markers: z.array(markerSchema),
  fidelity: fidelityModeSchema,
  redaction: redactionReportSchema,
  degradations: z.array(
    z.object({
      at: z.number(),
      kind: z.enum([
        'network-body-budget',
        'asset-budget',
        'event-cap',
        'duration-cap',
        'memory-pressure',
      ]),
      detail: z.string(),
    }),
  ),
});

export const sessionManifestSchema = z.object({
  schemaVersion: z.number(),
  recorder: z.object({ name: z.string(), version: z.string() }),
  sessionId: z.string(),
  createdAt: z.string(),
  fidelity: fidelityModeSchema,
  domStream: z.discriminatedUnion('transformed', [
    z.object({ format: z.literal('rrweb'), transformed: z.literal(false) }),
    z.object({
      format: z.literal('rrweb'),
      transformed: z.literal(true),
      assetRefScheme: z.literal('rewind-asset-v1'),
    }),
  ]),
  counts: z.object({
    dom: z.number(),
    network: z.number(),
    console: z.number(),
    error: z.number(),
    navigation: z.number(),
    marker: z.number(),
    asset: z.number(),
  }),
  files: z.array(z.object({ path: z.string(), bytes: z.number() })),
});
