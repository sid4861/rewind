import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

/**
 * The other half of the M1 round trip: take the archive the demo app's
 * `record-roundtrip` test produced and prove the player can actually replay it.
 *
 * Playback is verified here rather than by hand because rrweb's Replayer runs
 * on `requestAnimationFrame`, which is suspended in any backgrounded or
 * non-compositing browser. A real browser tab is the only place "does the clock
 * advance" is a meaningful question.
 */

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, '../public/sample-session.zip');

/** Feeds the fixture through the same path a drag-and-drop would take. */
async function loadFixture(page: Page): Promise<void> {
  await page.setInputFiles('input[type=file]', FIXTURE);
  await expect(page.locator('.player')).toBeVisible();
}

const currentTime = (page: Page) => page.locator('.controls .time').first();

test.beforeAll(() => {
  if (!existsSync(FIXTURE)) {
    throw new Error(
      `Missing ${FIXTURE}. Run the demo app e2e first: nx run session-demo-app:e2e`,
    );
  }
});

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('loads a real archive without reporting problems', async ({ page }) => {
  await loadFixture(page);
  await expect(page.locator('.problem-message')).toHaveCount(0);
  await expect(page.locator('.stage-frame iframe')).toBeVisible();
});

test('rebuilds the recorded DOM inside the replay frame', async ({ page }) => {
  await loadFixture(page);
  const frame = page.frameLocator('.stage-frame iframe');
  // The recording started on the demo app's dashboard; if the snapshot replayed
  // correctly, the app's own chrome is present inside the frame.
  await expect(frame.locator('.brand-name')).toHaveText('Northwind Ops');
  await expect(frame.locator('.nav-item').first()).toBeVisible();
});

test('letterboxes to the recorded viewport instead of stretching', async ({ page }) => {
  await loadFixture(page);
  const stage = page.locator('.stage-viewport');

  const box = await stage.evaluate((el) => ({
    width: el.style.width,
    height: el.style.height,
    transform: el.style.transform,
    colorScheme: getComputedStyle(el).colorScheme,
  }));

  // Exactly the recorded dimensions, with a single uniform scale factor. Two
  // different scale values would mean the replay is lying about layout.
  expect(box.width).toBe('1280px');
  expect(box.height).toBe('800px');
  expect(box.transform).toMatch(/^scale\(([\d.]+)\)$/);
  // The developer's OS preference must not leak into the replay surface.
  expect(box.colorScheme).toBe('light');

  await expect(page.locator('.chip').first()).toContainText('1280×800');
});

test('advances the clock while playing and holds it while paused', async ({ page }) => {
  await loadFixture(page);
  await expect(currentTime(page)).toHaveText('0:00');

  await page.locator('button.play').click();
  await expect
    .poll(async () => Number(await page.locator('input.scrub').inputValue()), {
      timeout: 8_000,
    })
    .toBeGreaterThan(0);

  await page.locator('button.play').click();
  const held = Number(await page.locator('input.scrub').inputValue());
  await page.waitForTimeout(1_200);
  const stillHeld = Number(await page.locator('input.scrub').inputValue());

  // Paused means paused: a drifting clock desynchronises every panel that will
  // hang off it in M3.
  expect(Math.abs(stillHeld - held)).toBeLessThan(150);
});

test('seeks to a marker from the meta panel', async ({ page }) => {
  await loadFixture(page);

  // Archives with network activity open on the Network tab, so the markers list
  // is one click away rather than on screen at load.
  await page.getByRole('button', { name: /^Meta$/ }).click();

  const markerRow = page.locator('.marker-row').first();
  await expect(markerRow).toContainText('sorted by total');
  await markerRow.click();

  await expect
    .poll(async () => Number(await page.locator('input.scrub').inputValue()))
    .toBeGreaterThan(0);

  // The same marker is on the scrubber, so it is reachable without opening the
  // panel at all.
  await expect(page.locator('.marker-flag')).toHaveCount(1);
});

test('rejects a non-archive with a readable message rather than a crash', async ({
  page,
}) => {
  await page.setInputFiles('input[type=file]', {
    name: 'not-an-archive.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('this is definitely not a zip file'),
  });

  await expect(page.locator('.problems-title')).toBeVisible();
  await expect(page.locator('.problem-message')).toContainText(/could not|archive/i);
  // Still on the dropzone, still usable.
  await expect(page.locator('.dropzone')).toBeVisible();
});

test('resolves externalized assets to blob URLs so images actually render', async ({
  page,
}) => {
  // The fidelity fixture is the one with real images; the M1 sample has none.
  const fixture = resolve(here, '../public/fidelity-session.zip');
  await page.goto('/');
  await page.setInputFiles('input[type=file]', fixture);
  await expect(page.locator('.player')).toBeVisible();

  // Play far enough in to reach the media screen, using the playback path.
  await page.locator('button.play').click();
  await expect
    .poll(
      async () =>
        page
          .frameLocator('.stage-frame iframe')
          .locator('img')
          .count()
          .catch(() => 0),
      { timeout: 60_000, intervals: [250] },
    )
    .toBeGreaterThan(0);
  await page.locator('button.play').click();

  const srcs = await page
    .frameLocator('.stage-frame iframe')
    .locator('img')
    .evaluateAll((nodes) => nodes.map((n) => (n as HTMLImageElement).src));

  // Every image must point at a blob URL, not a leftover reference. A stray
  // `rewind-asset:` in the DOM means resolution silently missed a code path
  // and the replay is showing broken images.
  expect(srcs.length).toBeGreaterThan(0);
  expect(srcs.every((src) => src.startsWith('blob:'))).toBe(true);
  expect(srcs.some((src) => src.includes('rewind-asset:'))).toBe(false);

  // And they must have actually decoded, not just been assigned a URL.
  const loaded = await page
    .frameLocator('.stage-frame iframe')
    .locator('img')
    .first()
    .evaluate((el) => {
      const img = el as HTMLImageElement;
      return { complete: img.complete, width: img.naturalWidth };
    });
  expect(loaded.complete).toBe(true);
  expect(loaded.width).toBeGreaterThan(0);
});

test('a newer schema version produces a clear error, not a crash', async ({ page }) => {
  /*
   * Forward compatibility is a promise made to the tester, not the developer.
   *
   * Someone on a newer recorder build sends an archive to someone on an older
   * player. The player cannot replay it — but it must say so in a sentence a
   * human can act on ("update the player"), rather than throwing, rendering
   * blank, or worst of all replaying a partial session as if it were complete.
   */
  const archive = readFileSync(resolve(here, '../public/chaos-session.zip'));
  const entries = unzipSync(new Uint8Array(archive));

  const manifest = JSON.parse(strFromU8(entries['manifest.json'] as Uint8Array)) as {
    schemaVersion: number;
  };
  manifest.schemaVersion = manifest.schemaVersion + 5;
  entries['manifest.json'] = strToU8(JSON.stringify(manifest));

  const bumped = zipSync(entries);

  await page.goto('/');
  await page.setInputFiles('input[type=file]', {
    name: 'from-the-future.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(bumped),
  });

  await expect(page.locator('.problems-title')).toBeVisible();
  const message = await page.locator('.problem-message').first().textContent();

  // Three things a human needs: what is wrong, which side is behind, and what
  // to do about it. A bare "incompatible archive" satisfies none of them.
  expect(message).toMatch(/schema/i);
  expect(message, 'the message must name BOTH versions').toMatch(/v\d+.*v\d+/);
  expect(message, 'the message must say what to do').toMatch(/update/i);

  // Still usable: the dropzone is there to try a different file.
  await expect(page.locator('.dropzone')).toBeVisible();
});
