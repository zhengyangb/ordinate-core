import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/rfc_0042_*.test.ts", "tests/rfc_0044_excel.test.ts", "tests/rfc_0046_0047_*.test.ts"],
    coverage: {
      enabled: true,
      provider: "v8",
      include: ["src/excel.ts", "src/excel/**/*.ts", "src/runtime/spreadsheetAddress.ts"],
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "coverage/excel",
      thresholds: { statements: 95, lines: 95, functions: 95, branches: 90 },
    },
  },
});
