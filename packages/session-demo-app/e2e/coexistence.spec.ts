import { expect, test, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

/**
 * The recorder has to share `fetch` with whatever else already patched it.
 *
 * Real apps do not have a clean global. MSW, Sentry, Datadog, axios adapters and
 * analytics SDKs all wrap `fetch`, and a recorder that assumes it is alone
 * either breaks them or gets broken by them. The failure is quiet — a mock stops
 * intercepting, or a body arrives empty — and it surfaces as "the app is broken
 * when I record", which is the fastest way to get a tool uninstalled.
 *
 * The demo app deliberately ships two transports: MSW's Service Worker where it
 * can register, and a direct `fetch` patch where it cannot. The `fetch`-patch
 * path is the interesting one here, because it is a genuine competing wrapper
 * around the same global.
 */

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

const transport = (page: Page) =>
  page.evaluate(() => document.documentElement.dataset['mockTransport'] ?? 'unknown');

test('the mock transport keeps working while the recorder is active', async ({
  page,
}) => {
  await page.goto('/dashboard');
  await expect(page.locator('.metric-value').first()).toBeVisible();

  const before = await transport(page);
  expect(before, 'no mock transport came up at all').not.toBe('unknown');

  const w = await widget(page);
  await w.open();
  await w.click('Start recording');
  await expect.poll(() => w.status()).toBe('recording');
  await w.collapse();

  // Navigating re-issues the API calls, now through both wrappers.
  await page.getByRole('link', { name: 'Orders' }).click();
  await expect(page.locator('tbody tr').first()).toBeVisible();

  // The mock still answered: real rows, not an error state.
  const rows = await page.locator('tbody tr').count();
  expect(
    rows,
    'the mock stopped intercepting once the recorder patched fetch',
  ).toBeGreaterThan(0);
  expect(await transport(page)).toBe(before);

  // Let the in-flight request settle before stopping. Navigating away here
  // aborted it, so every captured entry was an abort and the assertion below
  // had nothing complete to look at — a property of the test, not the recorder.
  await page.waitForTimeout(800);

  await w.open();
  const downloadPromise = page.waitForEvent('download');
  await w.click('Stop & save');
  const download = await downloadPromise;

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const entries = unzipSync(new Uint8Array(Buffer.concat(chunks)));

  const network = JSON.parse(
    strFromU8(entries['network-events.json'] as Uint8Array),
  ) as Array<{
    url: string;
    phase: string;
    response: { status: number; body: { content: string | null } } | null;
  }>;

  const ordersCalls = network.filter((e) => e.url.includes('/api/orders'));
  expect(ordersCalls.length, 'the recorder saw no /api/orders call').toBeGreaterThan(0);

  /*
   * Deliberately the COMPLETED call, not simply the first.
   *
   * React StrictMode double-invokes effects, so the screen fires a request,
   * aborts it on cleanup, and fires another. The recorder captures both, which
   * is correct and useful — an abort is exactly the kind of thing you want to
   * see in a replay. Taking `find()` here would grab the aborted one and its
   * null response, which says nothing about coexistence.
   */
  const completed = ordersCalls.find((e) => e.phase === 'complete');
  expect(completed, 'no /api/orders call completed').toBeDefined();
  expect(completed?.response?.status).toBe(200);
  expect(completed?.response?.body.content).toContain('rows');
});

test('the app still works normally after the recorder is removed', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.locator('.metric-value').first()).toBeVisible();

  const w = await widget(page);
  await w.open();
  await w.click('Start recording');
  await expect.poll(() => w.status()).toBe('recording');
  await w.collapse();

  await page.getByRole('link', { name: 'Orders' }).click();
  await expect(page.locator('tbody tr').first()).toBeVisible();

  await w.open();
  const downloadPromise = page.waitForEvent('download');
  await w.click('Stop & save');
  await downloadPromise;
  await expect.poll(() => w.status()).toBe('idle');

  /*
   * After teardown the recorder has restored `fetch`. The mock must still be
   * underneath it — restoring a captured original over the top of another
   * library's wrapper is the classic way an interceptor breaks the page on its
   * way out, and it looks exactly like a bug in the app.
   */
  await page.getByLabel('Search orders').fill('Lovelace');
  await expect(page.locator('.pager')).toContainText('orders');
  await expect(page.locator('tbody tr').first()).toBeVisible();

  const rows = await page.locator('tbody tr').count();
  expect(rows, 'the mock broke after the recorder restored fetch').toBeGreaterThan(0);
});

test('a library that patches fetch AFTER us keeps working', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.locator('.metric-value').first()).toBeVisible();

  const w = await widget(page);
  await w.open();
  await w.click('Start recording');
  await expect.poll(() => w.status()).toBe('recording');
  await w.collapse();

  /*
   * Simulates Sentry or Datadog initialising after the recorder — a completely
   * ordinary ordering, since analytics often load late.
   *
   * On stop, the recorder must NOT restore its captured original over the top
   * of this wrapper. Doing so would silently delete another library's
   * instrumentation, which is worse than leaving ours installed.
   */
  await page.evaluate(() => {
    const inner = window.fetch;
    (window as unknown as { __lateCalls?: number }).__lateCalls = 0;
    window.fetch = function lateWrapper(...args: Parameters<typeof fetch>) {
      (window as unknown as { __lateCalls: number }).__lateCalls += 1;
      return inner.apply(window, args);
    } as typeof fetch;
  });

  await page.getByRole('link', { name: 'Orders' }).click();
  await expect(page.locator('tbody tr').first()).toBeVisible();

  await w.open();
  const downloadPromise = page.waitForEvent('download');
  await w.click('Stop & save');
  await downloadPromise;
  await expect.poll(() => w.status()).toBe('idle');

  // Still ours? No — still THEIRS. That is the point.
  const stillWrapped = await page.evaluate(() => window.fetch.name === 'lateWrapper');
  expect(stillWrapped, 'the recorder clobbered a wrapper installed after it').toBe(true);

  // And their wrapper is still counting calls, i.e. still functioning.
  const before = await page.evaluate(
    () => (window as unknown as { __lateCalls: number }).__lateCalls,
  );
  await page.getByLabel('Search orders').fill('Ada');
  // The search is debounced, so poll rather than reading once — a single read
  // races the debounce and fails for a reason unrelated to coexistence.
  await expect
    .poll(
      () =>
        page.evaluate(() => (window as unknown as { __lateCalls: number }).__lateCalls),
      { timeout: 15_000 },
    )
    .toBeGreaterThan(before);
});
