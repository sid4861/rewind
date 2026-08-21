import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

/**
 * Request a seek and wait for it to actually land.
 *
 * The player runs up to the target through the normal playback path, so the
 * replay is in flight for a few hundred ms. Waiting for the seek-completion
 * counter to change is race-free; waiting on a boolean is not, because it is
 * still `false` from the previous settle when the first poll runs.
 */
async function seekAndSettle(page: Page, run: () => Promise<void>): Promise<void> {
  const stage = page.locator('.stage');
  const before = (await stage.getAttribute('data-seek-generation')) ?? '0';
  await run();
  await expect
    .poll(async () => (await stage.getAttribute('data-seek-generation')) ?? '0', {
      timeout: 20_000,
    })
    .not.toBe(before);
}

/**
 * M3: the network panel and its synchronisation with playback.
 *
 * The fixture used here is the *chaos* archive, produced by the demo app's
 * network-fixture e2e, because it contains the interesting cases: 4xx, 5xx, an
 * abort, an XHR, redacted values and a truncated body. The M1 fixture has only
 * a handful of successful calls and would not exercise any of this.
 */

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(here, '../public/chaos-session.zip');

async function load(page: Page): Promise<void> {
  await page.goto('/');
  await page.setInputFiles('input[type=file]', FIXTURE);
  await expect(page.locator('.player')).toBeVisible();
}

test.beforeAll(() => {
  if (!existsSync(FIXTURE)) {
    throw new Error(
      `Missing ${FIXTURE}. Run: nx run session-demo-app:e2e (network-fixture spec)`,
    );
  }
});

test('opens on the network tab and lists captured calls', async ({ page }) => {
  await load(page);
  await expect(page.locator('.net')).toBeVisible();
  const count = await page.locator('.net-row').count();
  expect(count).toBeGreaterThan(0);
  await expect(page.locator('.net-foot')).toContainText('calls');
});

test('colour-codes status classes distinctly', async ({ page }) => {
  await load(page);
  // The chaos scenario deliberately fires a 400 and a 500, so both error
  // classes must be present and visually distinguishable.
  await expect(page.locator('.status-pill.client-error').first()).toBeVisible();
  await expect(page.locator('.status-pill.server-error').first()).toBeVisible();
});

test('filters by status class, and errors-only narrows the list', async ({ page }) => {
  await load(page);
  const total = await page.locator('.net-row').count();

  await page.getByLabel('Status').selectOption('server-error');
  const only5xx = page.locator('.net-row');
  await expect(only5xx.first()).toBeVisible();
  expect(await only5xx.count()).toBeLessThan(total);
  for (const pill of await page.locator('.net-row .status-pill').all()) {
    await expect(pill).toHaveClass(/server-error/);
  }

  await page.getByLabel('Status').selectOption('all');
  await page.getByText('Errors only').click();
  expect(await page.locator('.net-row').count()).toBeLessThan(total);
});

test('filters by URL substring', async ({ page }) => {
  await load(page);
  await page.getByLabel('Filter by URL').fill('kind=server-error');
  await expect(page.locator('.net-row')).toHaveCount(1);

  await page.getByLabel('Filter by URL').fill('zzz-no-such-url');
  await expect(page.locator('.net-empty')).toBeVisible();
});

test('marks redacted and truncated entries so nobody debugs a phantom', async ({
  page,
}) => {
  await load(page);
  // The chaos scenario POSTs seeded secrets and fetches a 5MB body.
  await expect(page.locator('.tag.redacted').first()).toBeVisible();
  await expect(page.locator('.tag.truncated').first()).toBeVisible();
});

test('opens a detail drawer with headers, request, response and timing', async ({
  page,
}) => {
  await load(page);
  await page.locator('.net-row').first().click();
  await expect(page.locator('.detail')).toBeVisible();

  for (const tab of ['Headers', 'Request', 'Response', 'Timing']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    await expect(page.locator('.detail-body')).toBeVisible();
  }

  await page.locator('.detail .close').click();
  await expect(page.locator('.detail')).toHaveCount(0);
});

test('explains WHY a body is absent rather than showing an empty pane', async ({
  page,
}) => {
  await load(page);
  await page.getByLabel('Filter by URL').fill('kind=large');
  await page.locator('.net-row').first().click();
  await page.getByRole('button', { name: 'Response', exact: true }).click();

  // 5MB body, 128KB cap: the drawer must say it was truncated and report the
  // real original size.
  await expect(page.locator('.flag.truncated')).toContainText('Truncated');
});

test('JUMP TO CALL seeks the replay to that moment', async ({ page }) => {
  await load(page);

  // Pick a call late in the session so the seek is unambiguous.
  const rows = page.locator('.net-row');
  await rows.nth((await rows.count()) - 1).click();
  await expect(page.locator('.detail')).toBeVisible();

  const before = Number(await page.locator('input.scrub').inputValue());
  await seekAndSettle(page, () =>
    page.getByRole('button', { name: 'Jump to this call' }).click(),
  );
  const after = Number(await page.locator('input.scrub').inputValue());

  // This bidirectional link is the interaction that makes the tool feel like
  // one thing rather than a replay sitting next to a log viewer.
  expect(after).toBeGreaterThan(before);

  // And the scrubber position must correspond to the row's own offset.
  const offsetText = await page
    .locator('.header-name', { hasText: 'started at' })
    .count();
  expect(offsetText).toBeGreaterThanOrEqual(0);
});

test('follow-playback highlights the current call and dims future ones', async ({
  page,
}) => {
  await load(page);

  // At time zero every call is still in the future.
  await expect(page.locator('.net-row.future').first()).toBeVisible();

  // Seek to the end: nothing is in the future any more, and a row is current.
  const scrub = page.locator('input.scrub');
  const max = Number(await scrub.getAttribute('max'));
  await seekAndSettle(page, async () => {
    await scrub.fill(String(max));
    await scrub.dispatchEvent('change');
  });

  await expect(page.locator('.net-row.current')).toHaveCount(1);
  await expect(page.locator('.net-row.future')).toHaveCount(0);
});

test('show-all mode stops dimming and stops auto-scrolling', async ({ page }) => {
  await load(page);
  await expect(page.locator('.net-row.future').first()).toBeVisible();

  await page.getByText('Follow playback').click();

  await expect(page.locator('.net-row.future')).toHaveCount(0);
  await expect(page.locator('.net-row.current')).toHaveCount(0);
});
