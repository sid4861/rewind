import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  // The fidelity scenario walks nine checkpoints with settle time at each; the
  // 30s default is not enough for it.
  timeout: 120_000,
  use: {
    baseURL: 'http://localhost:4300',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Must come *after* the device spread: `devices['Desktop Chrome']`
        // carries its own viewport and would otherwise win. A fixed viewport is
        // what makes the archive reproducible — the recorded dimensions land in
        // meta.json and the player letterboxes to them, so a varying window
        // size would change the fixture on every run.
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
  webServer: {
    command: 'yarn rsbuild dev',
    url: 'http://localhost:4300',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
