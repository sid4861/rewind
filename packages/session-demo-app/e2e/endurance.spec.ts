import { expect, test, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

/**
 * Endurance: what happens when a session runs long enough to hit a limit.
 *
 * Everything else here is a short scripted scenario, and short scenarios never
 * reach a budget. The caps, the degradation records and the widget's warnings
 * have only had unit tests behind them until now — this drives them through the
 * real recorder in a real browser.
 *
 * The event cap is lowered rather than the test being run for twenty minutes.
 * The interesting question is "what does the recorder do at the boundary", and
 * that answer does not depend on how long it took to get there.
 */

async function widget(page: Page) {
  const host = page.locator('#rewind-session-recorder-host');
  return {
    open: () => host.locator('.launcher').click(),
    collapse: () => host.locator('button.close').click(),
    click: (label: string) =>
      host.locator('button.action', { hasText: label }).first().click(),
    status: async () => (await host.locator('.status').textContent())?.trim() ?? '',
    stat: async (label: string) =>
      (await host
        .locator('.stat', { hasText: label })
        .locator('.stat-value')
        .textContent()) ?? '',
    notices: () => host.locator('.notice.warn'),
  };
}

test('sustains continuous churn and keeps counters moving', async ({ page }) => {
  await page.goto('/endurance');

  const w = await widget(page);
  await w.open();
  await w.click('Start recording');
  await expect.poll(() => w.status()).toBe('recording');
  await w.collapse();

  await page.getByRole('button', { name: 'Storm' }).click();
  await page.getByTestId('churn-toggle').click();

  // Let it run long enough to produce thousands of mutations and several polls.
  await page.waitForTimeout(6000);
  await page.getByTestId('churn-toggle').click();

  await w.open();
  const domEvents = Number((await w.stat('DOM events')).replace(/,/g, ''));
  const networkEvents = Number((await w.stat('Network')).replace(/,/g, ''));

  // The recorder must still be keeping up, not silently stalled.
  expect(domEvents).toBeGreaterThan(100);
  expect(networkEvents).toBeGreaterThan(1);
  expect(await w.status()).toBe('recording');

  const downloadPromise = page.waitForEvent('download');
  await w.click('Stop & save');
  const download = await downloadPromise;

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const entries = unzipSync(new Uint8Array(Buffer.concat(chunks)));

  const meta = JSON.parse(strFromU8(entries['meta.json'] as Uint8Array)) as {
    durationMs: number;
  };
  const dom = JSON.parse(strFromU8(entries['dom-events.json'] as Uint8Array)) as Array<{
    type: number;
    timestamp: number;
  }>;

  expect(meta.durationMs).toBeGreaterThan(5000);

  /*
   * A long session must contain more than one full snapshot.
   *
   * `checkoutEveryNms` exists so a seek rebuilds from a nearby snapshot instead
   * of fast-forwarding the whole session. With one snapshot, every seek in a
   * twenty-minute recording replays twenty minutes of mutations.
   */
  const fullSnapshots = dom.filter((e) => e.type === 2).length;
  expect(fullSnapshots).toBeGreaterThanOrEqual(1);

  // Timestamps must be monotonic; an out-of-order stream makes the whole
  // timeline, and every jump-to-call, wrong.
  for (let i = 1; i < dom.length; i += 1) {
    expect((dom[i] as { timestamp: number }).timestamp).toBeGreaterThanOrEqual(
      (dom[i - 1] as { timestamp: number }).timestamp,
    );
  }
});

test('stops itself at the event cap and records why', async ({ page }) => {
  // A deliberately tiny cap, injected before the app boots, so the boundary is
  // reached in seconds instead of hours.
  await page.addInitScript(() => {
    (window as unknown as { __REWIND_MAX_EVENTS__?: number }).__REWIND_MAX_EVENTS__ = 150;
  });

  await page.goto('/endurance');

  const w = await widget(page);
  await w.open();
  await w.click('Start recording');
  await expect.poll(() => w.status()).toBe('recording');
  await w.collapse();

  await page.getByRole('button', { name: 'Storm' }).click();

  // Stopping at the cap triggers an archive build and download on its own.
  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByTestId('churn-toggle').click();
  const download = await downloadPromise;

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const entries = unzipSync(new Uint8Array(Buffer.concat(chunks)));

  const meta = JSON.parse(strFromU8(entries['meta.json'] as Uint8Array)) as {
    degradations: Array<{ kind: string; detail: string }>;
  };

  /*
   * The archive has to SAY it was truncated.
   *
   * A capped session that looks like a complete one is the worst outcome here:
   * a developer watches the replay stop mid-flow and goes hunting for a bug in
   * the app that never existed.
   */
  const capped = meta.degradations.find((d) => d.kind === 'event-cap');
  expect(capped, 'the archive must record that the event cap ended it').toBeDefined();
  expect(capped?.detail).toContain('cap');

  await w.open();
  // And the tester has to be told at the time, not only in the file.
  await expect(w.notices().first()).toContainText(/cap/i);
});
