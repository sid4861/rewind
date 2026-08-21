#!/usr/bin/env node
/**
 * Guard #5 of PLAN.md 4.9: the recorder must not reach a production bundle.
 *
 * This is a build-output assertion rather than a code review rule because the
 * failure is invisible in source. `enabled={false}` reads like it disables the
 * recorder, and it does — at runtime. The bundler still ships every byte,
 * rrweb included. Measured on the demo app before this was enforced: a static
 * import put 228KB of recorder and rrweb into the production output while the
 * feature was switched off.
 *
 * A session recorder loose in production is a data-collection incident, not a
 * performance regression, so this fails the build rather than warning.
 *
 * Usage: node scripts/assert-recorder-excluded.mjs <distDir> [<distDir>...]
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Markers chosen to be load-bearing, not incidental.
 *
 * Each is something the recorder cannot function without, so none can be
 * renamed away to make this check pass while the code still ships. Matching on
 * a comment or an import path would be defeated by minification; these survive
 * it because they are runtime string literals.
 */
const MARKERS = [
  { needle: 'rewind-session-recorder-host', why: 'the widget host element id' },
  { needle: 'rewind-recorder-block', why: 'the rrweb block class' },
  { needle: 'rewind-asset:', why: 'the asset reference scheme' },
  { needle: 'inlineStylesheet', why: 'an rrweb record() option' },
  { needle: 'checkoutEveryNms', why: 'an rrweb record() option' },
  { needle: 'rrweb', why: 'the recording library itself' },
];

/** Extensions worth scanning. Sourcemaps are excluded; they are not shipped. */
const SCANNED = new Set(['.js', '.mjs', '.cjs', '.css', '.html']);

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walk(full));
    } else if (SCANNED.has(entry.slice(entry.lastIndexOf('.')))) {
      out.push(full);
    }
  }
  return out;
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error('usage: assert-recorder-excluded.mjs <distDir> [<distDir>...]');
  process.exit(2);
}

let failed = false;

for (const target of targets) {
  const files = walk(target);

  if (files.length === 0) {
    // An empty dist is not a pass. It means the build did not run, and a check
    // that silently succeeds on missing input is worse than no check.
    console.error(
      `FAIL  ${target}: no build output found — did the production build run?`,
    );
    failed = true;
    continue;
  }

  const hits = [];
  for (const file of files) {
    const contents = readFileSync(file, 'utf8');
    for (const { needle, why } of MARKERS) {
      if (contents.includes(needle)) {
        hits.push({ file: relative(process.cwd(), file), needle, why });
      }
    }
  }

  if (hits.length > 0) {
    failed = true;
    console.error(
      `\nFAIL  ${target}: the session recorder is present in the production bundle.`,
    );
    for (const hit of hits) {
      console.error(`        ${hit.needle}  (${hit.why})\n          in ${hit.file}`);
    }
    console.error(
      '\n      Import the recorder through a dynamic import behind a build-time\n' +
        '      check, not a static import with a runtime flag. `enabled={false}`\n' +
        '      stops it running; it does not stop it shipping. See App.tsx in\n' +
        '      session-demo-app for the pattern.\n',
    );
  } else {
    console.log(`PASS  ${target}: recorder absent from ${files.length} build files.`);
  }
}

process.exit(failed ? 1 : 0);
