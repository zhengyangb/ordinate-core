import { describe, expect, it } from "vitest";
import { activityForStartedItem, diagnosticCommandType, diagnosticToolCategoryForStartedItem } from "./agentActivity";

describe("agent activity labels", () => {
  it("describes observed workbook operations without exposing commands", () => {
    expect(activityForStartedItem({ type: "commandExecution", command: "node ordinate-cli.mjs evaluate Workbook.ord" })).toBe("Calculating formulas");
    expect(activityForStartedItem({ type: "commandExecution", command: "sed -n '1,40p' ordinate-authoring/SKILL.md" })).toBe("Reading authoring guidance");
    expect(activityForStartedItem({ type: "fileChange" })).toBe("Editing the working copy");
    expect(activityForStartedItem({ type: "commandExecution", command: "pwd" })).toBeNull();
  });
  it("uses fixed diagnostic categories even when a command is unrecognized", () => {
    expect(diagnosticToolCategoryForStartedItem({ type: "commandExecution", command: "secret work text" })).toBe("Other command");
    expect(diagnosticToolCategoryForStartedItem({ type: "commandExecution", command: "ordinate-cli evaluate Workbook.ord" })).toBe("Calculating formulas");
    expect(diagnosticToolCategoryForStartedItem({ type: "mcpToolCall" })).toBe("MCP tool");
  });
  it("classifies command families without returning paths or arguments", () => {
    expect(diagnosticCommandType("node ordinate-cli.mjs inspect /secret/Workbook.ord")).toBe("ordinate.inspect");
    expect(diagnosticCommandType("sed -n '1,50p' /secret/Workbook.ord")).toBe("file.read");
    expect(diagnosticCommandType("rg Revenue /secret/Workbook.ord")).toBe("file.search");
    expect(diagnosticCommandType("printf 'private data' > Workbook.ord")).toBe("shell.other");
  });
});
