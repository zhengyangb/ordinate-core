import { create } from "zustand";

import {
  applyBatchWithUndo,
  applyCoreEditMemento,
  type CoreCellTarget,
  type CoreEdit,
  type CoreEditHistoryMemento,
  type CoreRegionTarget,
  type CoreRowDeleteMode,
  type CoreRowInsertArea,
  DocumentState,
  previewDeleteColumn,
  previewDeleteRow,
  resolveDocumentPresentation,
  validateDocument,
  type CoreDeleteColumnPreview,
  type CoreDeleteRowPreview,
  type EvaluationResult,
  type FormatSpec,
  type PresentationResult,
  type StylePatch,
  type ValidationError,
  type ValidationResult,
  serializeDocumentState,
} from "@ordinate/core";
import { nextSheetName } from "../utils/sheetTabs";

export type EditorMode = "source" | "table";

interface EditorHistoryEntry {
  id: number;
  label: string;
  memento: CoreEditHistoryMemento;
  activeSheetBefore: string | null;
  activeSheetAfter: string | null;
}

export interface EditorState {
  mode: EditorMode;
  sourceText: string;
  docState: DocumentState | null;
  evaluation: EvaluationResult | null;
  presentation: PresentationResult | null;
  validation: ValidationResult | null;
  sheetIssuesByName: Record<string, ValidationError[]>;
  activeSheet: string | null;
  error: string | null;
  revision: number;
  history: EditorHistoryEntry[];
  historyCursor: number;
  savedHistoryCursor: number;
  nextHistoryId: number;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  isDirty: boolean;
  setSourceText: (text: string) => void;
  replaceDocumentText: (text: string, options?: { preserveView: boolean }) => void;
  setActiveSheet: (sheetName: string) => void;
  applyCoreEdits: (label: string, edits: CoreEdit[], nextActiveSheetHint?: string | null) => void;
  undo: () => void;
  redo: () => void;
  setCellInput: (target: CoreCellTarget, input: string) => void;
  clearCell: (target: CoreCellTarget) => void;
  insertSheet: (name?: string, sheetIndex?: number) => void;
  deleteSheet: (sheet: string) => void;
  moveSheet: (sheet: string, targetGapIndex: number) => void;
  renameSheet: (sheet: string, newName: string) => void;
  setCellLocalFormat: (target: CoreCellTarget, format: FormatSpec | null) => void;
  clearCellLocalFormat: (target: CoreCellTarget) => void;
  setCellLocalStyle: (target: CoreCellTarget, style: StylePatch) => void;
  clearCellLocalStyle: (target: CoreCellTarget) => void;
  setColumnDefaultFormat: (sheet: string, colId: number, format: FormatSpec | null) => void;
  clearColumnDefaultFormat: (sheet: string, colId: number) => void;
  setColumnDefaultStyle: (sheet: string, colId: number, style: StylePatch) => void;
  clearColumnDefaultStyle: (sheet: string, colId: number) => void;
  setRowDefaultFormat: (sheet: string, rowId: number, format: FormatSpec | null) => void;
  clearRowDefaultFormat: (sheet: string, rowId: number) => void;
  setRowDefaultStyle: (sheet: string, rowId: number, style: StylePatch) => void;
  clearRowDefaultStyle: (sheet: string, rowId: number) => void;
  setRegion: (target: CoreRegionTarget, values: string[][]) => void;
  clearRegion: (target: CoreRegionTarget) => void;
  convertRowsToHeader: (sheet: string, rowIds: number[]) => void;
  convertRowsToBody: (sheet: string, rowIds: number[], depth: number) => void;
  previewDeleteRow: (sheet: string, rowId: number, mode?: CoreRowDeleteMode) => CoreDeleteRowPreview;
  previewDeleteColumn: (sheet: string, colIndex: number) => CoreDeleteColumnPreview;
  insertRow: (sheet: string, area: CoreRowInsertArea, rowGapIndex: number, depth: number) => void;
  insertRows: (sheet: string, area: CoreRowInsertArea, rowGapIndex: number, count: number, depth: number) => void;
  deleteRow: (sheet: string, rowId: number, mode?: CoreRowDeleteMode) => void;
  deleteRows: (sheet: string, targets: Array<{ rowId: number; mode?: CoreRowDeleteMode }>) => void;
  moveColumns: (sheet: string, colIds: number[], targetGapIndex: number) => void;
  moveRows: (sheet: string, rowIds: number[], targetGapIndex: number) => void;
  duplicateColumns: (sheet: string, colIds: number[], targetGapIndex: number) => void;
  duplicateRows: (sheet: string, rowIds: number[], targetGapIndex: number) => void;
  insertColumn: (sheet: string, colIndex: number) => void;
  insertColumns: (sheet: string, colIndex: number, count: number) => void;
  deleteColumn: (sheet: string, colIndex: number) => void;
  deleteColumns: (sheet: string, colIndices: number[]) => void;
  exitSourceMode: () => void;
  enterSourceMode: () => void;
}

