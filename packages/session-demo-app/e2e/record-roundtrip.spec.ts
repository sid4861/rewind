import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

/**
 * The M1 round trip: drive the demo app with the recorder active, stop, capture
 * the downloaded zip, and assert it is a valid archive.
 *
 * The saved fixture is deliberately a build artifact rather than a throwaway:
 * the player loads it from its own `public/` directory, and M5's pixel-diff
 * harness needs exactly this — a real archive produced by a scripted, and
 * therefore reproducible, scenario.
 */

const here = dirname(fileURLToPath(import.meta.url));

const FIXTURE_PATH = resolve(here, '../../session-player/public/sample-session.zip');

/** Drives the widget inside its shadow root. */
async function widget(page: Page) {
  const host = page.locator('#rewind-session-recorder-host');
  return {
    open: () => host.locator('.launcher').click(),
    collapse: () => host.locator('button.close').click(),
    click: (label: string) =>
      host.locator('button.action', { hasText: label }).first().click(),
    // textContent, not innerText: the status pill is styled
    // `text-transform: uppercase`, and innerText returns the rendered casing.
    status: async () => (await host.locator('.status').textContent())?.trim() ?? '',
    stat: async (label: string) =>
      (await host
        .locator('.stat', { hasText: label })
        .locator('.stat-value')
        .textContent()) ?? '',
    fill: (index: number, value: string) =>
      host.locator('input.text').nth(index).fill(value),
  };
}

