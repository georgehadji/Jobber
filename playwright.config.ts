import { defineConfig } from '@playwright/test';

// The a11y suite runs against the built output, served statically — the same bytes CI
// deploys. Testing a dev server would test something the visitor never receives.
export default defineConfig({
  testDir: './tests',
  use: { baseURL: 'http://localhost:4321' },
  webServer: {
    command: 'npm run serve',
    url: 'http://localhost:4321',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
