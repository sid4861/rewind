import { useMemo, useState } from 'react';
import { REDACTED_PLACEHOLDER } from '@rewind/session-schema';

/**
 * Collapsible JSON viewer.
 *
 * Redacted and truncated values get explicit visual treatment rather than being
 * rendered as ordinary strings: a developer staring at `"[REDACTED]"` in plain
 * text will eventually try to debug it as a real value (PLAN.md 6.4).
 */

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function Value({ value }: { value: Json }) {
  if (value === null) return <span className="json-null">null</span>;
  if (typeof value === 'boolean')
    return <span className="json-bool">{String(value)}</span>;
  if (typeof value === 'number') return <span className="json-num">{value}</span>;
  if (value === REDACTED_PLACEHOLDER || String(value).startsWith('[REDACTED')) {
    return <span className="json-redacted">{String(value)}</span>;
  }
  return <span className="json-str">&quot;{String(value)}&quot;</span>;
}

function Node({
  name,
  value,
  depth,
  defaultOpen,
}: {
  name: string | null;
  value: Json;
  depth: number;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const isArray = Array.isArray(value);
  const isObject = !isArray && typeof value === 'object' && value !== null;

  if (!isArray && !isObject) {
    return (
      <div className="json-line" style={{ paddingLeft: depth * 14 }}>
        {name !== null && <span className="json-key">{name}:</span>}
        <Value value={value} />
      </div>
    );
  }

  const entries: Array<[string, Json]> = isArray
    ? (value as Json[]).map((item, i) => [String(i), item])
    : Object.entries(value as Record<string, Json>);

  const summary = isArray ? `Array(${entries.length})` : `{${entries.length}}`;

  return (
    <div>
      <div
        className="json-line json-branch"
        style={{ paddingLeft: depth * 14 }}
        onClick={() => setOpen((o) => !o)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setOpen((o) => !o);
        }}
      >
        <span className="json-caret">{open ? '▾' : '▸'}</span>
        {name !== null && <span className="json-key">{name}:</span>}
        <span className="json-summary">{summary}</span>
      </div>
      {open &&
        entries.map(([key, child]) => (
          <Node
            key={key}
            name={key}
            value={child}
            depth={depth + 1}
            // Only the first two levels open by default: deeper than that and
            // a large payload floods the drawer on open.
            defaultOpen={depth < 1}
          />
        ))}
    </div>
  );
}

export function JsonTree({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const parsed = useMemo<{ ok: true; value: Json } | { ok: false }>(() => {
    try {
      return { ok: true, value: JSON.parse(text) as Json };
    } catch {
      return { ok: false };
    }
  }, [text]);

  const copy = (): void => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };

  return (
    <div className="json-tree">
      <div className="json-toolbar">
        <button className="mini" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {parsed.ok ? (
        <Node name={null} value={parsed.value} depth={0} defaultOpen />
      ) : (
        // Not JSON, or truncated mid-structure. Showing the raw text is more
        // useful than an error: a truncated body is still evidence.
        <pre className="json-raw">{text}</pre>
      )}
    </div>
  );
}
