import { expect, test, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

/**
 * Redaction fuzzing — the M2 exit criterion.
 *
 * This test greps the RAW ARCHIVE BYTES, not the parsed event objects. That
 * distinction is the whole point: a secret could survive in a place the schema
 * does not model — a stray header we forgot to normalize, a URL echoed inside a
 * response body, an rrweb input mutation, a key nobody thought of. Parsing first
 * would only check the places we already know to look.
 *
 * Every needle below is seeded by the demo app on purpose.
 */

const NEEDLES = {
  password: 'hunter2-CORRECT-horse',
  cardNumber: '4111 1111 1111 1111',
  cardDigits: '4111111111111111',
  cvv: 'cvv',
  apiKey: 'sk_test_seeded_0000000000000000',
  jwtHead: 'eyJhbGciOiJIUzI1NiJ9',
} as const;

async function widget(page: Page) {
  const host = page.locator('#rewind-session-recorder-host');
  return {
    open: () => host.locator('.launcher').click(),
    // Collapse back to the 44px launcher. The expanded panel is a real overlay
    // that covers app content, so a test driving the app underneath has to put
    // it away first — exactly as a tester would.
    collapse: () => host.locator('button.close').click(),
    click: (label: string) =>
      host.locator('button.action', { hasText: label }).first().click(),
    status: async () => (await host.locator('.status').textContent())?.trim() ?? '',
    stat: async (label: string) =>
      (await host
        .locator('.stat', { hasText: label })
        .locator('.stat-value')
        .textContent()) ?? '',
  };
}

test('seeded secrets never reach the archive bytes', async ({ page }) => {
  await page.goto('/chaos');

  const w = await widget(page);
  await w.open();
  await w.click('Start recording');
  await expect.poll(() => w.status()).toBe('recording');
  await w.collapse();

  // Fire the two requests that carry secrets, plus a benign one so the archive
  // proves capture is actually working rather than silently empty.
  await page.getByRole('button', { name: /POST with seeded secrets/ }).click();
  await expect(page.locator('.chaos-line')).toHaveCount(1);

  await page.getByRole('button', { name: /Token in query string/ }).click();
  await expect(page.locator('.chaos-line')).toHaveCount(2);

  await page.getByRole('button', { name: /^200 OK/ }).click();
  await expect(page.locator('.chaos-line')).toHaveCount(3);

  // Also type a secret into the billing form, so input masking is covered by
  // the same grep rather than trusted separately.
  await page.getByRole('link', { name: 'Billing' }).click();
  await page.getByLabel('Name on account').fill('Ada Lovelace');
  await page.waitForTimeout(500);

  await w.open();
  await expect.poll(() => w.stat('Network')).not.toBe('0');

  const downloadPromise = page.waitForEvent('download');
  await w.click('Stop & save');
  const download = await downloadPromise;

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const bytes = new Uint8Array(Buffer.concat(chunks));

  const entries = unzipSync(bytes);

  // Decompressed, because the zip container obscures plaintext; a secret that
  // survives compression is still a secret that shipped.
  const decompressed = Object.entries(entries)
    .map(([path, data]) => `\n===== ${path} =====\n${strFromU8(data)}`)
    .join('');

  /*
   * This app opts OUT of header redaction and input masking, so the bearer
   * token and the API key ARE expected in the archive — that is configured
   * behaviour, not a leak.
   *
   * What must still hold is every dimension the opt-out did not cover: body
   * keys at any depth, query parameters, value-shape patterns, and the
   * per-element `data-record-mask`. A reduction in one place quietly widening
   * another is precisely the regression worth fearing, so each is asserted
   * separately below.
   */
  const capturedByDesign = new Set(['jwtHead', 'apiKey']);

  for (const [name, needle] of Object.entries(NEEDLES)) {
    if (name === 'cvv') continue; // key name is fine; the value is what matters
    if (capturedByDesign.has(name)) continue;
    expect(decompressed, `secret "${name}" survived into the archive`).not.toContain(
      needle,
    );
  }

  // The opt-in actually took effect, or everything above passes for the wrong
  // reason.
  expect(
    decompressed,
    'captureHeaders was configured but the header was still redacted',
  ).toContain(NEEDLES.jwtHead);

  // The same key is ALSO sent as ?access_token=. Query redaction is a separate
  // rule and must keep holding even though the header is now captured.
  const urls = (
    JSON.parse(strFromU8(entries['network-events.json'] as Uint8Array)) as Array<{
      url: string;
    }>
  ).map((e) => e.url);
  const tokenUrl = urls.find((u) => u.includes('access_token'));
  expect(tokenUrl, 'the token-in-URL request was not captured').toBeDefined();
  expect(tokenUrl, 'query-param redaction stopped working').not.toContain(NEEDLES.apiKey);

  // And the card field stays masked because it carries data-record-mask — the
  // per-element hatch still protects one input with global masking switched off.
  expect(
    decompressed,
    'data-record-mask stopped protecting the card field',
  ).not.toContain(NEEDLES.cardNumber);

  // Prove the archive is not simply empty — a test that passes because nothing
  // was captured is worthless.
  const manifest = JSON.parse(strFromU8(entries['manifest.json'] as Uint8Array)) as {
    counts: { network: number };
  };
  expect(manifest.counts.network).toBeGreaterThan(0);

  const meta = JSON.parse(strFromU8(entries['meta.json'] as Uint8Array)) as {
    redaction: {
      counts: Record<string, number>;
      headerDenylist: string[];
      maskAllInputs: boolean;
      capturedHeaders: string[] | 'all';
    };
  };

  // The counters are evidence that redaction actually ran, rather than that the
  // secrets happened never to be captured in the first place. Header count is
  // no longer asserted: this app captures those headers by choice.
  expect(meta.redaction.counts.bodyKeys).toBeGreaterThan(0);
  expect(meta.redaction.counts.queryParams).toBeGreaterThan(0);

  /*
   * The archive must DECLARE that it captured more than the defaults.
   *
   * A report saying `maskAllInputs: true` while inputs were recorded would be
   * worse than no report — reassuring and wrong. Anyone opening this file can
   * see what they are holding without reading the recording app's config.
   */
  expect(meta.redaction.maskAllInputs).toBe(false);
  expect(meta.redaction.capturedHeaders).toContain('authorization');
  // A captured header is no longer advertised as being on the denylist.
  expect(meta.redaction.headerDenylist).not.toContain('authorization');

  // The benign field must survive; redaction that eats everything is useless.
  expect(decompressed).toContain('this must survive');
});

test('records network calls with accurate status, method and timing', async ({
  page,
}) => {
  await page.goto('/chaos');

  const w = await widget(page);
  await w.open();
  await w.click('Start recording');
  await expect.poll(() => w.status()).toBe('recording');
  await w.collapse();

  await page.getByRole('button', { name: /^400 Bad Request/ }).click();
  await expect(page.locator('.chaos-line')).toHaveCount(1);
  await page.getByRole('button', { name: /^500 Server Error/ }).click();
  await expect(page.locator('.chaos-line')).toHaveCount(2);
  await page.getByRole('button', { name: /XHR request/ }).click();
  await expect(page.locator('.chaos-line')).toHaveCount(3);
  await page.getByRole('button', { name: /Aborted request/ }).click();
  await expect(page.locator('.chaos-line')).toHaveCount(4);

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
    method: string;
    url: string;
    source: string;
    phase: string;
    response: { status: number } | null;
    timing: { durationMs: number | null };
  }>;

  expect(network.length).toBeGreaterThanOrEqual(4);

  const statuses = network.map((e) => e.response?.status).filter(Boolean);
  expect(statuses).toContain(400);
  expect(statuses).toContain(500);

  // The XHR patch must produce entries too, tagged distinctly from fetch.
  expect(network.some((e) => e.source === 'xhr')).toBe(true);

  // An aborted request is its own phase, not a generic failure.
  expect(network.some((e) => e.phase === 'aborted')).toBe(true);

  for (const entry of network) {
    expect(entry.method).toMatch(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/);
    if (entry.phase === 'complete') {
      expect(entry.timing.durationMs).not.toBeNull();
      expect(entry.timing.durationMs!).toBeGreaterThanOrEqual(0);
    }
  }
});

