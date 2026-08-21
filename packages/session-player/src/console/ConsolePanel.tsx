import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type {
  ConsoleEvent,
  ConsoleLevel,
  SerializedValue,
  SessionErrorEvent,
} from '@rewind/session-schema';

/**
 * Console and error output, merged into one stream.
 *
 * Merged deliberately: an uncaught error and the `console.error` that preceded
 * it are one story, and making a developer flip between two tabs to read it in
 * order is exactly the friction this tool exists to remove.
 */

export interface LogLine {
  id: string;
  timestamp: number;
  offsetMs: number;
  level: ConsoleLevel | 'uncaught';
  args: SerializedValue[];
  stack: string | null;
  /** Present for uncaught errors and rejections. */
  origin: string | null;
}

export function toLogLines(
  consoleEvents: ConsoleEvent[],
  errorEvents: SessionErrorEvent[],
  startEpochMs: number,
): LogLine[] {
  const fromConsole: LogLine[] = consoleEvents.map((event) => ({
    id: event.id,
    timestamp: event.timestamp,
    offsetMs: event.timestamp - startEpochMs,
    level: event.level,
    args: event.args,
    stack: event.stack,
    origin: null,
  }));

  const fromErrors: LogLine[] = errorEvents.map((event) => ({
    id: event.id,
    timestamp: event.timestamp,
    offsetMs: event.timestamp - startEpochMs,
    level: 'uncaught',
    args: [
      { kind: 'error', name: event.name, message: event.message, stack: event.stack },
    ],
    stack: event.stack,
    origin:
      event.source === 'unhandledrejection'
        ? 'Unhandled promise rejection'
        : [event.file, event.line, event.column].filter(Boolean).join(':') ||
          'window.onerror',
  }));

  return [...fromConsole, ...fromErrors].sort((a, b) => a.timestamp - b.timestamp);
}

/** Compact inline rendering of a serialized value. */
function preview(value: SerializedValue, depth = 0): string {
  switch (value.kind) {
    case 'primitive':
      return typeof value.value === 'string' && depth > 0
        ? `"${value.value}"`
        : String(value.value);
    case 'undefined':
      return 'undefined';
    case 'bigint':
      return value.value;
    case 'symbol':
      return `Symbol(${value.description ?? ''})`;
    case 'function':
      return `ƒ ${value.name}()`;
    case 'error':
      return `${value.name}: ${value.message}`;
    case 'date':
      return value.iso;
    case 'regexp':
      return `/${value.source}/${value.flags}`;
    case 'node':
      return value.preview;
    case 'circular':
      return `[Circular → ${value.path}]`;
    case 'max-depth':
      return '[…]';
    case 'array':
      return depth > 1
        ? `Array(${value.length})`
        : `[${value.items.map((i) => preview(i, depth + 1)).join(', ')}${value.truncated ? ', …' : ''}]`;
    case 'map':
      return `Map(${value.size})`;
    case 'set':
      return `Set(${value.size})`;
    case 'object': {
      const label = value.ctor ? `${value.ctor} ` : '';
      if (depth > 1) return `${label}{…}`;
      const body = value.entries
        .slice(0, 5)
        .map(([key, v]) => `${key}: ${preview(v, depth + 1)}`)
        .join(', ');
      return `${label}{${body}${value.entries.length > 5 || value.truncated ? ', …' : ''}}`;
    }
    default:
      return '';
  }
}

