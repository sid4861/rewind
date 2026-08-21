import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  // The fidelity harness seeks ten checkpoints, each with a run-up through the
  // normal playback path; the 30s default cuts it off mid-run and it then
  // screenshots a replay that has not arrived yet.
  timeout: 180_000,
  use: {
    baseURL: 'http://localhost:4400',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /fidelity\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      /*
       * The fidelity harness needs the replay rendered 1:1.
       *
       * The player letterboxes and clamps scale at 1, so the window has to be
       * large enough that no downscaling happens: the stage area is
       * (width - 320px panels) x (height - 154px of header/timeline/controls),
       * and it must exceed the recorded 1280x800 viewport. The spec asserts
       * scale === 1 rather than trusting this arithmetic.
       */
      name: 'fidelity',
      testMatch: /fidelity\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1720, height: 1010 } },
    },
  ],
  webServer: {
    command: 'yarn rsbuild dev',
    url: 'http://localhost:4400',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
