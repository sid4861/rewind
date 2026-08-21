import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

/**
 * Phase 1 of the fidelity harness: drive a fixed scenario with the recorder
 * active, screenshot the LIVE app at each checkpoint, and save the archive.
 *
 * Phase 2 lives in the player package: it replays this archive, seeks to the
 * same checkpoints, screenshots the replay, and pixel-diffs the two.
 *
 * Split across two packages because each half needs its own dev server, and
 * because the archive is the honest interface between them — exactly what a
 * developer receives over Slack.
 */

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(here, '../../session-player/e2e/__fidelity__');
const ARCHIVE_PATH = resolve(here, '../../session-player/public/fidelity-session.zip');

export interface Checkpoint {
  name: string;
  /**
   * Absolute epoch ms, NOT an offset.
   *
   * Anchoring to a Date.now() captured in the test drifts: the recorder's clock
   * origin is set inside start(), and everything between that and the test's
   * own timestamp (the status poll, collapsing the panel) makes every
   * checkpoint systematically early. Phase 2 subtracts the archive's real
   * `meta.clock.epochMs`, so the offset is exact by construction.
   */
  epochMs: number;
}

async function widget(page: Page) {
  const host = page.locator('#rewind-session-recorder-host');
  return {
    open: () => host.locator('.launcher').click(),
    collapse: () => host.locator('button.close').click(),
    click: (label: string) =>
      host.locator('button.action', { hasText: label }).first().click(),
    status: async () => (await host.locator('.status').textContent())?.trim() ?? '',
    box: () => host.boundingBox(),
  };
}

test('captures live screenshots and an archive for the fidelity harness', async ({
  page,
}) => {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  await page.goto('/dashboard');
  await expect(page.locator('.metric-value').first()).toBeVisible();

  const w = await widget(page);
  await w.open();
  await w.click('Start recording');
  await expect.poll(() => w.status()).toBe('recording');
  await w.collapse();

  const checkpoints: Checkpoint[] = [];

  const checkpoint = async (name: string): Promise<void> => {
    // Let layout and any in-flight transition settle, so the live shot is not
    // taken mid-animation while the replay lands after it.
    await page.waitForTimeout(700);
    const epochMs = Date.now();
    await page.screenshot({
      path: resolve(OUT_DIR, `live-${name}.png`),
      animations: 'disabled',
    });
    checkpoints.push({ name, epochMs });
    // A beat after, so the replay has settled state to seek into rather than
    // landing exactly on a mutation boundary.
    await page.waitForTimeout(300);
  };

  await checkpoint('dashboard');

  await page.getByRole('link', { name: 'Orders' }).click();
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await checkpoint('orders');

  await page.getByLabel('Search orders').fill('Lovelace');
  await expect(page.locator('.pager')).toContainText('orders');
  await checkpoint('orders-filtered');

  await page.getByRole('link', { name: 'Billing' }).click();
  await expect(page.getByLabel('Card number')).toBeVisible();
  await page.getByLabel('Name on account').fill('Ada Lovelace');
  await checkpoint('billing');

  // Media: images, srcset, sprite icons, the web font, video, iframes.
  await page.getByRole('link', { name: 'Media' }).click();
  await expect(page.locator('.icon-item').first()).toBeVisible();
  await checkpoint('media');

  // Components: shadow DOM, runtime-injected styles, tokens, portal.
  await page.getByRole('link', { name: 'Components' }).click();
  await expect(page.locator('demo-badge').first()).toBeVisible();
  await checkpoint('components');

  await page.getByRole('button', { name: 'Inject styles at runtime' }).click();
  await expect(page.locator('.runtime-styled')).toBeVisible();
  await checkpoint('components-styled');

  // A design-token change, which has to cascade through the replay too.
  await page.getByText('Forest').click();
  await checkpoint('components-token');

  await page.getByRole('button', { name: 'Open modal' }).click();
  await expect(page.locator('.modal')).toBeVisible();
  await checkpoint('components-portal');
  await page.getByRole('button', { name: 'Cancel' }).click();

  // Back to the dashboard so the canvas-vs-SVG pair is measured after a
  // remount, which is when a canvas most often replays blank.
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await checkpoint('dashboard-charts');

  const widgetBox = await w.box();

  /*
   * Regions the demo app itself declares uncapturable.
   *
   * Only the cross-origin iframe qualifies: the browser will not expose another
   * origin's DOM to the recording page, so live content versus the player's
   * placeholder can never match. The same-origin iframe is deliberately NOT
   * excluded — it is capturable, and if it stops replaying, that is a real
   * regression this harness should catch.
   */
  await page.getByRole('link', { name: 'Media' }).click();
  await expect(page.locator('.icon-item').first()).toBeVisible();
  const excludedBoxes = await page
    .locator('[data-fidelity-exclude]')
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }),
    );

  await w.open();
  const downloadPromise = page.waitForEvent('download');
  await w.click('Stop & save');
  const download = await downloadPromise;

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const bytes = Buffer.concat(chunks);

  mkdirSync(dirname(ARCHIVE_PATH), { recursive: true });
  writeFileSync(ARCHIVE_PATH, bytes);

  writeFileSync(
    resolve(OUT_DIR, 'checkpoints.json'),
    JSON.stringify(
      {
        checkpoints,
        viewport: page.viewportSize(),
        /*
         * The recorder widget's own rectangle.
         *
         * It is visible in the live screenshot but rrweb renders a blocked
         * placeholder in its place during replay, so the region can never
         * match. Phase 2 zeroes this rectangle in BOTH images rather than
         * pretending the difference is a fidelity failure.
         */
        widgetBox,
        excludedBoxes,
      },
      null,
      2,
    ),
  );

  expect(checkpoints).toHaveLength(10);
  expect(
    excludedBoxes.length,
    'the cross-origin iframe should declare itself unmeasurable',
  ).toBe(1);
  expect(bytes.byteLength).toBeGreaterThan(1000);
});
