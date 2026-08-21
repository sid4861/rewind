import { expect, test, type Page } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';

/**
 * M4: console, errors and navigation capture.
 *
 * The demanding assertions here are the ones about *not breaking the host*:
 * the app's own console output must still appear, and a circular object must
 * not take `console.log` down with it.
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

test('captures console output, errors and navigation without breaking the app', async ({
  page,
}) => {
  // Everything the page logs, as the browser saw it. If the recorder swallows
  // or mangles output, this is where it shows up.
  const seen: string[] = [];
  page.on('console', (msg) => seen.push(`${msg.type()}:${msg.text()}`));
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/chaos');

  const w = await widget(page);
  await w.open();
  await w.click('Start recording');
  await expect.poll(() => w.status()).toBe('recording');
  await w.collapse();

  const fire = async (name: RegExp, count: number): Promise<void> => {
    await page.getByRole('button', { name }).click();
    await expect(page.locator('.chaos-line')).toHaveCount(count);
  };

  await fire(/console\.log a circular object/, 1);
  await fire(/console\.log a DOM node/, 2);
  await fire(/console\.warn and console\.error/, 3);
  await fire(/Log a secret/, 4);
  await fire(/Uncaught error/, 5);
  await fire(/Unhandled promise rejection/, 6);

  // Navigation, so the History patch has something to record.
  await page.getByRole('link', { name: 'Orders' }).click();
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await page.getByRole('link', { name: 'Billing' }).click();
  await expect(page.getByLabel('Card number')).toBeVisible();

  await page.waitForTimeout(400);

  // THE critical assertion: the app's own console still works. A recorder that
  // silently eats console output is worse than one that captures nothing.
  expect(seen.some((line) => line.includes('circular structure'))).toBe(true);
  expect(seen.some((line) => line.includes('the sidebar element'))).toBe(true);
  expect(seen.some((line) => line.startsWith('warning:'))).toBe(true);
  expect(seen.some((line) => line.startsWith('error:'))).toBe(true);

  // The deliberate uncaught error must actually have reached the page.
  expect(pageErrors.some((m) => m.includes('Deliberate uncaught error'))).toBe(true);

  await w.open();
  const downloadPromise = page.waitForEvent('download');
  await w.click('Stop & save');
  const download = await downloadPromise;

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const entries = unzipSync(new Uint8Array(Buffer.concat(chunks)));

  const consoleEvents = JSON.parse(
    strFromU8(entries['console-events.json'] as Uint8Array),
  ) as Array<{ level: string; args: Array<{ kind: string }>; stack: string | null }>;
  const errorEvents = JSON.parse(
    strFromU8(entries['error-events.json'] as Uint8Array),
  ) as Array<{ source: string; name: string; message: string }>;
  const navEvents = JSON.parse(
    strFromU8(entries['navigation-events.json'] as Uint8Array),
  ) as Array<{ kind: string; to: string; from: string | null }>;

  expect(consoleEvents.length).toBeGreaterThanOrEqual(4);
  expect(consoleEvents.some((e) => e.level === 'warn')).toBe(true);
  expect(consoleEvents.some((e) => e.level === 'error')).toBe(true);

  // The circular object must be captured as a real structure with a cycle
  // marker, not dropped and not serialized into an infinite string.
  const serialized = JSON.stringify(consoleEvents);
  expect(serialized).toContain('circular');
  expect(serialized).toContain('"kind":"node"');

  // warn/error carry a stack; plain logs do not need one.
  expect(
    consoleEvents.some((e) => (e.level === 'warn' || e.level === 'error') && e.stack),
  ).toBe(true);

  expect(errorEvents.some((e) => e.source === 'window-error')).toBe(true);
  expect(errorEvents.some((e) => e.source === 'unhandledrejection')).toBe(true);

  // Navigation: an initial entry plus the two route changes.
  expect(navEvents[0]?.kind).toBe('initial');
  expect(navEvents.some((e) => e.to.includes('/orders'))).toBe(true);
  expect(navEvents.some((e) => e.to.includes('/checkout'))).toBe(true);

  // Console output is redacted on the same terms as network bodies.
  const allText = Object.values(entries)
    .map((data) => strFromU8(data))
    .join('\n');
  expect(allText).not.toContain('hunter2-CORRECT-horse');
  expect(allText).not.toContain('4111 1111 1111 1111');
  expect(allText).toContain('this must survive');
});
