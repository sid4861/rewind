import type { FidelityMode, FidelityPreset } from './types/fidelity.js';

/* ------------------------------------------------------------------ *
 * Redaction defaults (PLAN.md 4.6)
 *
 * These are the *defaults*, and they are additive: host config extends
 * them, it never replaces them. Redaction runs at capture time only —
 * once a secret is in the archive it is out, and the archive travels
 * over Slack.
 * ------------------------------------------------------------------ */

/** Matched case-insensitively against header names. */
export const DEFAULT_HEADER_DENYLIST: readonly string[] = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-csrf-token',
  'x-xsrf-token',
];

/** Matched case-insensitively against object keys at any depth. */
export const DEFAULT_BODY_KEY_DENYLIST: readonly string[] = [
  'password',
  'passwd',
  'pwd',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'secret',
  'client_secret',
  'apikey',
  'api_key',
  'authorization',
  'ssn',
  'pan',
  'aadhaar',
  'cardnumber',
  'card_number',
  'cvv',
  'cvc',
  'pin',
];

/** Matched case-insensitively against URL query parameter names. */
export const DEFAULT_QUERY_PARAM_DENYLIST: readonly string[] = [
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'api_key',
  'apikey',
  'key',
  'secret',
  'password',
  'auth',
  'signature',
  'sig',
];

export interface PatternRule {
  name: string;
  pattern: RegExp;
  replacement: string;
}

/**
 * Value-shaped scrubbing, for secrets that appear in free text rather than
 * under a known key. `email` is deliberately not included by default: emails
 * are usually the thing a developer needs to reproduce a bug with.
 */
export const DEFAULT_PATTERN_RULES: readonly PatternRule[] = [
  {
    name: 'jwt',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
    replacement: '[REDACTED:jwt]',
  },
  {
    name: 'bearer-token',
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/gi,
    replacement: 'Bearer [REDACTED]',
  },
  {
    // 13-19 digits, optionally separated by spaces or hyphens. Deliberately
    // broad: a false positive costs a developer one obscured number, a false
    // negative puts a card number in a Slack attachment.
    name: 'card-number',
    pattern: /\b(?:\d[ -]?){13,19}\b/g,
    replacement: '[REDACTED:card]',
  },
  {
    name: 'aws-access-key',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    replacement: '[REDACTED:aws-key]',
  },
];

export const REDACTED_PLACEHOLDER = '[REDACTED]';

/* ------------------------------------------------------------------ *
 * Size and duration limits (PLAN.md 4.7)
 * ------------------------------------------------------------------ */

export const DEFAULT_BODY_CAP_BYTES = 128 * 1024;
export const DEFAULT_NETWORK_BODY_BUDGET_BYTES = 25 * 1024 * 1024;
export const DEFAULT_ASSET_BUDGET_BYTES = 50 * 1024 * 1024;
export const DEFAULT_MAX_DURATION_MS = 30 * 60 * 1000;
export const DEFAULT_MAX_EVENTS = 200_000;
export const DEFAULT_MAX_WS_MESSAGES = 500;
export const DEFAULT_MAX_WS_MESSAGE_BYTES = 8 * 1024;

/** Bodies with these content types are never stored. Prefix-matched on `type/`. */
export const SKIPPED_CONTENT_TYPE_PREFIXES: readonly string[] = [
  'image/',
  'video/',
  'audio/',
  'font/',
];

export const SKIPPED_CONTENT_TYPES: readonly string[] = [
  'application/octet-stream',
  'application/pdf',
  'application/zip',
  'application/x-protobuf',
];

export function isSkippedContentType(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  const normalized = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!normalized) return false;
  return (
    SKIPPED_CONTENT_TYPE_PREFIXES.some((p) => normalized.startsWith(p)) ||
    SKIPPED_CONTENT_TYPES.includes(normalized)
  );
}

/* ------------------------------------------------------------------ *
 * Fidelity presets (PLAN.md 5.1)
 * ------------------------------------------------------------------ */

export const FIDELITY_PRESETS: Record<FidelityMode, FidelityPreset> = {
  balanced: {
    inlineStylesheet: true,
    collectFonts: true,
    inlineImages: false,
    recordCanvas: false,
    canvasFps: null,
    recordCrossOriginIframes: false,
    mousemoveSampleMs: 100,
    scrollSampleMs: 150,
    checkoutEveryNms: 60_000,
  },
  high: {
    inlineStylesheet: true,
    collectFonts: true,
    inlineImages: true,
    recordCanvas: 'snapshot',
    canvasFps: null,
    recordCrossOriginIframes: false,
    mousemoveSampleMs: 50,
    scrollSampleMs: 100,
    checkoutEveryNms: 20_000,
  },
  max: {
    inlineStylesheet: true,
    collectFonts: true,
    inlineImages: true,
    recordCanvas: 'fps',
    canvasFps: 15,
    recordCrossOriginIframes: false,
    mousemoveSampleMs: 20,
    scrollSampleMs: 50,
    checkoutEveryNms: 10_000,
  },
};

export const DEFAULT_FIDELITY_MODE: FidelityMode = 'high';
