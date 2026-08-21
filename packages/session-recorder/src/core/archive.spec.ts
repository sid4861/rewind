import { describe, expect, it } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import {
  ARCHIVE_FILES,
  SCHEMA_VERSION,
  type DomEvent,
  type SessionMeta,
} from '@rewind/session-schema';
import { parseArchive } from '@rewind/session-schema/validation';
import { buildArchive, type ArchiveStreams } from './archive';

/**
 * Empty streams by default, overridden per test.
 *
 * Written this way because every milestone that adds a stream would otherwise
 * break every call site in this file — which it did, three times.
 */
function streams(overrides: Partial<ArchiveStreams> = {}): ArchiveStreams {
  return {
    domEvents: [],
    networkEvents: [],
    consoleEvents: [],
    errorEvents: [],
    navigationEvents: [],
    ...overrides,
  };
}

/**
 * The round trip that matters: what the recorder writes must be exactly what the
 * player's validator accepts. These two packages are developed independently and
 * only meet inside a zip file, so this is the seam most likely to drift.
 */

const clock = {
  epochMs: 1_777_000_000_000,
  perfMs: 1_000,
  timeOriginMs: 1_776_999_999_000,
};

const meta: SessionMeta = {
  sessionId: 'sess_abcdef123456',
  clock,
  startedAt: new Date(clock.epochMs).toISOString(),
  endedAt: new Date(clock.epochMs + 9_000).toISOString(),
  durationMs: 9_000,
  app: {
    name: 'northwind-ops',
    version: '0.0.0',
    gitSha: null,
    url: 'http://localhost:4300/orders',
  },
  environment: {
    userAgent: 'test-agent',
    language: 'en-US',
    timezone: 'UTC',
    browser: { name: 'Chrome', version: '120' },
    os: { name: 'Windows', version: '10/11' },
    viewport: { width: 1280, height: 720 },
    screen: { width: 1920, height: 1080 },
    devicePixelRatio: 2,
    colorScheme: 'light',
    prefersReducedMotion: false,
  },
  tester: { name: 'Siddharth', note: 'checkout flow' },
  markers: [
    { id: 'mrk_0', timestamp: clock.epochMs + 4_200, label: 'bug happened here' },
  ],
  fidelity: 'high',
  redaction: {
    maskAllInputs: true,
    capturedHeaders: [],
    headerDenylist: ['authorization'],
    bodyKeyDenylist: ['password'],
    queryParamDenylist: ['token'],
    patternRules: ['jwt'],
    customHookActive: false,
    counts: { headers: 0, bodyKeys: 0, queryParams: 0, patterns: 0, droppedEntries: 0 },
  },
  degradations: [],
};

const domEvents = [
  {
    type: 4,
    timestamp: clock.epochMs,
    data: { href: '/orders', width: 1280, height: 720 },
  },
  {
    type: 2,
    timestamp: clock.epochMs + 40,
    data: { node: { id: 1 }, initialOffset: { top: 0, left: 0 } },
  },
  {
    type: 3,
    timestamp: clock.epochMs + 1_500,
    data: { source: 3, id: 12, x: 0, y: 200 },
  },
] as unknown as DomEvent[];

describe('archive round trip', () => {
  it('produces a zip the schema validator accepts', async () => {
    const archive = await buildArchive(meta, streams({ domEvents }));
    const bytes = new Uint8Array(await archive.blob.arrayBuffer());
    const unzipped = unzipSync(bytes);

    const files = Object.fromEntries(
      Object.entries(unzipped).map(([path, data]) => [path, strFromU8(data)]),
    );

    const parsed = parseArchive(files);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.value.domEvents).toHaveLength(3);
    expect(parsed.value.meta.markers[0]?.label).toBe('bug happened here');
    // Streams M1 does not capture must parse as empty arrays, not blow up.
    expect(parsed.value.networkEvents).toEqual([]);
    expect(parsed.value.consoleEvents).toEqual([]);
  });

  it('writes exactly the three M1 files', async () => {
    const archive = await buildArchive(meta, streams({ domEvents }));
    const unzipped = unzipSync(new Uint8Array(await archive.blob.arrayBuffer()));
    expect(Object.keys(unzipped).sort()).toEqual(
      [ARCHIVE_FILES.dom, ARCHIVE_FILES.manifest, ARCHIVE_FILES.meta].sort(),
    );
  });

  it('records accurate counts and the untransformed DOM stream discriminant', async () => {
    const archive = await buildArchive(meta, streams({ domEvents }));
    expect(archive.manifest.schemaVersion).toBe(SCHEMA_VERSION);
    expect(archive.manifest.counts.dom).toBe(3);
    expect(archive.manifest.counts.marker).toBe(1);
    // M1 emits raw rrweb; M5 asset externalization flips this.
    expect(archive.manifest.domStream).toEqual({ format: 'rrweb', transformed: false });
  });

  it('lists every written file with a non-zero byte count', async () => {
    const archive = await buildArchive(meta, streams({ domEvents }));
    const unzipped = unzipSync(new Uint8Array(await archive.blob.arrayBuffer()));
    for (const entry of archive.manifest.files) {
      expect(unzipped[entry.path]).toBeDefined();
      expect(entry.bytes).toBeGreaterThan(0);
    }
    expect(archive.manifest.files).toHaveLength(3);
  });

  it('names the file so it sorts by app then time, with no filesystem-hostile characters', async () => {
    const archive = await buildArchive(meta, streams({ domEvents }));
    expect(archive.fileName).toMatch(
      /^session-northwind-ops-[\d-]+T[\d-]+Z-[a-z0-9]{6}\.zip$/,
    );
    expect(archive.fileName).not.toMatch(/[:]/);
  });

  it('survives an empty session without producing a corrupt archive', async () => {
    const archive = await buildArchive({ ...meta, markers: [] }, streams());
    const unzipped = unzipSync(new Uint8Array(await archive.blob.arrayBuffer()));
    const files = Object.fromEntries(
      Object.entries(unzipped).map(([path, data]) => [path, strFromU8(data)]),
    );
    const parsed = parseArchive(files);
    expect(parsed.ok).toBe(true);
    expect(archive.manifest.counts.dom).toBe(0);
  });
});
