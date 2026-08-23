// Vitest configuration for @cplieger/fetch unit tests.
//
// The whole suite runs in Browser Mode against headless Chromium. No test in
// this package touches the DOM; what they exercise is the platform fetch
// envelope — `Response`, `Headers`, `URL`, `AbortSignal`, `ReadableStream` —
// and the browser is the runtime this library ships into, so those globals are
// the real implementations here rather than an emulator's stand-ins. That
// matters most for the strict-validation tests, which need a platform that
// actually rejects a bad header name or a negative timeout.
//
// There is no `environment` setting, no per-file environment pragma and no
// node/browser project split: Browser Mode is a runner rather than an
// environment, and the package has no test that needs Node capabilities or
// needs a browser global to be absent.
//
// `channel: "chromium"` opts into Chromium's newer headless mode, the real
// browser rather than the separate headless-shell build. CI installs it with
// `npx playwright install --with-deps chromium`; locally it is a one-time
// `npx --no-install playwright install chromium`.
//
// Run: vitest --run (single pass) or vitest (watch mode).
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({
        launchOptions: {
          channel: "chromium",
        },
      }),
      instances: [{ browser: "chromium" }],
      viewport: { width: 1280, height: 720 },
      // A failure screenshot per failing test is noise in CI and cannot be
      // read from a job log; the assertion diff is the useful artifact.
      screenshotFailures: false,
    },
    include: ["src/**/*.test.ts"],
  },
});
