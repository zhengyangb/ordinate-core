import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/rfc_0041_*.test.ts", "tests/number_encoding.test.ts"],
    coverage: {
      enabled: true,
      provider: "v8",
      include: ["src/delimited.ts", "src/delimited_text.ts", "src/document_clone.ts", "src/number_encoding.ts"],
      reporter: ["text", "html", "json-summary"],
      reportsDirectory: "coverage/interchange",
      thresholds: { statements: 95, lines: 95, functions: 95, branches: 90 },
    },
  },
});
