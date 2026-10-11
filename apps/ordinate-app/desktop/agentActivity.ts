type StartedItem = { type: string; command?: string };

/** Activity labels describe observed tool work, not guessed completion percentages. */
export function activityForStartedItem(item: StartedItem): string | null {
  if (item.type === "fileChange") return "Editing the working copy";
  if (item.type !== "commandExecution") return null;
  const command = item.command ?? "";
  if (/\bordinate-cli(?:\.mjs)?\b[^\n]*\bvalidate\b/.test(command)) return "Checking workbook structure";
  if (/\bordinate-cli(?:\.mjs)?\b[^\n]*\bevaluate\b/.test(command)) return "Calculating formulas";
  if (/\bordinate-cli(?:\.mjs)?\b[^\n]*\binspect\b/.test(command)) return "Inspecting workbook";
  if (/\b(?:SKILL|AGENTS)\.md\b/.test(command)) return "Reading authoring guidance";
  if (/\bWorkbook\.ord\b/.test(command)) return "Working with the workbook";
  return null;
}

/** Stable, content-free labels shared by the activity UI and timing log. */
export function diagnosticToolCategoryForStartedItem(item: StartedItem): string | null {
  const activity = activityForStartedItem(item);
  if (activity) return activity;
  switch (item.type) {
    case "commandExecution": return "Other command";
    case "mcpToolCall": return "MCP tool";
    case "dynamicToolCall": return "Dynamic tool";
    case "collabToolCall": return "Collaboration tool";
    case "webSearch": return "Web search";
    case "imageView": return "Image view";
    default: return null;
  }
}

/** Command-family labels for opt-in trace logs. Never include arguments or file content. */
export function diagnosticCommandType(command: string): string {
  const cli = command.match(/\bordinate-cli(?:\.mjs)?\b[^\n]*?\b(inspect|validate|evaluate|edit|help)\b/);
  if (cli) return `ordinate.${cli[1]}`;
  if (/\b(?:rg|grep|find)\b/.test(command)) return "file.search";
  if (/\b(?:cat|sed|head|tail|less)\b/.test(command)) return "file.read";
  if (/\b(?:apply_patch|tee|mv|cp|touch)\b/.test(command)) return "file.write";
  return "shell.other";
}
