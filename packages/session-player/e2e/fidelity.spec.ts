import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { strFromU8, unzipSync } from 'fflate';

/**
 * Phase 2 of the fidelity harness — the thing that turns "looks about right"
 * into a number.
 *
 * Claiming Glassbox-level fidelity is meaningless without measuring it. This
 * replays the archive phase 1 produced, seeks to the same checkpoints,
 * screenshots the replay, and pixel-diffs it against the live app. The score is
 * asserted against a threshold so an rrweb upgrade or a capture regression
 * fails CI instead of quietly degrading every replay.
 */

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(here, '__fidelity__');
const ARCHIVE = resolve(here, '../public/fidelity-session.zip');
const DIFF_DIR = resolve(FIXTURE_DIR, 'diff');

/**
 * A floor to defend, not a target.
 *
 * Current run: 99.50% mean across ten checkpoints, worst 98.10%. 97% leaves
 * headroom for anti-aliasing and font-rasterisation noise between machines
 * while still failing loudly on a real regression — this harness has already
 * caught a replay rendering entirely off-screen (84%) and a whole screen of
 * images silently dropped on seek (84%). Ratchet this up as the residual is
 * chased down; never loosen it to make a failure go away.
 */
const MIN_SIMILARITY = 0.97;

/** Per-pixel colour tolerance. Anti-aliasing differs slightly between paints. */
const PIXEL_THRESHOLD = 0.2;

interface Checkpoint {
  name: string;
  /** Absolute epoch ms; converted to an offset using the archive's own clock. */
  epochMs: number;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Manifest {
  checkpoints: Checkpoint[];
  viewport: { width: number; height: number } | null;
  widgetBox: Box | null;
  excludedBoxes: Box[];
}

/**
 * The archive's own clock origin.
 *
 * Read from the archive rather than trusting a timestamp the test took: the
 * recorder sets its origin inside start(), and anything the test measures
 * afterwards is late by however long the widget interactions took. Subtracting
 * the real origin makes every checkpoint offset exact.
 */
function archiveClockOrigin(): number {
  const entries = unzipSync(new Uint8Array(readFileSync(ARCHIVE)));
  const domEvents = JSON.parse(
    strFromU8(entries['dom-events.json'] as Uint8Array),
  ) as Array<{
    timestamp: number;
  }>;
  /*
   * The FIRST rrweb event, not meta.clock.epochMs.
   *
   * rrweb's replay timeline starts at events[0].timestamp; the recorder's clock
   * origin is set slightly earlier, inside start(). Seeking with the recorder's
   * origin lands consistently early — which is exactly what this harness caught
   * in the player itself.
   */
  return Math.min(...domEvents.map((e) => e.timestamp));
}

function loadManifest(): Manifest {
  return JSON.parse(
    readFileSync(resolve(FIXTURE_DIR, 'checkpoints.json'), 'utf8'),
  ) as Manifest;
}

/**
 * Blank a rectangle in-place.
 *
 * Used for the recorder widget: it is genuinely on screen live, and rrweb
 * genuinely renders a blocked placeholder in the replay. That difference is
 * correct behaviour, so measuring it as a fidelity failure would be dishonest.
 * Both images get the same region zeroed.
 */
function blankRegion(png: PNG, box: Box | null, pad = 12): void {
  if (!box) return;
  const x0 = Math.max(0, Math.floor(box.x - pad));
  const y0 = Math.max(0, Math.floor(box.y - pad));
  const x1 = Math.min(png.width, Math.ceil(box.x + box.width + pad));
  const y1 = Math.min(png.height, Math.ceil(box.y + box.height + pad));

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (png.width * y + x) << 2;
      png.data[i] = 0;
      png.data[i + 1] = 0;
      png.data[i + 2] = 0;
      png.data[i + 3] = 255;
    }
  }
}

async function loadArchive(page: Page): Promise<void> {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', ARCHIVE);
  await expect(page.locator('.player')).toBeVisible();
  await expect(page.locator('.stage-frame iframe')).toBeVisible();
}

