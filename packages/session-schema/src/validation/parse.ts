import type { SessionArchive } from '../types/archive-shape.js';
import { checkCompatibility } from '../version.js';
import {
  consoleEventSchema,
  domEventSchema,
  navigationEventSchema,
  networkEventSchema,
  sessionErrorEventSchema,
  sessionManifestSchema,
  sessionMetaSchema,
} from './schemas.js';
import { z } from 'zod';
import { ARCHIVE_FILES } from '../archive.js';

export type ArchiveProblem =
  | { kind: 'missing-file'; path: string; message: string }
  | { kind: 'invalid-json'; path: string; message: string }
  | { kind: 'schema-mismatch'; path: string; message: string; issues: string[] }
  | { kind: 'incompatible-version'; path: string; message: string };

export type ParseResult<T> =
  { ok: true; value: T } | { ok: false; problems: ArchiveProblem[] };

/** Raw file contents keyed by path within the zip, as the unzip worker yields them. */
export type ArchiveFileMap = Record<string, string>;

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });
}

function parseJsonFile(
  files: ArchiveFileMap,
  path: string,
  required: boolean,
): { ok: true; value: unknown } | { ok: false; problem: ArchiveProblem } | null {
  const raw = files[path];
  if (raw === undefined) {
    if (!required) return null;
    return {
      ok: false,
      problem: {
        kind: 'missing-file',
        path,
        message: `Archive is missing ${path}.`,
      },
    };
  }
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch (cause) {
    return {
      ok: false,
      problem: {
        kind: 'invalid-json',
        path,
        message: `${path} is not valid JSON: ${(cause as Error).message}`,
      },
    };
  }
}

/**
 * Validate the manifest alone.
 *
 * Split out because the player checks schema compatibility *before* parsing the
 * DOM stream — a version mismatch should surface as a clear message in under a
 * second, not after megabytes of futile parsing.
 */
export function parseManifest(
  files: ArchiveFileMap,
): ParseResult<z.infer<typeof sessionManifestSchema>> {
  const read = parseJsonFile(files, ARCHIVE_FILES.manifest, true);
  if (read === null) return { ok: false, problems: [] };
  if (!read.ok) return { ok: false, problems: [read.problem] };

  const parsed = sessionManifestSchema.safeParse(read.value);
  if (!parsed.success) {
    return {
      ok: false,
      problems: [
        {
          kind: 'schema-mismatch',
          path: ARCHIVE_FILES.manifest,
          message: `${ARCHIVE_FILES.manifest} does not match the expected shape.`,
          issues: formatIssues(parsed.error),
        },
      ],
    };
  }

  const compat = checkCompatibility(parsed.data.schemaVersion);
  if (!compat.compatible) {
    return {
      ok: false,
      problems: [
        {
          kind: 'incompatible-version',
          path: ARCHIVE_FILES.manifest,
          message: compat.message,
        },
      ],
    };
  }

  return { ok: true, value: parsed.data };
}

/**
 * Parse a whole archive.
 *
 * Optional streams (network/console/error/navigation) are absent from M1
 * archives by design; a missing file parses to `[]` so panels render an empty
 * state rather than branching on existence.
 */
export function parseArchive(files: ArchiveFileMap): ParseResult<SessionArchive> {
  const problems: ArchiveProblem[] = [];

  const manifestResult = parseManifest(files);
  if (!manifestResult.ok) return manifestResult;

  const metaRead = parseJsonFile(files, ARCHIVE_FILES.meta, true);
  if (metaRead && !metaRead.ok) problems.push(metaRead.problem);

  const domRead = parseJsonFile(files, ARCHIVE_FILES.dom, true);
  if (domRead && !domRead.ok) problems.push(domRead.problem);

  if (problems.length > 0) return { ok: false, problems };

  const meta = sessionMetaSchema.safeParse(
    metaRead && metaRead.ok ? metaRead.value : undefined,
  );
  if (!meta.success) {
    problems.push({
      kind: 'schema-mismatch',
      path: ARCHIVE_FILES.meta,
      message: `${ARCHIVE_FILES.meta} does not match the expected shape.`,
      issues: formatIssues(meta.error),
    });
  }

  const domEvents = z
    .array(domEventSchema)
    .safeParse(domRead && domRead.ok ? domRead.value : undefined);
  if (!domEvents.success) {
    problems.push({
      kind: 'schema-mismatch',
      path: ARCHIVE_FILES.dom,
      message: `${ARCHIVE_FILES.dom} is not a readable rrweb event stream.`,
      issues: formatIssues(domEvents.error),
    });
  }

  const optional = <T>(path: string, schema: z.ZodType<T>): T[] => {
    const read = parseJsonFile(files, path, false);
    if (read === null) return [];
    if (!read.ok) {
      problems.push(read.problem);
      return [];
    }
    const parsed = z.array(schema).safeParse(read.value);
    if (!parsed.success) {
      problems.push({
        kind: 'schema-mismatch',
        path,
        message: `${path} does not match the expected shape.`,
        issues: formatIssues(parsed.error),
      });
      return [];
    }
    return parsed.data;
  };

  const networkEvents = optional(ARCHIVE_FILES.network, networkEventSchema);
  const consoleEvents = optional(ARCHIVE_FILES.console, consoleEventSchema);
  const errorEvents = optional(ARCHIVE_FILES.error, sessionErrorEventSchema);
  const navigationEvents = optional(ARCHIVE_FILES.navigation, navigationEventSchema);

  if (problems.length > 0 || !meta.success || !domEvents.success) {
    return { ok: false, problems };
  }

  return {
    ok: true,
    value: {
      manifest: manifestResult.value,
      meta: meta.data,
      // rrweb's `eventWithTime` is a discriminated union; the loose envelope
      // schema deliberately validates less than that type describes, so the
      // cast is the one place the two views are reconciled.
      domEvents: domEvents.data as SessionArchive['domEvents'],
      networkEvents,
      consoleEvents,
      errorEvents,
      navigationEvents,
    },
  };
}
