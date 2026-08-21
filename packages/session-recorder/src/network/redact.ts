import {
  DEFAULT_BODY_KEY_DENYLIST,
  DEFAULT_HEADER_DENYLIST,
  DEFAULT_PATTERN_RULES,
  DEFAULT_QUERY_PARAM_DENYLIST,
  REDACTED_PLACEHOLDER,
  type NetworkEvent,
  type PatternRule,
} from '@rewind/session-schema';

/**
 * Redaction runs at capture time, never at replay time.
 *
 * Once a secret is written into the archive it is out — the zip gets attached
 * to a Slack thread and copied to three laptops. Everything here therefore
 * operates on values *before* they reach the event arrays, and there is
 * deliberately no way to disable it from a fidelity setting.
 */

export interface RedactionConfig {
  captureHeaders: readonly string[] | 'all';
  maskAllInputs: boolean;
  headerDenylist: readonly string[];
  bodyKeyDenylist: readonly string[];
  queryParamDenylist: readonly string[];
  patternRules: readonly PatternRule[];
  /** Returning null drops the entry entirely, e.g. to exclude a whole endpoint. */
  redact?: ((entry: NetworkEvent) => NetworkEvent | null) | undefined;
}

export interface RedactionCounters {
  headers: number;
  bodyKeys: number;
  queryParams: number;
  patterns: number;
  droppedEntries: number;
}

export interface RedactionOptions {
  /**
   * Capture these headers verbatim, despite the built-in denylist.
   *
   * `'all'` disables header redaction entirely. Named headers are also exempt
   * from the pattern scrub, since a bearer token would otherwise be stripped
   * out of a header you explicitly asked to keep.
   *
   * Opt-in, and deliberately awkward: `authorization` and `cookie` are LIVE
   * CREDENTIALS. An archive holding them lets anyone who opens the file act as
   * that tester until the token expires — which is a different risk class from
   * business data, and the reason the default is to drop them.
   */
  captureHeaders?: readonly string[] | 'all';
  /**
   * Mask every form input value. Defaults to true.
   *
   * Setting this false records what testers actually type, passwords included.
   * The widget warns the tester on screen whenever it is off; someone entering
   * a credential is entitled to know it is being recorded.
   */
  maskAllInputs?: boolean;
  headerDenylist?: readonly string[];
  bodyKeyDenylist?: readonly string[];
  queryParamDenylist?: readonly string[];
  patternRules?: readonly PatternRule[];
  redact?: (entry: NetworkEvent) => NetworkEvent | null;
}

/**
 * Denylists are extended by host config, never replaced.
 *
 * `captureHeaders` and `maskAllInputs` are the two exceptions, and they are
 * exceptions on purpose: both REDUCE what is redacted, so both are explicit,
 * both are reported in `meta.json`, and both surface to the tester in the
 * widget. Weakening protection should never be something a config file does
 * quietly.
 */
export function resolveRedactionConfig(options: RedactionOptions = {}): RedactionConfig {
  return {
    captureHeaders:
      options.captureHeaders === 'all'
        ? 'all'
        : (options.captureHeaders ?? []).map((h) => h.toLowerCase()),
    maskAllInputs: options.maskAllInputs ?? true,
    headerDenylist: [
      ...DEFAULT_HEADER_DENYLIST,
      ...(options.headerDenylist ?? []).map((h) => h.toLowerCase()),
    ],
    bodyKeyDenylist: [
      ...DEFAULT_BODY_KEY_DENYLIST,
      ...(options.bodyKeyDenylist ?? []).map((k) => k.toLowerCase()),
    ],
    queryParamDenylist: [
      ...DEFAULT_QUERY_PARAM_DENYLIST,
      ...(options.queryParamDenylist ?? []).map((q) => q.toLowerCase()),
    ],
    patternRules: [...DEFAULT_PATTERN_RULES, ...(options.patternRules ?? [])],
    redact: options.redact,
  };
}

/** Normalizes a key for denylist comparison: `access_token`, `accessToken`, `Access-Token` all match. */
function canonicalKey(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, '');
}