const sampleDocument = `# Management Report
|             || 2024 | 2024 | 2025 | 2025 |
| Line Item   || H1   | H2   | H1   | H2   |
| ----------- || ---- | ---- | ---- | ---- |
| Revenue   ||      |      |      |      |
| * Product A || 120  | 140  | 160  | 180  |
| * Product B || 80   | 95   | 105  | 120  |
| Revenue Total || = @[Revenue."Product A",_] + @[Revenue."Product B",_] | = @[Revenue."Product A",_] + @[Revenue."Product B",_] | = @[Revenue."Product A",_] + @[Revenue."Product B",_] | = @[Revenue."Product A",_] + @[Revenue."Product B",_] |
| Cost of Sales ||      |      |      |      |
| * Materials || 60   | 70   | 82   | 90   |
| * Fulfillment || 20   | 25   | 28   | 35   |
| Cost of Sales Total || = @["Cost of Sales".Materials,_] + @["Cost of Sales".Fulfillment,_] | = @["Cost of Sales".Materials,_] + @["Cost of Sales".Fulfillment,_] | = @["Cost of Sales".Materials,_] + @["Cost of Sales".Fulfillment,_] | = @["Cost of Sales".Materials,_] + @["Cost of Sales".Fulfillment,_] |
| Gross Profit || = @["Revenue Total",_] - @["Cost of Sales Total",_] | = @["Revenue Total",_] - @["Cost of Sales Total",_] | = @["Revenue Total",_] - @["Cost of Sales Total",_] | = @["Revenue Total",_] - @["Cost of Sales Total",_] |
| Operating Expense ||      |      |      |      |
| * Marketing || 15   | 16   | 20   | 22   |
| * RND || 18   | 21   | 24   | 26   |
| Opex Total || = @["Operating Expense".Marketing,_] + @["Operating Expense".RND,_] | = @["Operating Expense".Marketing,_] + @["Operating Expense".RND,_] | = @["Operating Expense".Marketing,_] + @["Operating Expense".RND,_] | = @["Operating Expense".Marketing,_] + @["Operating Expense".RND,_] |
| Operating Profit || = @["Gross Profit",_] - @["Opex Total",_] | = @["Gross Profit",_] - @["Opex Total",_] | = @["Gross Profit",_] - @["Opex Total",_] | = @["Gross Profit",_] - @["Opex Total",_] |
| Margin Ratio || = @["Operating Profit",_] / @["Revenue Total",_] | = @["Operating Profit",_] / @["Revenue Total",_] | = @["Operating Profit",_] / @["Revenue Total",_] | = @["Operating Profit",_] / @["Revenue Total",_] |

# Executive Notes
| Summary | "Revenue momentum stayed healthy in both product lines." |
| Commentary | "Cost mix improved in 2025 H2 due to procurement renegotiation." |
| Key Risk | "Supplier lead time volatility remains high for chip components." |
| Decision | "Prioritize margin quality and controlled hiring in Q4." |
| Owner | "Finance + Operations" |

# Planning Assumptions
| Metric || Value |
| ------ || ----- |
| Forecast Multiplier || 1.08 |
| Hiring Plan || 12 |
| Risk Buffer || 0.15 |

# Cross Sheet Summary
| Item || Value |
| ---- || ----- |
| Management 2025 H2 Revenue || = @["Management Report"::["Revenue Total","2025".H2]] |
| Forecast Multiplier || = @["Planning Assumptions"::["Forecast Multiplier",Value]] |
| Forecast Revenue || = @["Cross Sheet Summary"::["Management 2025 H2 Revenue",Value]] * @["Planning Assumptions"::["Forecast Multiplier",Value]] |

# Error Playground
| Line Item             || 2024 | 2025 |
| --------------------- || ---- | ---- |
| A                     || 1    | 2    |
| B                     || 3    | = sum(@[#3:#2,#2]) |
| Unknown Ref           || = @[Missing,2024] | 0 |
| Invalid Scalar Context|| = @[#2:#3,#2] | 0 |

# Regional Breakdown
| Line Item          || Jan | Feb |
| ------------------ || --- | --- |
| North America    ||     |     |
| * US               || 100 | 110 |
| * Canada           || 40  | 45  |
| EMEA             ||     |     |
| * Germany          || 60  | 70  |
| * France           || 35  | 38  |
| APAC             ||     |     |
| * Japan            || 44  | 50  |
| * Australia        || 22  | 26  |
| Grand Total        || 301 | 339 |

# Quarterly Cube
|             || 2024 | 2024 | 2024 | 2024 | 2025 | 2025 | 2025 | 2025 |
| Line Item   || H1   | H1   | H2   | H2   | H1   | H1   | H2   | H2   |
|             || Q1   | Q2   | Q3   | Q4   | Q1   | Q2   | Q3   | Q4   |
| ----------- || ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| Revenue   ||      |      |      |      |      |      |      |      |
| * Product A || 58   | 62   | 66   | 71   | 73   | 76   | 79   | 84   |
| * Product B || 41   | 44   | 46   | 49   | 52   | 55   | 57   | 61   |
| Revenue Total || = @[Revenue."Product A",_] + @[Revenue."Product B",_] | = @[Revenue."Product A",_] + @[Revenue."Product B",_] | = @[Revenue."Product A",_] + @[Revenue."Product B",_] | = @[Revenue."Product A",_] + @[Revenue."Product B",_] | = @[Revenue."Product A",_] + @[Revenue."Product B",_] | = @[Revenue."Product A",_] + @[Revenue."Product B",_] | = @[Revenue."Product A",_] + @[Revenue."Product B",_] | = @[Revenue."Product A",_] + @[Revenue."Product B",_] |
| Gross Margin % || = @["Revenue Total",_] / 120 | = @["Revenue Total",_] / 130 | = @["Revenue Total",_] / 140 | = @["Revenue Total",_] / 150 | = @["Revenue Total",_] / 160 | = @["Revenue Total",_] / 170 | = @["Revenue Total",_] / 180 | = @["Revenue Total",_] / 190 |

# A1 Style Demo
| @display     |      || {:,.1f} {::<,blue} | {:(),.2f} {::<} | {:.1%} {::<} | {::<} | {:,.2f} {::<,blue,bold} |
|              | Item || Revenue         | Cost        | Margin   | Notes | Calc                |
| -------- | ---- || -------         | ----        | ------   | ----- | ----                |
|              | Product A    || 1234.5 {::red}         | -456.7            | 0.125          | "color override" | = B2 + C2 {::red} |
|              | Product B    || 999.9 {:.3f} {::>}         | -88.1             | 0.314          | "align + format override" | = B3 + C3 {::normal} |
|              | Temporal     || 2026-03-24T14:30:00Z {::blue} | PT1H30M {::bold} | 0 | "time literals" | = B2 |
|              | Column Sum   || 0                 | 0                  | 0               | ""           | = sum(B:B) |
|              | Row Sum      || 0                 | 0                  | 0               | ""           | = sum(2:2) |
|              | Mixed        || 0                 | 0                  | 0               | "a1 + ordinate" | = B2 + @[#2,#2] |
|              | Invalid Meta || 12.5 {:bad fmt}   | 13 {:,.2f} {::purple}  | 0               | "non-blocking" | = B8 + C8 |
|              | Div Zero     || 10                | 0                  | 0               | "runtime error" | = B10 / C10 |
|              | Type Clash   || 4                 | 2                  | 0               | "text operand" | = B11 + E11 |
|              | Cycle Ref    || 0                 | 0                  | 0               | "self ref" | = @["Cycle Ref",Calc] |
|              | Parse Crash  || 0                 | 0                  | 0               | "formula parse" | = sum(B2 |
|              | Text Slice   || 0                 | 0                  | 0               | "text slicing" | = "abcdef"[1:4] |
|              | Ref Index    || 0                 | 0                  | 0               | "reference postfix index" | = @["Product A",Revenue][0] |
|              | View Slice   || 0                 | 0                  | 0               | "reference postfix slice" | = sum(@[#2:#3,Revenue][0:2]) |
|              | Matrix Slice || 0                 | 0                  | 0               | "matrix postfix slice" | = sum(@[#2:#3,Revenue:Cost][:,0]) |
`;

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function groupSheetValidationErrors(
  sheetNames: string[],
  errors: ValidationError[],
): Record<string, ValidationError[]> {
  const grouped: Record<string, ValidationError[]> = Object.fromEntries(sheetNames.map((name) => [name, []]));
  for (const issue of errors) {
    if (!issue.sheet) continue;
    if (!grouped[issue.sheet]) {
      grouped[issue.sheet] = [];
    }
    grouped[issue.sheet].push(issue);
  }
  return grouped;
}

