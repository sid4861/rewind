import {
  REDACTED_PLACEHOLDER as REDACTED,
  type SerializedValue,
} from '@rewind/session-schema';

/**
 * Safe console argument serializer.
 *
 * `JSON.stringify` is not usable here and this is not a theoretical concern:
 * it throws outright on circular references, flattens DOM nodes to `{}`,
 * silently drops functions and `undefined`, and turns a BigInt into a
 * TypeError. Testers log all of those constantly, and a serializer that throws
 * takes the host app's `console.log` down with it.
 *
 * Depth, breadth and string length are all capped, because one `console.log` of
 * a Redux store should not become a megabyte of archive.
 */

export interface SerializeLimits {
  maxDepth: number;
  maxEntries: number;
  maxStringLength: number;
}

/**
 * Redaction applied *during* serialization.
 *
 * It has to happen here rather than as a pass over the output: once an object
 * becomes `entries: [["password", …]]` the key is just a string in an array,
 * and any key-based redactor downstream will miss it entirely.
 */
export interface SerializeRedaction {
  isRedactedKey(key: string): boolean;
  scrubString(value: string): string;
  onRedacted?: () => void;
}

export const DEFAULT_SERIALIZE_LIMITS: SerializeLimits = {
  maxDepth: 6,
  maxEntries: 100,
  maxStringLength: 8 * 1024,
};

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}… (${text.length} chars)`;
}

function describeNode(node: Node): SerializedValue {
  const name = node.nodeName.toLowerCase();

  if (node.nodeType === 3) {
    return {
      kind: 'node',
      nodeName: '#text',
      preview: truncate(node.textContent ?? '', 80),
    };
  }

  if (node instanceof Element) {
    const id = node.id ? `#${node.id}` : '';
    const classes =
      typeof node.className === 'string' && node.className
        ? `.${node.className.trim().split(/\s+/).slice(0, 3).join('.')}`
        : '';
    return { kind: 'node', nodeName: name, preview: `<${name}${id}${classes}>` };
  }

  return { kind: 'node', nodeName: name, preview: `<${name}>` };
}

