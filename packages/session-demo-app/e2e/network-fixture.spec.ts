import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

/**
 * Produces the chaos fixture the player's M3 tests replay against.
 *
 * The M1 fixture is a handful of successful calls; it cannot exercise status
 * colouring, error filters, truncation flags or redaction badges. This scenario
 * deliberately fires the interesting failure modes so the network panel has
 * something real to render.
 */

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(here, '../../session-player/public/chaos-session.zip');

async function widget(page: Page) {
  const host = page.locator('#rewind-session-recorder-host');
  return {
    open: () => host.locator('.launcher').click(),
    collapse: () => host.locator('button.close').click(),
    click: (label: string) =>
      host.locator('button.action', { hasText: label }).first().click(),
    status: async () => (await host.locator('.status').textContent())?.trim() ?? '',
  };
}

test('produces a chaos archive covering every network case', async ({ page }) => {
  await page.goto('/chaos');

  const w = await widget(page);
  await w.open();
  await w.click('Start recording');
  await expect.poll(() => w.status()).toBe('recording');
  await w.collapse();

  const fire = async (name: RegExp, expectedCount: number): Promise<void> => {
    await page.getByRole('button', { name }).click();
    await expect(page.locator('.chaos-line')).toHaveCount(expectedCount);
  };

  await fire(/^200 OK/, 1);
  await fire(/^400 Bad Request/, 2);
  await fire(/^401 Unauthorized/, 3);
  await fire(/^500 Server Error/, 4);
  await fire(/XHR request/, 5);
  await fire(/Aborted request/, 6);
  await fire(/Large 5MB response/, 7);
  await fire(/POST with seeded secrets/, 8);
  await fire(/Token in query string/, 9);

  // A little navigation so the DOM stream has more than one screen in it.
  await page.getByRole('link', { name: 'Orders' }).click();
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await page.waitForTimeout(400);

  await w.open();
  const downloadPromise = page.waitForEvent('download');
  await w.click('Stop & save');
  const download = await downloadPromise;

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const bytes = new Uint8Array(Buffer.concat(chunks));

  const entries = unzipSync(bytes);
  const network = JSON.parse(
    strFromU8(entries['network-events.json'] as Uint8Array),
  ) as Array<{
    source: string;
    phase: string;
    response: { status: number; body: { truncated: boolean } } | null;
    request: { redactedHeaders: string[]; headers: Record<string, string> };
  }>;

  // Assert the fixture actually contains what the player tests depend on,
  // rather than discovering it is thin only when those tests fail obscurely.
  const statuses = network.map((e) => e.response?.status);
  expect(statuses).toContain(400);
  expect(statuses).toContain(500);
  expect(network.some((e) => e.source === 'xhr')).toBe(true);
  expect(network.some((e) => e.phase === 'aborted')).toBe(true);
  expect(network.some((e) => e.response?.body.truncated === true)).toBe(true);

  /*
   * This app captures auth headers rather than redacting them, so
   * `redactedHeaders` is legitimately empty. What the player's tests actually
   * need from this fixture is an entry carrying the header at all — that is
   * what exercises the drawer's header rendering.
   */
  expect(
    network.some((e) => Object.keys(e.request.headers).includes('authorization')),
    'no entry carries an authorization header for the player tests to render',
  ).toBe(true);

  mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
  writeFileSync(FIXTURE_PATH, bytes);
});
