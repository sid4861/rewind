import type { SessionEventBase } from './common.js';

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

/**
 * Output of the safe console serializer.
 *
 * Deliberately a tagged union rather than `unknown`: `JSON.stringify` throws on
 * circular references and flattens DOM nodes to `{}`, and both are things
 * testers log constantly. The tags are what let the player render a node as
 * `<div.card>` and a cycle as a clickable back-reference.
 */
export type SerializedValue =
  | { kind: 'primitive'; value: string | number | boolean | null }
  | { kind: 'undefined' }
  | { kind: 'bigint'; value: string }
  | { kind: 'symbol'; description: string | null }
  | { kind: 'function'; name: string }
  | { kind: 'error'; name: string; message: string; stack: string | null }
  | { kind: 'date'; iso: string }
  | { kind: 'regexp'; source: string; flags: string }
  | { kind: 'node'; nodeName: string; preview: string }
  | { kind: 'array'; items: SerializedValue[]; length: number; truncated: boolean }
  | {
      kind: 'object';
      ctor: string | null;
      entries: Array<[string, SerializedValue]>;
      truncated: boolean;
    }
  | {
      kind: 'map';
      entries: Array<[SerializedValue, SerializedValue]>;
      size: number;
      truncated: boolean;
    }
  | { kind: 'set'; values: SerializedValue[]; size: number; truncated: boolean }
  /** Points back to an already-serialized value; `path` is where. */
  | { kind: 'circular'; path: string }
  | { kind: 'max-depth' };

export interface ConsoleEvent extends SessionEventBase {
  level: ConsoleLevel;
  args: SerializedValue[];
  stack: string | null;
}
