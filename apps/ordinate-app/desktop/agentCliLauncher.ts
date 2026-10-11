function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export function agentCliLauncher(executable: string, cli: string): string {
  return `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${shellQuote(executable)} ${shellQuote(cli)} "$@"\n`;
}

export function agentCliCommand(command: "inspect" | "validate" | "evaluate"): string {
  return `./ordinate-cli ${command} Workbook.ord`;
}
