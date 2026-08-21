import { describe, expect, it } from 'vitest';
import type { DomEvent } from '@rewind/session-schema';
import { ASSET_REF_PREFIX, externalizeAssets } from './assets';

/**
 * The deduplication claim, proved rather than asserted.
 *
 * The whole justification for this machinery is that an avatar rendered twenty
 * times should cost one copy, not twenty. If that is not true, the extra zip
 * entries and the reference indirection are pure overhead.
 */

/** A data URI large enough to clear the externalization threshold. */
function dataUri(mime: string, filler: string, size = 8000): string {
  const body = btoa(filler.repeat(Math.ceil(size / filler.length)).slice(0, size));
  return `data:${mime};base64,${body}`;
}

function imgEvent(srcs: string[]): DomEvent {
  return {
    type: 3,
    timestamp: 1,
    data: {
      source: 0,
      adds: srcs.map((src, i) => ({
        parentId: 1,
        nextId: null,
        node: { id: 100 + i, tagName: 'img', attributes: { src } },
      })),
    },
  } as unknown as DomEvent;
}

describe('deduplication', () => {
  it('stores one copy of an asset referenced many times', async () => {
    const uri = dataUri('image/png', 'AAAA');
    const result = await externalizeAssets([
      imgEvent(Array.from({ length: 20 }, () => uri)),
    ]);

    expect(result.transformed).toBe(true);
    expect(result.report.count).toBe(1);
    expect(result.report.references).toBe(20);
    expect(Object.keys(result.assets)).toHaveLength(1);
  });

  it('stores distinct assets separately', async () => {
    const a = dataUri('image/png', 'AAAA');
    const b = dataUri('image/png', 'BBBB');
    const result = await externalizeAssets([imgEvent([a, b, a, b])]);

    expect(result.report.count).toBe(2);
    expect(result.report.references).toBe(4);
  });

  it('removes the payload from the event stream entirely', async () => {
    const uri = dataUri('image/png', 'AAAA');
    const events = [imgEvent([uri, uri, uri])];
    const before = JSON.stringify(events).length;

    const result = await externalizeAssets(events);
    const after = JSON.stringify(result.events).length;

    expect(after).toBeLessThan(before / 2);
    expect(JSON.stringify(result.events)).not.toContain('data:image/png;base64');
    expect(JSON.stringify(result.events)).toContain(ASSET_REF_PREFIX);
  });
});

describe('file naming', () => {
  it('names files by content hash with a real extension', async () => {
    const result = await externalizeAssets([imgEvent([dataUri('image/png', 'AAAA')])]);
    const [path] = Object.keys(result.assets);
    expect(path).toMatch(/^assets\/[0-9a-f]+\.png$/);
  });

  it('derives the extension from the mime type', async () => {
    const result = await externalizeAssets([
      imgEvent([dataUri('image/jpeg', 'AAAA'), dataUri('font/woff2', 'BBBB')]),
    ]);
    const paths = Object.keys(result.assets).join(' ');
    expect(paths).toContain('.jpg');
    expect(paths).toContain('.woff2');
  });

  it('gives identical bytes the same name regardless of where they appeared', async () => {
    const uri = dataUri('image/png', 'AAAA');
    const one = await externalizeAssets([imgEvent([uri])]);
    const two = await externalizeAssets([imgEvent(['x', uri])]);
    expect(Object.keys(one.assets)).toEqual(Object.keys(two.assets));
  });
});

describe('what is left alone', () => {
  it('leaves small data URIs inline — a separate zip entry would cost more', async () => {
    const tiny = 'data:image/png;base64,iVBORw0KGgo=';
    const result = await externalizeAssets([imgEvent([tiny])]);

    expect(result.transformed).toBe(false);
    expect(result.assets).toEqual({});
    expect(JSON.stringify(result.events)).toContain(tiny);
  });

  it('leaves ordinary URLs alone', async () => {
    const result = await externalizeAssets([
      imgEvent(['/static/logo.png', 'https://x.test/a.png']),
    ]);
    expect(result.transformed).toBe(false);
  });

  it('leaves a malformed data URI intact rather than dropping it', async () => {
    // A broken image in the replay beats a broken archive.
    const broken = `data:image/png;base64,${'!'.repeat(9000)}`;
    const result = await externalizeAssets([imgEvent([broken])]);
    expect(JSON.stringify(result.events)).toContain(broken);
  });

  it('reports transformed:false when there is nothing to externalize', async () => {
    const result = await externalizeAssets([imgEvent([])]);
    expect(result.transformed).toBe(false);
    expect(result.report.count).toBe(0);
  });
});

describe('budget', () => {
  it('stops copying past the budget and says so', async () => {
    const degradations: string[] = [];
    const result = await externalizeAssets(
      [imgEvent([dataUri('image/png', 'AAAA'), dataUri('image/png', 'BBBB')])],
      { budgetBytes: 9000, onDegradation: (_k, detail) => degradations.push(detail) },
    );

    expect(result.report.count).toBe(1);
    expect(result.report.skipped).toBe(1);
    expect(degradations[0]).toContain('budget');
  });

  it('leaves over-budget assets INLINE rather than blanking them', async () => {
    const second = dataUri('image/png', 'BBBB');
    const result = await externalizeAssets(
      [imgEvent([dataUri('image/png', 'AAAA'), second])],
      { budgetBytes: 9000 },
    );
    // Fidelity is preserved; only the size optimisation is skipped.
    expect(JSON.stringify(result.events)).toContain(second);
  });
});

describe('accounting', () => {
  it('reports bytes stored and bytes removed from the stream', async () => {
    const uri = dataUri('image/png', 'AAAA');
    const result = await externalizeAssets([imgEvent([uri, uri, uri])]);

    expect(result.report.bytes).toBeGreaterThan(0);
    // Three references removed, one copy stored: the saving must exceed what
    // a single copy costs, or the transform is not worth doing.
    expect(result.report.inlineBytesSaved).toBeGreaterThan(result.report.bytes);
  });
});
