import { describe, expect, it } from 'vitest';
import { serializeArgs, serializeValue } from './serialize';

/**
 * Every case here is something `JSON.stringify` gets wrong or throws on, and
 * every one of them is something a tester logs routinely. A serializer that
 * throws takes the host app's console down with it.
 */

describe('primitives', () => {
  it.each([
    ['string', 'hello', { kind: 'primitive', value: 'hello' }],
    ['number', 42, { kind: 'primitive', value: 42 }],
    ['boolean', true, { kind: 'primitive', value: true }],
    ['null', null, { kind: 'primitive', value: null }],
  ])('serializes %s', (_label, input, expected) => {
    expect(serializeValue(input)).toEqual(expected);
  });

  it('distinguishes undefined from null, which JSON.stringify erases', () => {
    expect(serializeValue(undefined)).toEqual({ kind: 'undefined' });
  });

  it('keeps NaN and Infinity readable instead of turning them into null', () => {
    expect(serializeValue(NaN)).toEqual({ kind: 'primitive', value: 'NaN' });
    expect(serializeValue(Infinity)).toEqual({ kind: 'primitive', value: 'Infinity' });
  });

  it('handles BigInt, which JSON.stringify throws on', () => {
    expect(serializeValue(123n)).toEqual({ kind: 'bigint', value: '123n' });
  });

  it('handles symbols and functions, which JSON.stringify drops', () => {
    expect(serializeValue(Symbol('tag'))).toEqual({ kind: 'symbol', description: 'tag' });
    expect(serializeValue(function named() {})).toEqual({
      kind: 'function',
      name: 'named',
    });
    expect(serializeValue(() => {})).toMatchObject({ kind: 'function' });
  });
});

describe('circular references', () => {
  it('does not throw, and marks where the cycle points back to', () => {
    const node: Record<string, unknown> = { name: 'root' };
    node['self'] = node;

    const result = serializeValue(node);
    expect(result.kind).toBe('object');
    if (result.kind !== 'object') return;

    const self = result.entries.find(([key]) => key === 'self')?.[1];
    expect(self).toEqual({ kind: 'circular', path: '$' });
  });

  it('survives mutual recursion', () => {
    const a: Record<string, unknown> = {};
    const b: Record<string, unknown> = { a };
    a['b'] = b;
    expect(() => serializeValue(a)).not.toThrow();
  });

  it('does NOT mistake a repeated (but acyclic) reference for a cycle', () => {
    // The same object under two keys is legitimate and should serialize twice.
    const shared = { id: 7 };
    const result = serializeValue({ left: shared, right: shared });
    expect(JSON.stringify(result)).not.toContain('circular');
  });
});

describe('errors, dates and regexes', () => {
  it('keeps an Error’s name, message and stack', () => {
    const error = new TypeError('bad input');
    const result = serializeValue(error);
    expect(result).toMatchObject({
      kind: 'error',
      name: 'TypeError',
      message: 'bad input',
    });
  });

  it('serializes a Date to ISO and survives an invalid one', () => {
    expect(serializeValue(new Date('2026-08-20T10:00:00Z'))).toEqual({
      kind: 'date',
      iso: '2026-08-20T10:00:00.000Z',
    });
    expect(serializeValue(new Date('nope'))).toEqual({
      kind: 'date',
      iso: 'Invalid Date',
    });
  });

  it('keeps a RegExp readable rather than flattening it to {}', () => {
    expect(serializeValue(/ab+c/gi)).toEqual({
      kind: 'regexp',
      source: 'ab+c',
      flags: 'gi',
    });
  });
});

describe('collections', () => {
  it('serializes Map and Set, which JSON.stringify flattens to {}', () => {
    const map = serializeValue(new Map([['a', 1]]));
    expect(map).toMatchObject({ kind: 'map', size: 1 });

    const set = serializeValue(new Set([1, 2, 3]));
    expect(set).toMatchObject({ kind: 'set', size: 3 });
  });

  it('caps array length and says it truncated', () => {
    const result = serializeValue(Array.from({ length: 500 }, (_, i) => i));
    expect(result.kind).toBe('array');
    if (result.kind !== 'array') return;
    expect(result.length).toBe(500);
    expect(result.truncated).toBe(true);
    expect(result.items.length).toBeLessThan(500);
  });
});