function bootstrapFromSource(sourceText: string): Pick<
  EditorState,
  | "mode"
  | "sourceText"
  | "docState"
  | "evaluation"
  | "presentation"
  | "validation"
  | "sheetIssuesByName"
  | "activeSheet"
  | "error"
> {
  try {
    const docState = DocumentState.fromText(sourceText);
    const evaluation = docState.evaluate();
    const presentation = resolveDocumentPresentation(docState);
    const validation = validateDocument(sourceText);
    const sheetNames = docState.sheets.map((sheet) => sheet.name);
    const sheetIssuesByName = groupSheetValidationErrors(sheetNames, validation.errors);
    const firstGlobalIssue = validation.errors.find((issue) => !issue.sheet);
    return {
      mode: "table",
      sourceText,
      docState,
      evaluation,
      presentation,
      validation,
      sheetIssuesByName,
      activeSheet: docState.sheets[0]?.name ?? null,
      error: firstGlobalIssue?.message ?? null,
    };
  } catch (error) {
    return {
      mode: "source",
      sourceText,
      docState: null,
      evaluation: null,
      presentation: null,
      validation: null,
      sheetIssuesByName: {},
      activeSheet: null,
      error: toErrorMessage(error),
    };
  }
}

function deriveStateFromDocument(
  document: DocumentState,
  activeSheetHint: string | null,
): Pick<
  EditorState,
  "sourceText" | "docState" | "evaluation" | "presentation" | "validation" | "sheetIssuesByName" | "activeSheet" | "error"