function ValueNode({ value, name }: { value: SerializedValue; name?: string }) {
  const [open, setOpen] = useState(false);
  const expandable =
    value.kind === 'object' ||
    value.kind === 'array' ||
    value.kind === 'map' ||
    value.kind === 'set';

  const children: Array<[string, SerializedValue]> =
    value.kind === 'object'
      ? value.entries
      : value.kind === 'array'
        ? value.items.map((item, i) => [String(i), item])
        : value.kind === 'set'
          ? value.values.map((item, i) => [String(i), item])
          : value.kind === 'map'
            ? value.entries.map(([k, v], i) => [`${i}: ${preview(k)}`, v])
            : [];

  const className =
    value.kind === 'circular'
      ? 'log-circular'
      : value.kind === 'error'
        ? 'log-error-val'
        : value.kind === 'primitive' && value.value === null
          ? 'log-null'
          : '';

  return (
    <span className="log-node">
      {name !== undefined && <span className="log-key">{name}: </span>}
      <span
        className={`log-val ${className}${expandable ? ' expandable' : ''}`}
        onClick={expandable ? () => setOpen((o) => !o) : undefined}
      >
        {expandable && <span className="log-caret">{open ? '▾' : '▸'}</span>}
        {preview(value)}
      </span>
      {open && (
        <span className="log-children">
          {children.map(([key, child], i) => (
            <span className="log-child" key={`${key}-${i}`}>
              <ValueNode value={child} name={key} />
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

const LEVEL_ORDER: Array<ConsoleLevel | 'uncaught'> = [
  'log',
  'info',
  'warn',
  'error',
  'debug',
  'uncaught',
];

export function ConsolePanel({
  lines,
  currentMs,
  onJump,
}: {
  lines: LogLine[];
  currentMs: number;
  onJump: (offsetMs: number) => void;
}) {
  const [levels, setLevels] = useState<Set<string>>(new Set(LEVEL_ORDER));
  const [query, setQuery] = useState('');
  const [follow, setFollow] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return lines.filter((line) => {
      if (!levels.has(line.level)) return false;
      if (!needle) return true;
      return line.args.some((arg) => preview(arg).toLowerCase().includes(needle));
    });
  }, [lines, levels, query]);

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 26,
    overscan: 15,
  });

  const currentIndex = useMemo(() => {
    if (!follow) return -1;
    let found = -1;
    for (let i = 0; i < visible.length; i += 1) {
      if ((visible[i] as LogLine).offsetMs <= currentMs) found = i;
      else break;
    }
    return found;
  }, [follow, visible, currentMs]);

  const lastScrolled = useRef(-1);
  useEffect(() => {
    if (!follow || currentIndex < 0 || currentIndex === lastScrolled.current) return;
    lastScrolled.current = currentIndex;
    virtualizer.scrollToIndex(currentIndex, { align: 'center' });
  }, [follow, currentIndex, virtualizer]);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const line of lines) map.set(line.level, (map.get(line.level) ?? 0) + 1);
    return map;
  }, [lines]);

  const toggleLevel = (level: string): void =>
    setLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });

  return (
    <div className="net">
      <div className="net-filters">
        <input
          className="net-search"
          type="search"
          placeholder="Filter output"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Filter console output"
        />
        {LEVEL_ORDER.map((level) => (
          <button
            key={level}
            className={`level-chip ${level}${levels.has(level) ? ' on' : ''}`}
            onClick={() => toggleLevel(level)}
          >
            {level}
            {counts.get(level) ? (
              <span className="level-count">{counts.get(level)}</span>
            ) : null}
          </button>
        ))}
        <label className="net-toggle follow">
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => setFollow(e.target.checked)}
          />
          Follow playback
        </label>
      </div>

      <div className="net-scroll" ref={scrollRef}>
        {visible.length === 0 ? (
          <div className="net-empty">
            {lines.length === 0
              ? 'No console output was captured in this session.'
              : 'Nothing matches these filters.'}
          </div>
        ) : (
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const line = visible[item.index] as LogLine;
              const isFuture = follow && line.offsetMs > currentMs;
              return (
                <div
                  key={line.id}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  className={[
                    'log-line',
                    line.level,
                    item.index === currentIndex ? 'current' : '',
                    isFuture ? 'future' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  <button
                    className="log-time mono"
                    onClick={() => onJump(line.offsetMs)}
                    title="Jump to this moment"
                  >
                    {(line.offsetMs / 1000).toFixed(1)}s
                  </button>
                  <span className={`log-level ${line.level}`}>{line.level}</span>
                  <span className="log-args">
                    {line.args.map((arg, i) => (
                      <ValueNode key={i} value={arg} />
                    ))}
                    {line.origin && <span className="log-origin">{line.origin}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="net-foot">
        <span>
          {visible.length} of {lines.length} lines
        </span>
      </div>
    </div>
  );
}
