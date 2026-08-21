import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BODY_KEY_DENYLIST,
  DEFAULT_HEADER_DENYLIST,
  DEFAULT_PATTERN_RULES,
  FIDELITY_PRESETS,
  isSkippedContentType,
} from './constants.js';

describe('isSkippedContentType', () => {
  it.each([
    'image/png',
    'image/svg+xml',
    'video/mp4',
    'audio/mpeg',
    'font/woff2',
    'application/octet-stream',
    'application/pdf',
  ])('skips %s', (type) => {
    expect(isSkippedContentType(type)).toBe(true);
  });

  it.each(['application/json', 'text/html', 'text/plain', 'application/xml'])(
    'stores %s',
    (type) => {
      expect(isSkippedContentType(type)).toBe(false);
    },
  );

  it('ignores charset parameters and casing', () => {
    expect(isSkippedContentType('IMAGE/PNG; charset=utf-8')).toBe(true);
    expect(isSkippedContentType('Application/JSON; charset=utf-8')).toBe(false);
  });

  it('treats an absent content type as storable rather than skippable', () => {
    expect(isSkippedContentType(null)).toBe(false);
    expect(isSkippedContentType(undefined)).toBe(false);
    expect(isSkippedContentType('')).toBe(false);
  });
});

describe('redaction denylists', () => {
  it('are lowercase, so case-insensitive matching is a single toLowerCase', () => {
    for (const list of [DEFAULT_HEADER_DENYLIST, DEFAULT_BODY_KEY_DENYLIST]) {
      for (const entry of list) {
        expect(entry).toBe(entry.toLowerCase());
      }
    }
  });

  it('covers the headers PLAN.md 4.6 names explicitly', () => {
    for (const header of [
      'authorization',
      'cookie',
      'set-cookie',
      'x-api-key',
      'x-auth-token',
      'proxy-authorization',
    ]) {
      expect(DEFAULT_HEADER_DENYLIST).toContain(header);
    }
  });
});

describe('pattern rules', () => {
  const scrub = (input: string): string =>
    DEFAULT_PATTERN_RULES.reduce(
      // Global regexes carry lastIndex state; rebuild per use so a rule cannot
      // silently skip a match because a previous call left the index advanced.
      (acc, rule) =>
        acc.replace(
          new RegExp(rule.pattern.source, rule.pattern.flags),
          rule.replacement,
        ),
      input,
    );

  it('scrubs a JWT', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const out = scrub(jwt);
    expect(out).toBe('[REDACTED:jwt]');
    expect(out).not.toContain('eyJ');
  });

  it('scrubs a bearer token but keeps the scheme visible', () => {
    expect(scrub('Bearer abcdef0123456789ghijkl')).toBe('Bearer [REDACTED]');
  });

  it.each(['4111111111111111', '4111 1111 1111 1111', '4111-1111-1111-1111'])(
    'scrubs card-shaped digits: %s',
    (card) => {
      expect(scrub(card)).not.toContain('4111');
    },
  );

  it('leaves ordinary prose untouched', () => {
    const prose = 'user 42 clicked checkout at 10:31 and saw error 500';
    expect(scrub(prose)).toBe(prose);
  });
});

describe('fidelity presets', () => {
  it('never enables cross-origin iframe capture, which is not possible', () => {
    for (const preset of Object.values(FIDELITY_PRESETS)) {
      expect(preset.recordCrossOriginIframes).toBe(false);
    }
  });

  it('always inlines stylesheets and fonts, at every mode', () => {
    // Dropping either produces the fallback-font / unstyled-replay failure that
    // PLAN.md 5.2 calls out as the fastest way to lose developer trust.
    for (const preset of Object.values(FIDELITY_PRESETS)) {
      expect(preset.inlineStylesheet).toBe(true);
      expect(preset.collectFonts).toBe(true);
    }
  });

  it('samples strictly more finely as fidelity increases', () => {
    const { balanced, high, max } = FIDELITY_PRESETS;
    expect(balanced.mousemoveSampleMs).toBeGreaterThan(high.mousemoveSampleMs);
    expect(high.mousemoveSampleMs).toBeGreaterThan(max.mousemoveSampleMs);
    expect(balanced.checkoutEveryNms).toBeGreaterThan(high.checkoutEveryNms);
    expect(high.checkoutEveryNms).toBeGreaterThan(max.checkoutEveryNms);
  });

  it('only sets canvasFps when canvas is captured per-frame', () => {
    for (const preset of Object.values(FIDELITY_PRESETS)) {
      if (preset.recordCanvas === 'fps') {
        expect(preset.canvasFps).toBeGreaterThan(0);
      } else {
        expect(preset.canvasFps).toBeNull();
      }
    }
  });
});