> {
  const evaluation = document.evaluate();
  const presentation = resolveDocumentPresentation(document);
  const sourceText = serializeDocumentState(document);
  const validation = validateDocument(sourceText);
  const sheetNames = document.sheets.map((sheet) => sheet.name);
  const sheetIssuesByName = groupSheetValidationErrors(sheetNames, validation.errors);
  const firstGlobalIssue = validation.errors.find((issue) => !issue.sheet);
  const activeSheet = activeSheetHint && sheetNames.includes(activeSheetHint) ? activeSheetHint : sheetNames[0] ?? null;

  return {
    sourceText,
    docState: document,
    evaluation,
    presentation,
    validation,
    sheetIssuesByName,
    activeSheet,
    error: firstGlobalIssue?.message ?? null,
  };
}

function historyStatus(
  history: EditorHistoryEntry[],
  historyCursor: number,
  savedHistoryCursor: number,
): Pick<EditorState, "canUndo" | "canRedo" | "undoLabel" | "redoLabel" | "isDirty"> {
  const undoEntry = historyCursor > 0 ? history[historyCursor - 1] : undefined;
  const redoEntry = historyCursor < history.length ? history[historyCursor] : undefined;
  return {
    canUndo: undoEntry !== undefined,
    canRedo: redoEntry !== undefined,
    undoLabel: undoEntry?.label ?? null,
    redoLabel: redoEntry?.label ?? null,
    isDirty: historyCursor !== savedHistoryCursor,
  };
}