test('app-declared exclusions keep their content out of the archive', async ({
  page,
}) => {
  /*
   * The built-in denylists cover credentials, which are predictable. An app
   * also needs a way to say "not this panel" about its own data — medical
   * notes, a third-party embed, anything the recorder could not know about.
   *
   * Asserted against RAW archive bytes, same as the credential fuzzing: the
   * question is whether the string is in the file, not whether the schema
   * models a field for it.
   */
  await page.goto('/components');
  await expect(page.locator('.exclusion').first()).toBeVisible();

  const w = await widget(page);
  await w.open();
  await w.click('Start recording');
  await expect.poll(() => w.status()).toBe('recording');
  await w.collapse();

  // Interact so the region is captured in a mutation, not only the snapshot.
  await page.getByRole('button', { name: 'Open modal' }).click();
  await expect(page.locator('.modal')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  /*
   * `data-record-ignore` is a DIFFERENT guarantee from the other two, verified
   * against rrweb's source: it suppresses input EVENTS, it does not remove
   * content. Typing here must leave no input event in the stream at all — not
   * merely a masked one — because sometimes the fact that someone typed is
   * itself the sensitive part.
   */
  await page.getByLabel('Ignored input').fill('typed-into-ignored-field');
  await page.waitForTimeout(600);

  await w.open();
  const downloadPromise = page.waitForEvent('download');
  await w.click('Stop & save');
  const download = await downloadPromise;

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const entries = unzipSync(new Uint8Array(Buffer.concat(chunks)));
  const decompressed = Object.values(entries)
    .map((data) => strFromU8(data))
    .join(String.fromCharCode(10));

  for (const needle of ['SUPER-SECRET-BLOCKED-CONTENT', 'SUPER-SECRET-MASKED-CONTENT']) {
    expect(decompressed, `${needle} survived into the archive`).not.toContain(needle);
  }

  /*
   * The surrounding page must still be captured — an escape hatch that took the
   * whole screen with it would be useless.
   *
   * Asserted on the CONTAINER, not on the `data-record-block` attribute itself:
   * rrweb replaces a blocked element with a placeholder and never serializes
   * its attributes, so looking for the marker would fail precisely when the
   * feature is working.
   */
  expect(decompressed).toContain('exclusion-grid');
  expect(decompressed).toContain('App-declared exclusions');
});
