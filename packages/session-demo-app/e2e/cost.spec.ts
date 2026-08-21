import { expect, test, type Page } from '@playwright/test';
import { unzipSync } from 'fflate';

/**
 * What recording actually costs.
 *
 * `balanced` exists as an opt-out from `high`, and that opt-out is only
 * justified if the difference is real. This measures both, on the same scripted
 * churn, and prints a table — so the preset defaults are a decision backed by
 * numbers rather than a guess frozen into a constants file.
 *
 * It asserts only the things that would make the tool unusable (a frame budget
 * blown, an archive that dwarfs the session) rather than pinning exact figures,
 * which vary by machine and would make this a flaky test instead of a
 * measurement.
 */

interface Measurement {
  fidelity: string;
  archiveBytes: number;
  domEvents: number;
  assetCount: number;
  churnMs: number;
  recordedMs: number;
  /** Wall-clock overhead per churn tick, recorder on vs off. */
  overheadPercent: number;
}

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

const CHURN_MS = 4000;

/*
 * The workload has to exercise what the presets actually differ on.
 *
 * A first attempt measured text-only churn and reported `balanced` and `high`
 * as byte-identical — a true measurement of the wrong thing. The presets differ
 * on `inlineImages`, `recordCanvas` and `collectFonts`, so the scenario has to
 * visit the screens with images, a canvas chart and a web font, not just a
 * scrolling list.
 */
async function runScenario(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Media' }).click();
  await expect(page.locator('.icon-item').first()).toBeVisible();
  await page.waitForTimeout(600);

  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(600);

  await page.getByRole('link', { name: 'Endurance' }).click();
  await page.getByRole('button', { name: 'Storm' }).click();
  await page.getByTestId('churn-toggle').click();
  await page.waitForTimeout(CHURN_MS);
  await page.getByTestId('churn-toggle').click();
}

/** The same scenario with the recorder OFF, as the baseline to compare against. */
async function measureBaseline(page: Page): Promise<number> {
  await page.goto('/dashboard');
  await expect(page.locator('canvas')).toBeVisible();

  const started = Date.now();
  await runScenario(page);
  const elapsed = Date.now() - started;

  const rows = await page.getByTestId('feed').locator('.feed-row').count();
  expect(rows, 'baseline scenario produced no rows').toBeGreaterThan(0);
  return elapsed;
}

async function measure(page: Page, fidelity: string): Promise<Measurement> {
  await page.addInitScript((mode) => {
    (window as unknown as { __REWIND_FIDELITY__?: string }).__REWIND_FIDELITY__ = mode;
  }, fidelity);

  await page.goto('/dashboard');
  await expect(page.locator('canvas')).toBeVisible();

  const w = await widget(page);
  await w.open();
  await w.click('Start recording');
  await expect.poll(() => w.status()).toBe('recording');
  await w.collapse();

  const started = Date.now();
  await runScenario(page);
  const churnMs = Date.now() - started;

  await w.open();
  const downloadPromise = page.waitForEvent('download');
  await w.click('Stop & save');
  const download = await downloadPromise;

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const bytes = Buffer.concat(chunks);
  const entries = unzipSync(new Uint8Array(bytes));

  const dom = JSON.parse(
    Buffer.from(entries['dom-events.json'] as Uint8Array).toString(),
  ) as unknown[];
  const meta = JSON.parse(Buffer.from(entries['meta.json'] as Uint8Array).toString()) as {
    durationMs: number;
  };

  return {
    fidelity,
    archiveBytes: bytes.byteLength,
    domEvents: dom.length,
    assetCount: Object.keys(entries).filter((k) => k.startsWith('assets/')).length,
    churnMs,
    recordedMs: meta.durationMs,
    overheadPercent: 0,
  };
}

test('measures the cost of recording, and whether the balanced preset earns its place', async ({
  page,
}) => {
  const baselineMs = await measureBaseline(page);

  const results: Measurement[] = [];
  for (const fidelity of ['balanced', 'high']) {
    const m = await measure(page, fidelity);
    m.overheadPercent = ((m.churnMs - baselineMs) / baselineMs) * 100;
    results.push(m);
  }

  const table = results
    .map(
      (m) =>
        `  ${m.fidelity.padEnd(10)} ${(m.archiveBytes / 1024).toFixed(0).padStart(7)} KB  ` +
        `${String(m.domEvents).padStart(6)} events  ` +
        `${String(m.assetCount).padStart(3)} assets  ` +
        `${m.overheadPercent >= 0 ? '+' : ''}${m.overheadPercent.toFixed(1)}% wall time`,
    )
    .join('\n');

  // eslint-disable-next-line no-console
  console.log(
    `\nRECORDING COST (${CHURN_MS / 1000}s of storm churn, baseline ${baselineMs}ms)\n${table}\n`,
  );

  const balanced = results.find((r) => r.fidelity === 'balanced');
  const high = results.find((r) => r.fidelity === 'high');
  expect(balanced).toBeDefined();
  expect(high).toBeDefined();

  // Both must actually have recorded the churn, or the comparison is vacuous.
  for (const m of results) {
    expect(m.domEvents, `${m.fidelity} captured nothing`).toBeGreaterThan(20);
    expect(m.recordedMs).toBeGreaterThan(CHURN_MS * 0.5);
  }

  /*
   * The guard that matters: recording must not make the app unusable.
   *
   * A generous ceiling on purpose — this runs on shared CI hardware alongside
   * a dev server, and a tight bound would fail for reasons that have nothing to
   * do with the recorder. It still catches an order-of-magnitude regression,
   * which is the failure mode worth defending against.
   */
  for (const m of results) {
    expect(
      m.overheadPercent,
      `${m.fidelity} more than doubled the wall time of the same work`,
    ).toBeLessThan(100);
  }

  /*
   * Is `balanced` justified?
   *
   * If it is not meaningfully cheaper than `high`, it is a knob that only adds
   * confusion and the honest move is to delete it. Two separate timed runs are
   * never byte-identical, so this allows a small margin for noise and fails only
   * if `balanced` is substantially the MORE expensive of the two — which would
   * mean the preset is backwards.
   */
  const ratio = balanced!.archiveBytes / high!.archiveBytes;
  // eslint-disable-next-line no-console
  console.log(
    `  balanced/high archive ratio: ${ratio.toFixed(2)}x` +
      (ratio > 0.9
        ? '  <- NOT a material saving; revisit whether `balanced` earns its place'
        : '  <- balanced is materially cheaper, as intended'),
  );

  expect(
    ratio,
    'balanced produced a substantially LARGER archive than high; the preset is backwards',
  ).toBeLessThan(1.1);
});
