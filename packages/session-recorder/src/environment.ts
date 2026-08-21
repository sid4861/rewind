import type { SessionEnvironment } from '@rewind/session-schema';

interface NameVersion {
  name: string;
  version: string;
}

/**
 * Deliberately a small hand-rolled parse rather than a UA-parsing dependency.
 *
 * This value is display metadata in the player header — "Chrome 120 on Windows"
 * — not something any logic branches on. A wrong guess costs a slightly odd
 * label; a dependency costs bundle size in every host app that installs the
 * recorder. If UA data ever drives behaviour, replace this with the real thing.
 */
function parseBrowser(ua: string): NameVersion {
  const patterns: Array<[string, RegExp]> = [
    ['Edge', /Edg\/([\d.]+)/],
    ['Opera', /OPR\/([\d.]+)/],
    ['Chrome', /Chrome\/([\d.]+)/],
    ['Firefox', /Firefox\/([\d.]+)/],
    ['Safari', /Version\/([\d.]+).*Safari/],
  ];
  for (const [name, pattern] of patterns) {
    const match = pattern.exec(ua);
    if (match?.[1]) return { name, version: match[1] };
  }
  return { name: 'Unknown', version: '' };
}

function parseOs(ua: string): NameVersion {
  if (/Windows NT 10/.test(ua)) return { name: 'Windows', version: '10/11' };
  if (/Windows NT ([\d.]+)/.test(ua)) {
    return { name: 'Windows', version: /Windows NT ([\d.]+)/.exec(ua)?.[1] ?? '' };
  }
  if (/Mac OS X ([\d_.]+)/.test(ua)) {
    return {
      name: 'macOS',
      version: (/Mac OS X ([\d_.]+)/.exec(ua)?.[1] ?? '').replace(/_/g, '.'),
    };
  }
  if (/Android ([\d.]+)/.test(ua))
    return { name: 'Android', version: /Android ([\d.]+)/.exec(ua)?.[1] ?? '' };
  if (/(iPhone|iPad).*OS ([\d_]+)/.test(ua)) {
    return {
      name: 'iOS',
      version: (/OS ([\d_]+)/.exec(ua)?.[1] ?? '').replace(/_/g, '.'),
    };
  }
  if (/Linux/.test(ua)) return { name: 'Linux', version: '' };
  return { name: 'Unknown', version: '' };
}

export function collectEnvironment(): SessionEnvironment {
  const ua = navigator.userAgent;
  return {
    userAgent: ua,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    browser: parseBrowser(ua),
    os: parseOs(ua),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    screen: { width: window.screen.width, height: window.screen.height },
    devicePixelRatio: window.devicePixelRatio,
    // Metadata only. The player pins its replay surface to `light` regardless,
    // so the developer's OS preference cannot leak into UA-rendered chrome.
    colorScheme: window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light',
    prefersReducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
}
