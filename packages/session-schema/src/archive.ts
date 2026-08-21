/** Fixed paths inside a session zip. */
export const ARCHIVE_FILES = {
  manifest: 'manifest.json',
  meta: 'meta.json',
  dom: 'dom-events.json',
  network: 'network-events.json',
  console: 'console-events.json',
  error: 'error-events.json',
  navigation: 'navigation-events.json',
} as const;

export const ASSETS_DIR = 'assets/';

/** Present in every archive; absence is a validation failure. */
export const REQUIRED_ARCHIVE_FILES = [
  ARCHIVE_FILES.manifest,
  ARCHIVE_FILES.meta,
  ARCHIVE_FILES.dom,
] as const;

/** Absent in M1 archives; the player must tolerate a missing file, not crash. */
export const OPTIONAL_ARCHIVE_FILES = [
  ARCHIVE_FILES.network,
  ARCHIVE_FILES.console,
  ARCHIVE_FILES.error,
  ARCHIVE_FILES.navigation,
] as const;

/** `session-<app>-<ISO>-<shortId>.zip`, with the ISO colons made filename-safe. */
export function archiveFileName(
  appName: string,
  startedAt: Date,
  shortId: string,
): string {
  const slug = appName.replace(/[^a-zA-Z0-9-_]/g, '-').toLowerCase();
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
  return `session-${slug}-${stamp}-${shortId}.zip`;
}