function emptyHistoryState(revision = 0): Pick<
  EditorState,
  | "revision"
  | "history"
  | "historyCursor"
  | "savedHistoryCursor"
  | "nextHistoryId"
  | "canUndo"
  | "canRedo"
  | "undoLabel"
  | "redoLabel"
  | "isDirty"
> {
  return {
    revision,
    history: [],
    historyCursor: 0,
    savedHistoryCursor: 0,
    nextHistoryId: 1,
    ...historyStatus([], 0, 0),
  };
}

const initialState = bootstrapFromSource(sampleDocument);

export const useEditorStore = create<EditorState>((set, get) => ({
  ...initialState,
  ...emptyHistoryState(),
  setSourceText: (text) => set({ sourceText: text, presentation: null, validation: null, sheetIssuesByName: {}, error: null }),
  replaceDocumentText: (text, options) => {
    const nextState = bootstrapFromSource(text);
    const previous = get();
    if (options?.preserveView) {
      if (nextState.docState?.sheets.some((sheet) => sheet.name === previous.activeSheet)) {
        nextState.activeSheet = previous.activeSheet;
      }
      if (previous.mode === "source") nextState.mode = "source";
    }
    set({
      ...nextState,
      ...emptyHistoryState(get().revision + 1),
    });
  },
  setActiveSheet: (sheetName) => set({ activeSheet: sheetName }),
  applyCoreEdits: (label, edits, nextActiveSheetHint) => {
    const state = get();
    const { docState } = state;
    if (!docState) {
      throw new Error("cannot apply core edits without an active document state");
    }

    const result = applyBatchWithUndo(docState, edits, { recalculate: false });
    if (!result.ok) {
      throw new Error(`[${result.error.category}] ${result.error.message}`);
    }

    const currentMode = state.mode;
    const activeHint = nextActiveSheetHint ?? state.activeSheet;
    const nextDocumentState = deriveStateFromDocument(result.nextDocument, activeHint);
    if (result.memento.entryCount === 0) {
      set({
        ...nextDocumentState,
        mode: currentMode,
      });
      return;
    }

    const retainedHistory = state.history.slice(0, state.historyCursor);
    const savedHistoryCursor =
      state.savedHistoryCursor > state.historyCursor ? -1 : state.savedHistoryCursor;
    const nextHistory: EditorHistoryEntry[] = [
      ...retainedHistory,
      {
        id: state.nextHistoryId,
        label,
        memento: result.memento,
        activeSheetBefore: state.activeSheet,
        activeSheetAfter: nextDocumentState.activeSheet,
      },
    ];
    const historyCursor = retainedHistory.length + 1;
    set({
      ...nextDocumentState,
      mode: currentMode,
      history: nextHistory,
      historyCursor,
      savedHistoryCursor,
      nextHistoryId: state.nextHistoryId + 1,
      revision: state.revision + 1,
      ...historyStatus(nextHistory, historyCursor, savedHistoryCursor),
    });
  },
  undo: () => {
    const state = get();
    const entry = state.historyCursor > 0 ? state.history[state.historyCursor - 1] : undefined;
    if (!entry) return;
    if (!state.docState) {
      throw new Error("cannot undo without an active document state");
    }
    const result = applyCoreEditMemento(state.docState, entry.memento, "undo", { recalculate: false });
    if (!result.ok) {
      throw new Error(`[${result.error.category}] ${result.error.message}`);
    }
    const historyCursor = state.historyCursor - 1;
    set({
      ...deriveStateFromDocument(result.nextDocument, entry.activeSheetBefore),
      mode: state.mode,
      historyCursor,
      revision: state.revision + 1,
      ...historyStatus(state.history, historyCursor, state.savedHistoryCursor),
    });
  },
  redo: () => {
    const state = get();
    const entry = state.historyCursor < state.history.length ? state.history[state.historyCursor] : undefined;
    if (!entry) return;
    if (!state.docState) {
      throw new Error("cannot redo without an active document state");
    }
    const result = applyCoreEditMemento(state.docState, entry.memento, "redo", { recalculate: false });
    if (!result.ok) {
      throw new Error(`[${result.error.category}] ${result.error.message}`);
    }
    const historyCursor = state.historyCursor + 1;
    set({
      ...deriveStateFromDocument(result.nextDocument, entry.activeSheetAfter),
      mode: state.mode,
      historyCursor,
      revision: state.revision + 1,
      ...historyStatus(state.history, historyCursor, state.savedHistoryCursor),
    });
  },
  setCellInput: (target, input) => {
    get().applyCoreEdits("Set cell input", [{ op: "set_cell_input", target, input }]);
  },
  clearCell: (target) => {
    get().applyCoreEdits("Clear cell", [{ op: "clear_cell", target }]);
  },
  insertSheet: (name, sheetIndex) => {
    const { docState } = get();
    if (!docState) {
      throw new Error("cannot insert sheet without an active document state");
    }
    const sheetNames = docState.sheets.map((sheet) => sheet.name);
    const nextName = name ?? nextSheetName(sheetNames);
    const nextSheetIndex = sheetIndex ?? docState.sheets.length;
    get().applyCoreEdits("Insert sheet", [{ op: "insert_sheet", name: nextName, sheetIndex: nextSheetIndex }], nextName.trim());
  },
  deleteSheet: (sheet) => {
    const { docState, activeSheet } = get();
    if (!docState) {
      throw new Error("cannot delete sheet without an active document state");
    }
    const sheetIndex = docState.sheets.findIndex((candidate) => candidate.name === sheet);
    if (sheetIndex < 0) {
      throw new Error(`cannot delete unknown sheet '${sheet}'`);
    }
    const nextActiveSheetHint =
      activeSheet === sheet
        ? docState.sheets[sheetIndex + 1]?.name ?? docState.sheets[sheetIndex - 1]?.name ?? null
        : activeSheet;
    get().applyCoreEdits("Delete sheet", [{ op: "delete_sheet", sheet }], nextActiveSheetHint);
  },
  moveSheet: (sheet, targetGapIndex) => {
    get().applyCoreEdits("Move sheet", [{ op: "move_sheet", sheet, targetGapIndex }], get().activeSheet);
  },
  renameSheet: (sheet, newName) => {
    const { activeSheet } = get();
    const nextActiveSheetHint = activeSheet === sheet ? newName.trim() : activeSheet;
    get().applyCoreEdits("Rename sheet", [{ op: "rename_sheet", sheet, newName }], nextActiveSheetHint);
  },
  setCellLocalFormat: (target, format) => {
    get().applyCoreEdits("Set cell format", [{ op: "set_cell_local_format", target, format }]);
  },
  clearCellLocalFormat: (target) => {
    get().applyCoreEdits("Clear cell format", [{ op: "clear_cell_local_format", target }]);
  },
  setCellLocalStyle: (target, style) => {
    get().applyCoreEdits("Set cell style", [{ op: "set_cell_local_style", target, style }]);
  },
  clearCellLocalStyle: (target) => {
    get().applyCoreEdits("Clear cell style", [{ op: "clear_cell_local_style", target }]);
  },
  setColumnDefaultFormat: (sheet, colId, format) => {
    get().applyCoreEdits("Set column format", [{ op: "set_column_default_format", sheet, colId, format }]);
  },
  clearColumnDefaultFormat: (sheet, colId) => {
    get().applyCoreEdits("Clear column format", [{ op: "clear_column_default_format", sheet, colId }]);
  },
  setColumnDefaultStyle: (sheet, colId, style) => {
    get().applyCoreEdits("Set column style", [{ op: "set_column_default_style", sheet, colId, style }]);
  },
  clearColumnDefaultStyle: (sheet, colId) => {
    get().applyCoreEdits("Clear column style", [{ op: "clear_column_default_style", sheet, colId }]);
  },
  setRowDefaultFormat: (sheet, rowId, format) => {
    get().applyCoreEdits("Set row format", [{ op: "set_row_default_format", sheet, rowId, format }]);
  },
  clearRowDefaultFormat: (sheet, rowId) => {
    get().applyCoreEdits("Clear row format", [{ op: "clear_row_default_format", sheet, rowId }]);
  },
  setRowDefaultStyle: (sheet, rowId, style) => {
    get().applyCoreEdits("Set row style", [{ op: "set_row_default_style", sheet, rowId, style }]);
  },
  clearRowDefaultStyle: (sheet, rowId) => {
    get().applyCoreEdits("Clear row style", [{ op: "clear_row_default_style", sheet, rowId }]);
  },
  setRegion: (target, values) => {
    get().applyCoreEdits("Set region", [{ op: "set_region", target, values }]);
  },
  clearRegion: (target) => {
    get().applyCoreEdits("Clear region", [{ op: "clear_region", target }]);
  },
  convertRowsToHeader: (sheet, rowIds) => {
    get().applyCoreEdits("Convert rows to header", [{ op: "convert_rows_to_header", sheet, rowIds }]);
  },
  convertRowsToBody: (sheet, rowIds, depth) => {
    get().applyCoreEdits("Convert rows to body", [{ op: "convert_rows_to_body", sheet, rowIds, depth }]);
  },
  previewDeleteRow: (sheet, rowId, mode) => {
    const { docState } = get();
    if (!docState) {
      throw new Error("cannot preview row deletion without an active document state");
    }
    return previewDeleteRow(docState, { op: "delete_row", sheet, rowId, mode });
  },
  previewDeleteColumn: (sheet, colIndex) => {
    const { docState } = get();
    if (!docState) {
      throw new Error("cannot preview column deletion without an active document state");
    }
    return previewDeleteColumn(docState, { sheet, colIndex });
  },
  insertRow: (sheet, area, rowGapIndex, depth) => {
    get().applyCoreEdits("Insert row", [{ op: "insert_row", sheet, area, rowGapIndex, depth }]);
  },
  insertRows: (sheet, area, rowGapIndex, count, depth) => {
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error("insertRows requires a positive integer count");
    }
    const edits: CoreEdit[] = Array.from({ length: count }, (_, offset) => ({
      op: "insert_row",
      sheet,
      area,
      rowGapIndex: rowGapIndex + offset,
      depth,
    }));
    get().applyCoreEdits(count === 1 ? "Insert row" : "Insert rows", edits);
  },
  deleteRow: (sheet, rowId, mode) => {
    get().applyCoreEdits("Delete row", [{ op: "delete_row", sheet, rowId, mode }]);
  },
  deleteRows: (sheet, targets) => {
    if (targets.length === 0) {
      throw new Error("deleteRows requires at least one row target");
    }
    const seen = new Set<number>();
    const edits: CoreEdit[] = targets.map((target) => {
      if (seen.has(target.rowId)) {
        throw new Error(`deleteRows received duplicate rowId ${target.rowId}`);
      }
      seen.add(target.rowId);
      return { op: "delete_row", sheet, rowId: target.rowId, mode: target.mode };
    });
    get().applyCoreEdits(targets.length === 1 ? "Delete row" : "Delete rows", edits);
  },
  moveColumns: (sheet, colIds, targetGapIndex) => {
    get().applyCoreEdits("Move column", [{ op: "move_columns", sheet, colIds, targetGapIndex }]);
  },
  moveRows: (sheet, rowIds, targetGapIndex) => {
    get().applyCoreEdits("Move row", [{ op: "move_rows", sheet, rowIds, targetGapIndex }]);
  },
  duplicateColumns: (sheet, colIds, targetGapIndex) => {
    get().applyCoreEdits("Duplicate column", [{ op: "duplicate_columns", sheet, colIds, targetGapIndex }]);
  },
  duplicateRows: (sheet, rowIds, targetGapIndex) => {
    get().applyCoreEdits("Duplicate row", [{ op: "duplicate_rows", sheet, rowIds, targetGapIndex }]);
  },
  insertColumn: (sheet, colIndex) => {
    get().applyCoreEdits("Insert column", [{ op: "insert_column", sheet, colIndex }]);
  },
  insertColumns: (sheet, colIndex, count) => {
    if (!Number.isInteger(count) || count <= 0) {
      throw new Error("insertColumns requires a positive integer count");
    }
    const edits: CoreEdit[] = Array.from({ length: count }, (_, offset) => ({
      op: "insert_column",
      sheet,
      colIndex: colIndex + offset,
    }));
    get().applyCoreEdits(count === 1 ? "Insert column" : "Insert columns", edits);
  },
  deleteColumn: (sheet, colIndex) => {
    get().applyCoreEdits("Delete column", [{ op: "delete_column", sheet, colIndex }]);
  },
  deleteColumns: (sheet, colIndices) => {
    if (colIndices.length === 0) {
      throw new Error("deleteColumns requires at least one column index");
    }
    const sorted = [...colIndices].sort((a, b) => b - a);
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index] === sorted[index - 1]) {
        throw new Error(`deleteColumns received duplicate column index ${sorted[index]}`);
      }
    }
    get().applyCoreEdits(
      sorted.length === 1 ? "Delete column" : "Delete columns",
      sorted.map((colIndex) => ({ op: "delete_column", sheet, colIndex })),
    );
  },
  exitSourceMode: () => {
    const state = get();
    if (state.docState && state.sourceText === serializeDocumentState(state.docState)) {
      set({
        mode: "table",
        ...deriveStateFromDocument(state.docState, state.activeSheet),
        history: state.history,
        historyCursor: state.historyCursor,
        savedHistoryCursor: state.savedHistoryCursor,
        nextHistoryId: state.nextHistoryId,
        revision: state.revision,
        ...historyStatus(state.history, state.historyCursor, state.savedHistoryCursor),
      });
      return;
    }

    try {
      const docState = DocumentState.fromText(state.sourceText);
      const nextState = deriveStateFromDocument(docState, docState.sheets[0]?.name ?? null);
      set({
        mode: "table",
        ...nextState,
        ...emptyHistoryState(state.revision + 1),
      });
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },
  enterSourceMode: () => {
    const { docState, sourceText } = get();
    const nextText = docState ? serializeDocumentState(docState) : sourceText;
    set({
      mode: "source",
      sourceText: nextText,
      error: null,
    });
  },
}));
