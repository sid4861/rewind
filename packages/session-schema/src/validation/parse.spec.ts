import { describe, expect, it } from 'vitest';
import { ARCHIVE_FILES } from '../archive.js';
import { SCHEMA_VERSION } from '../version.js';
import { type ArchiveFileMap, parseArchive, parseManifest } from './parse.js';

function makeFiles(overrides: Partial<Record<string, string>> = {}): ArchiveFileMap {
  const base: ArchiveFileMap = {
    [ARCHIVE_FILES.manifest]: JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      recorder: { name: '@rewind/session-recorder', version: '0.0.0' },
      sessionId: 'sess_abc',
      createdAt: '2026-08-20T10:00:00.000Z',
      fidelity: 'high',
      domStream: { format: 'rrweb', transformed: false },
      counts: {
        dom: 2,
        network: 0,
        console: 0,
        error: 0,
        navigation: 0,
        marker: 0,
        asset: 0,
      },
      files: [
        { path: ARCHIVE_FILES.manifest, bytes: 400 },
        { path: ARCHIVE_FILES.meta, bytes: 700 },
        { path: ARCHIVE_FILES.dom, bytes: 120 },
      ],
    }),
    [ARCHIVE_FILES.meta]: JSON.stringify({
      sessionId: 'sess_abc',
      clock: {
        epochMs: 1_700_000_000_000,
        perfMs: 1_000,
        timeOriginMs: 1_699_999_999_000,
      },
      startedAt: '2026-08-20T10:00:00.000Z',
      endedAt: '2026-08-20T10:00:10.000Z',
      durationMs: 10_000,
      app: {
        name: 'demo',
        version: '1.0.0',
        gitSha: null,
        url: 'http://localhost:3000/',
      },
      environment: {
        userAgent: 'test',
        language: 'en-US',
        timezone: 'UTC',
        browser: { name: 'Chrome', version: '120' },
        os: { name: 'Windows', version: '11' },
        viewport: { width: 1280, height: 800 },
        screen: { width: 1920, height: 1080 },
        devicePixelRatio: 2,
        colorScheme: 'light',
        prefersReducedMotion: false,
      },
      tester: { name: 'QA', note: null },
      markers: [],
      fidelity: 'high',
      redaction: {
        maskAllInputs: true,
        headerDenylist: ['authorization'],
        bodyKeyDenylist: ['password'],
        queryParamDenylist: ['token'],
        patternRules: ['jwt'],
        customHookActive: false,
        counts: {
          headers: 0,
          bodyKeys: 0,
          queryParams: 0,
          patterns: 0,
          droppedEntries: 0,
        },
      },
      degradations: [],
    }),
    [ARCHIVE_FILES.dom]: JSON.stringify([
      {
        type: 4,
        timestamp: 1_700_000_000_000,
        data: { href: '/', width: 1280, height: 800 },
      },
      {
        type: 2,
        timestamp: 1_700_000_000_050,
        data: { node: {}, initialOffset: { top: 0, left: 0 } },
      },
    ]),
  };
  return { ...base, ...overrides } as ArchiveFileMap;
}

describe('parseManifest', () => {
  it('accepts a well-formed manifest', () => {
    const result = parseManifest(makeFiles());
    expect(result.ok).toBe(true);
  });

  it('reports a version mismatch as its own problem kind, before parsing anything else', () => {
    const files = makeFiles({
      [ARCHIVE_FILES.manifest]: JSON.stringify({
        ...JSON.parse(makeFiles()[ARCHIVE_FILES.manifest] as string),
        schemaVersion: SCHEMA_VERSION + 5,
      }),
    });
    const result = parseManifest(files);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0]?.kind).toBe('incompatible-version');
    expect(result.problems[0]?.message).toContain('Update the player');
  });

  it('reports invalid JSON without throwing', () => {
    const result = parseManifest(makeFiles({ [ARCHIVE_FILES.manifest]: '{not json' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0]?.kind).toBe('invalid-json');
  });

  it('reports a missing manifest', () => {
    const files = makeFiles();
    delete files[ARCHIVE_FILES.manifest];
    const result = parseManifest(files);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0]?.kind).toBe('missing-file');
  });
});

describe('parseArchive', () => {
  it('parses an M1-shaped archive with no optional streams', () => {
    const result = parseArchive(makeFiles());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.domEvents).toHaveLength(2);
    // Absent files become empty arrays, so panels render an empty state rather
    // than every consumer branching on undefined.
    expect(result.value.networkEvents).toEqual([]);
    expect(result.value.consoleEvents).toEqual([]);
    expect(result.value.errorEvents).toEqual([]);
    expect(result.value.navigationEvents).toEqual([]);
  });

  it('preserves rrweb payload fields it does not model', () => {
    const result = parseArchive(makeFiles());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [first] = result.value.domEvents;
    expect(first).toMatchObject({ type: 4, data: { href: '/', width: 1280 } });
  });

  it('parses optional streams when present', () => {
    const files = makeFiles({
      [ARCHIVE_FILES.navigation]: JSON.stringify([
        {
          id: 'nav_1',
          timestamp: 1_700_000_000_000,
          kind: 'initial',
          from: null,
          to: '/',
        },
      ]),
    });
    const result = parseArchive(files);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.navigationEvents).toHaveLength(1);
  });

  it('names the offending field when meta is malformed', () => {
    const meta = JSON.parse(makeFiles()[ARCHIVE_FILES.meta] as string) as Record<
      string,
      unknown
    >;
    (meta['environment'] as Record<string, unknown>)['devicePixelRatio'] = 'two';
    const result = parseArchive(
      makeFiles({ [ARCHIVE_FILES.meta]: JSON.stringify(meta) }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const problem = result.problems[0];
    expect(problem?.kind).toBe('schema-mismatch');
    expect(problem && 'issues' in problem ? problem.issues.join() : '').toContain(
      'environment.devicePixelRatio',
    );
  });

  it('rejects a DOM stream that is not an array of events', () => {
    const result = parseArchive(
      makeFiles({ [ARCHIVE_FILES.dom]: JSON.stringify({ nope: true }) }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0]?.path).toBe(ARCHIVE_FILES.dom);
  });
});