test('records a session in the demo app and produces a valid archive', async ({
  page,
}) => {
  await page.goto('/dashboard');
  await expect(page.locator('.metric-value').first()).toBeVisible();

  const w = await widget(page);
  await w.open();
  await w.click('Start recording');
  await expect.poll(() => w.status()).toBe('recording');
  // Put the panel away, as a tester would. It is a real overlay and this app's
  // configuration makes it taller — it now carries an on-screen warning that
  // input values and auth headers are being recorded.
  await w.collapse();

  // A scripted scenario with distinct visual states, so the replay has
  // something meaningful to show and checkpoints to diff against later.
  await page.locator('.content').evaluate((el) => el.scrollTo(0, 260));
  await page.waitForTimeout(400);

  await page.getByRole('link', { name: 'Orders' }).click();
  await expect(page.locator('tbody tr').first()).toBeVisible();

  await page.getByLabel('Search orders').fill('Lovelace');
  await page.waitForTimeout(700);

  await page.locator('th.sortable', { hasText: 'Total' }).click();
  await page.waitForTimeout(600);

  await page.locator('.table-scroll').evaluate((el) => el.scrollTo(0, 180));
  await page.waitForTimeout(400);

  // Reopen to add the marker — the panel's controls only exist when expanded.
  await w.open();
  await w.fill(0, 'sorted by total');
  await w.click('Mark');
  await expect.poll(() => w.stat('Markers')).toBe('1');

  await page.getByRole('link', { name: 'Billing' }).click();
  await expect(page.getByLabel('Card number')).toBeVisible();
  await page.getByLabel('Name on account').fill('Ada Lovelace');
  await page.waitForTimeout(400);

  await w.fill(1, 'Siddharth');

  const downloadPromise = page.waitForEvent('download');
  await w.click('Stop & save');
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^session-northwind-ops-.*\.zip$/);

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const bytes = new Uint8Array(Buffer.concat(chunks));

  expect(bytes.byteLength).toBeGreaterThan(1000);

  const entries = unzipSync(bytes);
  const present = Object.keys(entries).sort();

  /*
   * Assert the REQUIRED files exist and that every file is a known one, rather
   * than pinning an exact list. Optional streams are written only when
   * non-empty, so the set legitimately grows as milestones add capture — and an
   * exact-match assertion broke on every one of them.
   */
  for (const required of ['manifest.json', 'meta.json', 'dom-events.json']) {
    expect(present, `missing required file ${required}`).toContain(required);
  }
  const known = new Set([
    'manifest.json',
    'meta.json',
    'dom-events.json',
    'network-events.json',
    'console-events.json',
    'error-events.json',
    'navigation-events.json',
  ]);
  for (const path of present) {
    expect(known.has(path) || path.startsWith('assets/'), `unexpected file ${path}`).toBe(
      true,
    );
  }
  expect(present).toContain('network-events.json');

  const manifest = JSON.parse(strFromU8(entries['manifest.json'] as Uint8Array)) as {
    schemaVersion: number;
    counts: { dom: number; marker: number; network: number };
    domStream: { format: string; transformed: boolean; assetRefScheme?: string };
  };
  const meta = JSON.parse(strFromU8(entries['meta.json'] as Uint8Array)) as {
    markers: Array<{ label: string; timestamp: number }>;
    tester: { name: string | null };
    clock: { epochMs: number };
    environment: { viewport: { width: number; height: number } };
  };
  const domEvents = JSON.parse(
    strFromU8(entries['dom-events.json'] as Uint8Array),
  ) as Array<{ type: number; timestamp: number }>;

  const lastNetworkBound = Math.max(...domEvents.map((e) => e.timestamp)) + 5000;

  expect(manifest.schemaVersion).toBe(1);

  /*
   * The domStream discriminant must be COHERENT, not frozen.
   *
   * M1 emitted raw rrweb; M5 lifts large assets into `assets/` and flips this
   * flag. What matters is that the manifest never lies about which it is —
   * a player that trusts `transformed: false` and then meets asset references
   * renders broken images with no clue why.
   */
  expect(manifest.domStream.format).toBe('rrweb');
  const assetFiles = present.filter((p) => p.startsWith('assets/'));
  if (manifest.domStream.transformed) {
    expect(manifest.domStream.assetRefScheme).toBe('rewind-asset-v1');
    expect(assetFiles.length).toBeGreaterThan(0);
    expect(strFromU8(entries['dom-events.json'] as Uint8Array)).toContain(
      'rewind-asset:',
    );
  } else {
    expect(assetFiles).toHaveLength(0);
  }
  expect(manifest.counts.dom).toBe(domEvents.length);
  expect(manifest.counts.marker).toBe(1);

  expect(meta.tester.name).toBe('Siddharth');
  expect(meta.markers[0]?.label).toBe('sorted by total');

  // The scripted scenario sorts and filters the orders table, each of which
  // issues a request; a zero here means the patches silently stopped working.
  const network = JSON.parse(
    strFromU8(entries['network-events.json'] as Uint8Array),
  ) as Array<{ url: string; timestamp: number; phase: string }>;
  expect(manifest.counts.network).toBe(network.length);
  expect(network.length).toBeGreaterThan(0);
  expect(network.some((e) => e.url.includes('/api/orders'))).toBe(true);

  // Network events must share the DOM stream's epoch axis, or M3's
  // jump-to-call seeks to the wrong moment.
  for (const entry of network) {
    expect(entry.timestamp).toBeGreaterThanOrEqual(meta.clock.epochMs - 1000);
    expect(entry.timestamp).toBeLessThanOrEqual(lastNetworkBound);
  }

  // rrweb type 2 is the full snapshot; without one the replay has nothing to
  // build its initial DOM from and the player renders an empty frame.
  expect(domEvents.some((event) => event.type === 2)).toBe(true);

  // Every event must sit on the epoch axis anchored at the clock origin. A
  // timestamp before the origin means something used a different clock.
  for (const event of domEvents) {
    expect(event.timestamp).toBeGreaterThanOrEqual(meta.clock.epochMs - 1000);
  }

  // The marker must fall inside the recorded window, or the player cannot place
  // it on the scrubber.
  const lastTimestamp = Math.max(...domEvents.map((e) => e.timestamp));
  expect(meta.markers[0]!.timestamp).toBeLessThanOrEqual(lastTimestamp + 1000);

  mkdirSync(dirname(FIXTURE_PATH), { recursive: true });
  writeFileSync(FIXTURE_PATH, bytes);
});