export function createRedactor(config: RedactionConfig) {
  const counters: RedactionCounters = {
    headers: 0,
    bodyKeys: 0,
    queryParams: 0,
    patterns: 0,
    droppedEntries: 0,
  };

  const headerSet = new Set(config.headerDenylist.map(canonicalKey));
  const captureAll = config.captureHeaders === 'all';
  const captureSet = new Set(
    captureAll ? [] : (config.captureHeaders as readonly string[]).map(canonicalKey),
  );
  /** Explicitly requested, so neither the denylist nor the pattern scrub applies. */
  const isCaptured = (name: string): boolean =>
    captureAll || captureSet.has(canonicalKey(name));
  const bodyKeySet = new Set(config.bodyKeyDenylist.map(canonicalKey));
  const queryParamSet = new Set(config.queryParamDenylist.map(canonicalKey));

  function redactHeaders(headers: Record<string, string>): {
    headers: Record<string, string>;
    redactedNames: string[];
  } {
    const out: Record<string, string> = {};
    const redactedNames: string[] = [];

    for (const [name, value] of Object.entries(headers)) {
      if (isCaptured(name)) {
        // Verbatim, including the pattern scrub: stripping the bearer token out
        // of a header the host asked to keep would make the option pointless.
        out[name] = value;
        continue;
      }
      if (headerSet.has(canonicalKey(name))) {
        out[name] = REDACTED_PLACEHOLDER;
        redactedNames.push(name);
        counters.headers += 1;
      } else {
        // A non-denylisted header can still carry a bearer token; the pattern
        // pass is the backstop for headers nobody thought to name.
        out[name] = scrubPatterns(value);
      }
    }
    return { headers: out, redactedNames };
  }

  function redactUrl(rawUrl: string): { url: string; redactedParams: string[] } {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      // Not parseable; fall back to a pattern scrub so a token in a malformed
      // URL is not simply waved through.
      return { url: scrubPatterns(rawUrl), redactedParams: [] };
    }

    const redactedParams: string[] = [];
    for (const name of [...parsed.searchParams.keys()]) {
      if (queryParamSet.has(canonicalKey(name))) {
        parsed.searchParams.set(name, REDACTED_PLACEHOLDER);
        redactedParams.push(name);
        counters.queryParams += 1;
      }
    }

    const url =
      redactedParams.length > 0 ? parsed.toString() : scrubPatterns(parsed.toString());
    return { url, redactedParams };
  }

  /**
   * Value-shaped scrubbing for secrets that appear in free text rather than
   * under a known key.
   *
   * Each rule gets a freshly constructed RegExp: the shared rule objects carry
   * the `g` flag, and a global regex keeps `lastIndex` between calls, so reusing
   * the same instance silently skips matches on every other invocation.
   */
  function scrubPatterns(input: string): string {
    let output = input;
    for (const rule of config.patternRules) {
      const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
      const replaced = output.replace(pattern, rule.replacement);
      if (replaced !== output) counters.patterns += 1;
      output = replaced;
    }
    return output;
  }

  function redactJsonValue(value: unknown, depth = 0): unknown {
    if (depth > 12 || value === null) return value;

    if (Array.isArray(value)) {
      return value.map((item) => redactJsonValue(item, depth + 1));
    }

    if (typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        if (bodyKeySet.has(canonicalKey(key))) {
          out[key] = REDACTED_PLACEHOLDER;
          counters.bodyKeys += 1;
        } else {
          out[key] = redactJsonValue(inner, depth + 1);
        }
      }
      return out;
    }

    if (typeof value === 'string') return scrubPatterns(value);
    return value;
  }

  function redactFormEncoded(input: string): string {
    const params = new URLSearchParams(input);
    let touched = false;
    for (const name of [...params.keys()]) {
      if (bodyKeySet.has(canonicalKey(name))) {
        params.set(name, REDACTED_PLACEHOLDER);
        counters.bodyKeys += 1;
        touched = true;
      }
    }
    const serialized = params.toString();
    return touched ? serialized : scrubPatterns(serialized);
  }

  /**
   * Redact a body by content type.
   *
   * JSON is parsed so denylisted keys can be matched at any depth; anything
   * else falls back to the pattern pass. Unparseable JSON is treated as text
   * rather than dropped — a truncated body is still evidence.
   */
  function redactBody(
    text: string,
    contentType: string | null,
  ): { text: string; redacted: boolean } {
    if (text.length === 0) return { text, redacted: false };

    const before = { ...counters };
    const type = (contentType ?? '').toLowerCase();

    let out: string;
    if (type.includes('json') || looksLikeJson(text)) {
      try {
        out = JSON.stringify(redactJsonValue(JSON.parse(text)));
      } catch {
        out = scrubPatterns(text);
      }
    } else if (type.includes('x-www-form-urlencoded')) {
      out = redactFormEncoded(text);
    } else {
      out = scrubPatterns(text);
    }

    const redacted =
      counters.bodyKeys !== before.bodyKeys || counters.patterns !== before.patterns;
    return { text: out, redacted };
  }

  /** Applies the host's custom hook. Returns null when the entry should be dropped. */
  function applyHook(entry: NetworkEvent): NetworkEvent | null {
    if (!config.redact) return entry;
    const result = config.redact(entry);
    if (result === null) counters.droppedEntries += 1;
    return result;
  }

  /**
   * Whether a key name is denylisted.
   *
   * Exposed because the console serializer must redact while it still knows
   * which strings are keys: once `{password: "x"}` becomes
   * `entries: [["password", …]]`, the name is just another value and key-based
   * redaction walks straight past it.
   */
  function isBodyKeyDenied(key: string): boolean {
    return bodyKeySet.has(canonicalKey(key));
  }

  return {
    redactHeaders,
    redactUrl,
    redactBody,
    scrubPatterns,
    isBodyKeyDenied,
    maskAllInputs: config.maskAllInputs,
    capturedHeaders: (captureAll ? 'all' : [...captureSet]) as string[] | 'all',
    applyHook,
    counters,
    countBodyKeyRedaction: (): void => {
      counters.bodyKeys += 1;
    },
    hasCustomHook: config.redact !== undefined,
  };
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

export type Redactor = ReturnType<typeof createRedactor>;