export function serializeValue(
  value: unknown,
  limits: SerializeLimits = DEFAULT_SERIALIZE_LIMITS,
  redaction?: SerializeRedaction,
): SerializedValue {
  const scrub = (text: string): string =>
    redaction ? redaction.scrubString(text) : text;
  /*
   * Cycle detection tracks ancestors on the *current path* only, mapped to the
   * path at which each was reached. A value that legitimately appears twice in
   * a tree (the same object under two keys) is serialized twice; only a real
   * cycle is cut. Tracking everything seen instead would mangle ordinary shared
   * references into confusing back-pointers.
   */
  const walk = (
    input: unknown,
    depth: number,
    path: string,
    ancestors: Map<object, string>,
  ): SerializedValue => {
    if (depth > limits.maxDepth) return { kind: 'max-depth' };

    if (input === null) return { kind: 'primitive', value: null };
    if (input === undefined) return { kind: 'undefined' };

    switch (typeof input) {
      case 'string':
        return {
          kind: 'primitive',
          value: scrub(truncate(input, limits.maxStringLength)),
        };
      case 'number':
        // NaN and ±Infinity are not JSON-representable; keep them readable.
        return Number.isFinite(input)
          ? { kind: 'primitive', value: input }
          : { kind: 'primitive', value: String(input) };
      case 'boolean':
        return { kind: 'primitive', value: input };
      case 'bigint':
        return { kind: 'bigint', value: `${input.toString()}n` };
      case 'symbol':
        return { kind: 'symbol', description: input.description ?? null };
      case 'function':
        return { kind: 'function', name: input.name || '(anonymous)' };
      default:
        break;
    }

    const object = input as object;

    // Report the path of the ancestor being pointed *back to*, not where the
    // cycle was found. The reader can already see where they are; what they
    // need is where it loops to.
    const cycleTarget = ancestors.get(object);
    if (cycleTarget !== undefined) return { kind: 'circular', path: cycleTarget };

    if (input instanceof Error) {
      return {
        kind: 'error',
        name: input.name,
        message: truncate(input.message, limits.maxStringLength),
        stack: input.stack ? truncate(input.stack, limits.maxStringLength) : null,
      };
    }

    if (input instanceof Date) {
      return {
        kind: 'date',
        iso: Number.isNaN(input.getTime()) ? 'Invalid Date' : input.toISOString(),
      };
    }

    if (input instanceof RegExp) {
      return { kind: 'regexp', source: input.source, flags: input.flags };
    }

    if (typeof Node !== 'undefined' && input instanceof Node) return describeNode(input);

    const nextAncestors = new Map(ancestors).set(object, path);

    if (Array.isArray(input)) {
      const items = input
        .slice(0, limits.maxEntries)
        .map((item, i) => walk(item, depth + 1, `${path}[${i}]`, nextAncestors));
      return {
        kind: 'array',
        items,
        length: input.length,
        truncated: input.length > limits.maxEntries,
      };
    }

    if (typeof Map !== 'undefined' && input instanceof Map) {
      const entries: Array<[SerializedValue, SerializedValue]> = [];
      let i = 0;
      for (const [key, val] of input) {
        if (i >= limits.maxEntries) break;
        entries.push([
          walk(key, depth + 1, `${path}.key${i}`, nextAncestors),
          walk(val, depth + 1, `${path}.value${i}`, nextAncestors),
        ]);
        i += 1;
      }
      return {
        kind: 'map',
        entries,
        size: input.size,
        truncated: input.size > limits.maxEntries,
      };
    }

    if (typeof Set !== 'undefined' && input instanceof Set) {
      const values: SerializedValue[] = [];
      let i = 0;
      for (const val of input) {
        if (i >= limits.maxEntries) break;
        values.push(walk(val, depth + 1, `${path}[${i}]`, nextAncestors));
        i += 1;
      }
      return {
        kind: 'set',
        values,
        size: input.size,
        truncated: input.size > limits.maxEntries,
      };
    }

    // Own enumerable properties only. Walking the prototype chain drags in
    // framework internals and, on some host objects, throws on access.
    let keys: string[];
    try {
      keys = Object.keys(object);
    } catch {
      return { kind: 'object', ctor: null, entries: [], truncated: false };
    }

    const entries: Array<[string, SerializedValue]> = [];
    for (const key of keys.slice(0, limits.maxEntries)) {
      if (redaction?.isRedactedKey(key)) {
        redaction.onRedacted?.();
        entries.push([key, { kind: 'primitive', value: REDACTED }]);
        continue;
      }

      let raw: unknown;
      try {
        raw = (object as Record<string, unknown>)[key];
      } catch {
        // A getter that throws must not take the whole log line down.
        raw = '[getter threw]';
      }
      entries.push([key, walk(raw, depth + 1, `${path}.${key}`, nextAncestors)]);
    }

    const ctor = (object.constructor?.name ?? null) as string | null;
    return {
      kind: 'object',
      ctor: ctor === 'Object' ? null : ctor,
      entries,
      truncated: keys.length > limits.maxEntries,
    };
  };

  try {
    return walk(value, 0, '$', new Map());
  } catch (error) {
    // Absolute backstop. Nothing the host app logs may ever throw out of here.
    return {
      kind: 'error',
      name: 'SerializationError',
      message: error instanceof Error ? error.message : 'Could not serialize value',
      stack: null,
    };
  }
}

export function serializeArgs(
  args: readonly unknown[],
  limits: SerializeLimits = DEFAULT_SERIALIZE_LIMITS,
  redaction?: SerializeRedaction,
): SerializedValue[] {
  return args.map((arg) => serializeValue(arg, limits, redaction));
}
