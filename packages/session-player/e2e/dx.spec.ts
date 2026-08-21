import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

/**
 * The developer-experience layer: shortcuts, deep links, exports.
 *
 * None of this changes what is captured, but all of it decides whether the tool
 * gets used. A replay you can only drive by aiming at a 32px button, and whose
 * position you can only share as "scrub to about two minutes twenty", is a
 * replay people open once.
 */

const here = dirname(fileURLToPath(import.meta.url));
const ARCHIVE = resolve(here, '../public/chaos-session.zip');

async function load(page: Page): Promise<void> {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', ARCHIVE);
  await expect(page.locator('.player')).toBeVisible();
}

const scrub = (page: Page) => page.locator('input.scrub');

test('space toggles playback', async ({ page }) => {
  await load(page);
  await expect(page.locator('button.play')).toHaveText('▶');

  await page.locator('.stage').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press(' ');
  await expect(page.locator('button.play')).toHaveText('❚❚');

  await page.keyboard.press(' ');
  await expect(page.locator('button.play')).toHaveText('▶');
});

test('arrow keys step the playhead', async ({ page }) => {
  await load(page);
  await page.locator('.stage').click({ position: { x: 5, y: 5 } });

  await page.keyboard.press('Shift+ArrowRight');
  await expect
    .poll(async () => Number(await scrub(page).inputValue()))
    .toBeGreaterThan(0);
});

test('shortcuts do NOT fire while typing in a filter', async ({ page }) => {
  await load(page);

  const filter = page.getByLabel('Filter by URL');
  await filter.click();
  await filter.type('kind ok');

  // The space in the query must reach the input, not pause playback — this is
  // the bug that makes keyboard shortcuts feel broken.
  await expect(filter).toHaveValue('kind ok');
  await expect(page.locator('button.play')).toHaveText('▶');
});

test('e jumps to the next error', async ({ page }) => {
  await load(page);
  await page.locator('.stage').click({ position: { x: 5, y: 5 } });

  const before = Number(await scrub(page).inputValue());
  await page.keyboard.press('e');
  await expect
    .poll(async () => Number(await scrub(page).inputValue()), { timeout: 20_000 })
    .toBeGreaterThan(before);
});

test('f focuses the filter', async ({ page }) => {
  await load(page);
  await page.locator('.stage').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('f');
  await expect(page.getByLabel('Filter by URL')).toBeFocused();
});

test('the URL carries the playhead position', async ({ page }) => {
  await load(page);

  const max = Number(await scrub(page).getAttribute('max'));
  await scrub(page).fill(String(Math.round(max / 2)));
  await scrub(page).dispatchEvent('change');

  await expect.poll(() => page.url()).toMatch(/#.*t=\d+/);
});

test('a deep link opens at that moment', async ({ page }) => {
  await load(page);
  const max = Number(await scrub(page).getAttribute('max'));
  const target = Math.round(max * 0.6);

  /*
   * A hash-only `goto` from the same URL does NOT reload the document, so the
   * player kept the archive it already had and the dropzone never came back.
   * An explicit reload is what makes this a fresh load with a link, which is
   * the case being tested.
   */
  await page.goto(`/#t=${target}&tab=console`);
  await page.reload();
  await page.setInputFiles('input[type=file]', ARCHIVE);
  await expect(page.locator('.player')).toBeVisible();

  await expect
    .poll(async () => Number(await scrub(page).inputValue()), { timeout: 20_000 })
    .toBeGreaterThan(target * 0.8);
  // The tab from the link wins over the default.
  await expect(page.locator('.tab.active')).toHaveText(/Console/);
});

test('copy as cURL produces a command that keeps redactions', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await load(page);

  await page.getByLabel('Filter by URL').fill('kind=ok&access_token');
  await page.locator('.net-row').first().click();
  await page.getByRole('button', { name: 'Copy as cURL' }).click();

  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('curl ');

  /*
   * Decoded before asserting: the placeholder sits in a query string, so it is
   * correctly percent-encoded as %5BREDACTED%5D in the URL. Asserting on the
   * raw literal was the test being wrong about what a URL looks like, not the
   * export failing to redact.
   */
  expect(decodeURIComponent(copied)).toContain('[REDACTED]');
  expect(copied).toContain('Redacted at capture');
});

test('HAR export downloads the filtered calls', async ({ page }) => {
  await load(page);
  await page.getByLabel('Status').selectOption('server-error');

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export HAR' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.har$/);

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const har = JSON.parse(Buffer.concat(chunks).toString()) as {
    log: { version: string; entries: Array<{ response: { status: number } }> };
  };

  expect(har.log.version).toBe('1.2');
  expect(har.log.entries.length).toBeGreaterThan(0);
  // Exported what was FILTERED, which is how the developer said what they want.
  for (const entry of har.log.entries) {
    expect(entry.response.status).toBeGreaterThanOrEqual(500);
  }
});

test('the shortcuts overlay is discoverable', async ({ page }) => {
  await load(page);
  await page.getByRole('button', { name: 'Keyboard shortcuts' }).click();
  await expect(page.locator('.shortcuts-panel')).toBeVisible();
  await expect(page.locator('.shortcut-row').first()).toContainText('Play / pause');
});
