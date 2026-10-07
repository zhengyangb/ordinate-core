import ExcelJS from "exceljs";
import { DocumentState, exportExcelWorkbook } from "../../src";
import { escapeCellText } from "../../src/parser";
export type Input = number | string | boolean | null;
export function formulaDocument(formula: string, inputs: Input[][] = [[7, 2, 3], [4, 5, 6]]): DocumentState {
  return DocumentState.fromText(`# Data\n${Array.from({ length: Math.max(inputs.length, 1) }, (_, r) =>
    `| ${Array.from({ length: 10 }, (_, c) => r === 0 && c === 9 ? `= ${formula}` : inputs[r]?.[c] == null
      ? "" : escapeCellText(JSON.stringify(inputs[r][c]))).join(" | ")} |`).join("\n")}`);
}
export async function exportedFormula(document: DocumentState) {
  const result = await exportExcelWorkbook(document);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(result.value.slice().buffer);
  return { workbook, cell: workbook.worksheets[0].getCell("J1"), result };
}