test.describe('fidelity', () => {
  test.beforeAll(() => {
    if (!existsSync(ARCHIVE) || !existsSync(resolve(FIXTURE_DIR, 'checkpoints.json'))) {
      throw new Error(
        'Fidelity fixture missing. Run: nx run session-demo-app:e2e (fidelity-capture spec) first.',
      );
    }
    mkdirSync(DIFF_DIR, { recursive: true });
  });

  test('replay matches the live app above the fidelity threshold', async ({ page }) => {
    const manifest = loadManifest();
    await loadArchive(page);

    // The replay must render 1:1 for a meaningful comparison. The player
    // letterboxes and clamps scale at 1, so the window simply has to be big
    // enough that no downscaling happens.
    const scale = await page
      .locator('.stage-viewport')
      .evaluate((el) =>
        Number(/scale\(([\d.]+)\)/.exec((el as HTMLElement).style.transform)?.[1] ?? '1'),
      );
    expect(
      scale,
      'replay is being downscaled; widen the fidelity viewport or the comparison is meaningless',
    ).toBeCloseTo(1, 2);

    const clockOrigin = archiveClockOrigin();
    const scores: Array<{ name: string; similarity: number; diffPixels: number }> = [];

    /*
     * Measure by PLAYING THROUGH, not by seeking to each checkpoint.
     *
     * Two reasons. First, playback is the path a developer actually watches, so
     * it is the honest thing to score. Second, rrweb's seek fast-forwards
     * synchronously and drops large mutation batches under load — measuring
     * through it produced scores that swung between 84% and 99.7% run to run,
     * which is worse than no measurement at all. Playback applies every batch
     * the same way every time.
     */
    const targets = manifest.checkpoints
      .map((c) => ({ name: c.name, offsetMs: c.epochMs - clockOrigin }))
      .sort((a, b) => a.offsetMs - b.offsetMs);

    for (const t of targets) {
      expect(t.offsetMs, `checkpoint ${t.name} predates the recording`).toBeGreaterThan(
        0,
      );
    }

    const currentMs = async (): Promise<number> =>
      Number(await page.locator('input.scrub').inputValue());

    await page.locator('button.play').click();

    for (const target of targets) {
      // Let playback carry the replay to this checkpoint.
      await expect
        .poll(currentMs, { timeout: 120_000, intervals: [100] })
        .toBeGreaterThanOrEqual(target.offsetMs);

      // Pause without an offset: that suspends the timer in place and does NOT
      // re-run the lossy fast-forward path.
      await page.locator('button.play').click();
      await page.waitForTimeout(350);

      const replayShot = await page.locator('.stage-viewport').screenshot({
        animations: 'disabled',
      });

      const live = PNG.sync.read(
        readFileSync(resolve(FIXTURE_DIR, `live-${target.name}.png`)),
      );
      const replay = PNG.sync.read(replayShot);

      expect(
        { width: replay.width, height: replay.height },
        `checkpoint ${target.name}: replay dimensions differ from the recorded viewport`,
      ).toEqual({ width: live.width, height: live.height });

      blankRegion(live, manifest.widgetBox);
      blankRegion(replay, manifest.widgetBox);
      for (const box of manifest.excludedBoxes ?? []) {
        blankRegion(live, box);
        blankRegion(replay, box);
      }

      const diff = new PNG({ width: live.width, height: live.height });
      const diffPixels = pixelmatch(
        live.data,
        replay.data,
        diff.data,
        live.width,
        live.height,
        { threshold: PIXEL_THRESHOLD, includeAA: false },
      );

      const total = live.width * live.height;
      scores.push({ name: target.name, similarity: 1 - diffPixels / total, diffPixels });

      writeFileSync(resolve(DIFF_DIR, `diff-${target.name}.png`), PNG.sync.write(diff));
      writeFileSync(resolve(DIFF_DIR, `replay-${target.name}.png`), replayShot);

      // Resume for the next checkpoint.
      await page.locator('button.play').click();
    }

    const report = scores
      .map(
        (s) =>
          `  ${s.name.padEnd(18)} ${(s.similarity * 100).toFixed(2)}%  (${s.diffPixels} px)`,
      )
      .join('\n');
    const mean = scores.reduce((sum, s) => sum + s.similarity, 0) / scores.length;

    // eslint-disable-next-line no-console
    console.log(
      `\nFIDELITY SCORES (threshold ${(MIN_SIMILARITY * 100).toFixed(0)}%)\n${report}\n  ${'mean'.padEnd(18)} ${(mean * 100).toFixed(2)}%\n`,
    );

    writeFileSync(
      resolve(DIFF_DIR, 'scores.json'),
      JSON.stringify({ threshold: MIN_SIMILARITY, mean, scores }, null, 2),
    );

    for (const score of scores) {
      expect(
        score.similarity,
        `checkpoint "${score.name}" scored ${(score.similarity * 100).toFixed(2)}% — see e2e/__fidelity__/diff/diff-${score.name}.png`,
      ).toBeGreaterThan(MIN_SIMILARITY);
    }
  });
});