describe('limits', () => {
  it('stops at max depth rather than recursing forever', () => {
    let deep: Record<string, unknown> = { end: true };
    for (let i = 0; i < 40; i += 1) deep = { nested: deep };
    const serialized = JSON.stringify(serializeValue(deep));
    expect(serialized).toContain('max-depth');
  });

  it('truncates a huge string instead of storing megabytes', () => {
    const result = serializeValue('x'.repeat(100_000));
    expect(result.kind).toBe('primitive');
    if (result.kind !== 'primitive') return;
    expect(String(result.value).length).toBeLessThan(20_000);
    expect(String(result.value)).toContain('100000 chars');
  });
});

describe('hostile objects', () => {
  it('does not let a throwing getter break the log line', () => {
    const hostile = {
      get boom(): never {
        throw new Error('getter exploded');
      },
      safe: 'kept',
    };

    const result = serializeValue(hostile);
    expect(result.kind).toBe('object');
    const serialized = JSON.stringify(result);
    expect(serialized).toContain('getter threw');
    expect(serialized).toContain('kept');
  });

  it('serializes an object with a null prototype', () => {
    const bare = Object.create(null) as Record<string, unknown>;
    bare['x'] = 1;
    expect(() => serializeValue(bare)).not.toThrow();
  });

  it('records the constructor name for class instances', () => {
    class Order {
      constructor(readonly id = 'ORD-1') {}
    }
    expect(serializeValue(new Order())).toMatchObject({ kind: 'object', ctor: 'Order' });
  });
});

describe('serializeArgs', () => {
  it('maps a whole console argument list', () => {
    const args = serializeArgs(['message', 42, { a: 1 }, undefined]);
    expect(args).toHaveLength(4);
    expect(args[3]).toEqual({ kind: 'undefined' });
  });
});

describe('inline redaction', () => {
  const redaction = {
    isRedactedKey: (key: string) =>
      ['password', 'cardnumber'].includes(key.toLowerCase()),
    scrubString: (value: string) => value.replace(/eyJ[\w.-]+/g, '[REDACTED:jwt]'),
  };

  /**
   * The hole this closes: redacting the serializer's *output* cannot work,
   * because `{password: 'x'}` becomes `entries: [['password', …]]` and the key
   * is then just a string inside an array. Key-based redaction walks past it,
   * and the secret ships. Redaction has to happen while keys are still keys.
   */
  it('redacts a denylisted key without ever reading its value', () => {
    const result = serializeValue(
      { password: 'hunter2-CORRECT-horse', harmless: 'kept' },
      undefined,
      redaction,
    );
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('hunter2');
    expect(serialized).toContain('kept');
  });

  it('redacts at depth, not just at the top level', () => {
    const result = serializeValue(
      { outer: { inner: { cardNumber: '4111111111111111' } } },
      undefined,
      redaction,
    );
    expect(JSON.stringify(result)).not.toContain('4111111111111111');
  });

  it('scrubs secret-shaped strings that are not under a denylisted key', () => {
    const result = serializeValue(
      { note: 'token is eyJhbGciOiJIUzI1NiJ9.abc.def' },
      undefined,
      redaction,
    );
    expect(JSON.stringify(result)).not.toContain('eyJhbGci');
  });

  it('counts each redaction, so meta.json can prove redaction ran', () => {
    let count = 0;
    serializeValue({ password: 'a', cardNumber: 'b', ok: 'c' }, undefined, {
      ...redaction,
      onRedacted: () => {
        count += 1;
      },
    });
    expect(count).toBe(2);
  });

  it('leaves values alone when no redaction is configured', () => {
    const result = serializeValue({ password: 'plain' });
    expect(JSON.stringify(result)).toContain('plain');
  });
});
