import { defineConfig } from "vitest/config";

// Explicit integration gate: requires a real headless LibreOffice installation.
// Missing engines fail, rather than silently skipping independent recalculation.
export default defineConfig({
  test: {
    include: ["integration/excel-recalc.test.ts"],
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
