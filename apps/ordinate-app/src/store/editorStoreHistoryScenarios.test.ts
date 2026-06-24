import { describe, expect, it } from "vitest";

import { serializeDocumentState, type FormatSpec } from "@ordinate/core";

import { useEditorStore } from "./editorStore";

const HISTORY_DOC = `
# Sheet
| Item  || 2024 | 2025 | Out |
| ----- || ---- | ---- | --- |
| Group ||      |      |     |
| * A   || 1    | 2    | = @[Group.A,2024] + @[Group.A,2025] |
| * B   || 3    | 4    | = @[Group.B,2024] + @[Group.B,2025] |
| Total || = sum(@[Group.A:Group.B,2024]) | = sum(@[Group.A:Group.B,2025]) | = B4 + C4 |
`.trim();

const DISPLAY_DOC = `
# Sheet
| @display | Item || {:,.1f} {::>,blue,bold} | {::>} | |
|          | Item || Price                    | Qty   | Out |
| -------- | ---- || -----                    | ---   | --- |
|          | A    || 12.34 {::green}          | 2     | = B2 * C2 {:,.2f} |
|          | B    || 56.78                    | 3     | = B3 * C3 |
`.trim();

const MULTI_SHEET_DOC = `${HISTORY_DOC}

# Other
| Item || 2024 |
| ---- || ---- |
| A    || 1    |
`;

const GROUPED_1F: FormatSpec = {
  kind: "numeric",
  sign: "default",
  padWidth: null,
  grouping: true,
  precision: 1,
  type: "f",
};

const GROUPED_2F: FormatSpec = {
  kind: "numeric",
  sign: "default",
  padWidth: null,
  grouping: true,
  precision: 2,
  type: "f",
};

const PERCENT_1: FormatSpec = {
  kind: "numeric",
  sign: "default",
  padWidth: null,
  grouping: false,
  precision: 1,
  type: "%",
};

type StoreState = ReturnType<typeof useEditorStore.getState>;

type ScenarioSnapshot = {
  ord: string;
  activeSheet: string | null;
};

type ScenarioContext = {
  data: Record<string, unknown>;
  store: () => StoreState;
  sheet: (name?: string) => NonNullable<StoreState["docState"]>["sheets"][number];
  rowId: (rowIndex: number, sheetName?: string) => number;
  colId: (colIndex: number, sheetName?: string) => number;
};

type ScenarioStep = {
  name: string;
  expectedUndoLabel: string;
  act: (ctx: ScenarioContext) => void;
  verifyAfterForward?: (ctx: ScenarioContext) => void;
  verifyAfterRedo?: (ctx: ScenarioContext) => void;
};

type HistoryScenario = {
  name: string;
  source?: string;
  steps: ScenarioStep[];
  setup?: (ctx: ScenarioContext) => void;
};

function resetStore(source = HISTORY_DOC): void {
  const store = useEditorStore.getState();
  store.setSourceText(source);
  store.exitSourceMode();
}

function captureOrdSnapshot(): ScenarioSnapshot {
  const { activeSheet, docState } = useEditorStore.getState();
  if (!docState) throw new Error("expected active document");
  docState.evaluate();
  return {
    ord: serializeDocumentState(docState),
    activeSheet,
  };
}

function buildScenarioContext(): ScenarioContext {
  const store = () => useEditorStore.getState();
  const sheet = (name = store().activeSheet ?? "Sheet") => {
    const docState = store().docState;
    if (!docState) throw new Error("expected active document");
    const found = docState.sheets.find((candidate) => candidate.name === name);
    if (!found) throw new Error(`expected sheet '${name}'`);
    return found;
  };
  return {
    data: {},
    store,
    sheet,
    rowId: (rowIndex, sheetName) => sheet(sheetName).rowIds[rowIndex],
    colId: (colIndex, sheetName) => sheet(sheetName).colIds[colIndex],
  };
}

function expectSnapshot(actual: ScenarioSnapshot, expected: ScenarioSnapshot, label: string): void {
  expect(actual.ord, `${label} ord`).toBe(expected.ord);
  expect(actual.activeSheet, `${label} active sheet`).toBe(expected.activeSheet);
}

function expectHistoryState(cursor: number, labels: string[], label: string): void {
  const state = useEditorStore.getState();
  expect(state.historyCursor, `${label} cursor`).toBe(cursor);
  expect(state.history, `${label} retained history`).toHaveLength(labels.length);
  expect(state.canUndo, `${label} canUndo`).toBe(cursor > 0);
  expect(state.canRedo, `${label} canRedo`).toBe(cursor < labels.length);
  expect(state.undoLabel, `${label} undoLabel`).toBe(cursor > 0 ? labels[cursor - 1] : null);
  expect(state.redoLabel, `${label} redoLabel`).toBe(cursor < labels.length ? labels[cursor] : null);
  expect(state.isDirty, `${label} dirty`).toBe(cursor !== 0);
}

function runHistoryScenario(scenario: HistoryScenario): void {
  resetStore(scenario.source);
  const ctx = buildScenarioContext();
  scenario.setup?.(ctx);

  const snapshots: ScenarioSnapshot[] = [captureOrdSnapshot()];
  const labels: string[] = [];

  scenario.steps.forEach((step, index) => {
    const before = captureOrdSnapshot();
    step.act(ctx);
    const after = captureOrdSnapshot();
    expect(after.ord, `${scenario.name} / ${step.name} changed ord`).not.toBe(before.ord);
    labels.push(step.expectedUndoLabel);
    snapshots.push(after);
    expectHistoryState(index + 1, labels, `${scenario.name} / after ${step.name}`);
    step.verifyAfterForward?.(ctx);
  });

  for (let cursor = scenario.steps.length; cursor > 0; cursor -= 1) {
    useEditorStore.getState().undo();
    expectSnapshot(
      captureOrdSnapshot(),
      snapshots[cursor - 1],
      `${scenario.name} / undo ${scenario.steps[cursor - 1].name}`,
    );
    expectHistoryState(cursor - 1, labels, `${scenario.name} / after undo ${cursor}`);
  }

  scenario.steps.forEach((step, index) => {
    useEditorStore.getState().redo();
    expectSnapshot(captureOrdSnapshot(), snapshots[index + 1], `${scenario.name} / redo ${step.name}`);
    expectHistoryState(index + 1, labels, `${scenario.name} / after redo ${step.name}`);
    step.verifyAfterRedo?.(ctx);
  });

  expectSnapshot(captureOrdSnapshot(), snapshots[snapshots.length - 1], `${scenario.name} / final redo snapshot`);
}

function rememberInsertedRow(ctx: ScenarioContext, key: string, beforeRowIds: Set<number>): number {
  const inserted = ctx.sheet().rowIds.find((rowId) => !beforeRowIds.has(rowId));
  if (inserted === undefined) throw new Error(`expected inserted row for ${key}`);
  ctx.data[key] = inserted;
  return inserted;
}

function rememberInsertedColumn(ctx: ScenarioContext, key: string, beforeColIds: Set<number>): number {
  const inserted = ctx.sheet().colIds.find((colId) => !beforeColIds.has(colId));
  if (inserted === undefined) throw new Error(`expected inserted column for ${key}`);
  ctx.data[key] = inserted;
  return inserted;
}

function dataNumber(ctx: ScenarioContext, key: string): number {
  const value = ctx.data[key];
  if (typeof value !== "number") throw new Error(`expected numeric scenario value '${key}'`);
  return value;
}

describe("editor store history scenario matrix", () => {
  const scenarios: HistoryScenario[] = [
    {
      name: "cell and formula commands",
      steps: [
        {
          name: "set literal cell input",
          expectedUndoLabel: "Set cell input",
          act: (ctx) => ctx.store().setCellInput({ kind: "index", sheet: "Sheet", rowIndex: 2, colIndex: 1 }, "10"),
        },
        {
          name: "set formula input",
          expectedUndoLabel: "Set cell input",
          act: (ctx) => ctx.store().setCellInput({ kind: "index", sheet: "Sheet", rowIndex: 2, colIndex: 3 }, "= B2 + C2"),
        },
        {
          name: "clear cell input",
          expectedUndoLabel: "Clear cell",
          act: (ctx) => ctx.store().clearCell({ kind: "index", sheet: "Sheet", rowIndex: 3, colIndex: 2 }),
        },
        {
          name: "rename sheet",
          expectedUndoLabel: "Rename sheet",
          act: (ctx) => ctx.store().renameSheet("Sheet", "Renamed"),
        },
      ],
    },
    {
      name: "cross-sheet active sheet restoration",
      source: MULTI_SHEET_DOC,
      setup: (ctx) => ctx.store().setActiveSheet("Other"),
      steps: [
        {
          name: "edit other sheet",
          expectedUndoLabel: "Set cell input",
          act: (ctx) => ctx.store().setCellInput({ kind: "index", sheet: "Other", rowIndex: 1, colIndex: 1 }, "42"),
        },
        {
          name: "rename active sheet",
          expectedUndoLabel: "Rename sheet",
          act: (ctx) => ctx.store().renameSheet("Other", "Notes"),
          verifyAfterForward: (ctx) => expect(ctx.store().activeSheet).toBe("Notes"),
          verifyAfterRedo: (ctx) => expect(ctx.store().activeSheet).toBe("Notes"),
        },
      ],
    },
    {
      name: "display metadata commands",
      source: DISPLAY_DOC,
      steps: [
        {
          name: "set cell local format",
          expectedUndoLabel: "Set cell format",
          act: (ctx) => ctx.store().setCellLocalFormat({ kind: "index", sheet: "Sheet", rowIndex: 2, colIndex: 1 }, GROUPED_2F),
        },
        {
          name: "set cell local style",
          expectedUndoLabel: "Set cell style",
          act: (ctx) =>
            ctx.store().setCellLocalStyle({ kind: "index", sheet: "Sheet", rowIndex: 2, colIndex: 1 }, { align: "right", color: "blue" }),
        },
        {
          name: "clear cell local style",
          expectedUndoLabel: "Clear cell style",
          act: (ctx) => ctx.store().clearCellLocalStyle({ kind: "index", sheet: "Sheet", rowIndex: 2, colIndex: 1 }),
        },
        {
          name: "clear cell local format",
          expectedUndoLabel: "Clear cell format",
          act: (ctx) => ctx.store().clearCellLocalFormat({ kind: "index", sheet: "Sheet", rowIndex: 2, colIndex: 1 }),
        },
        {
          name: "set column default format",
          expectedUndoLabel: "Set column format",
          act: (ctx) => ctx.store().setColumnDefaultFormat("Sheet", ctx.colId(1), PERCENT_1),
        },
        {
          name: "set column default style",
          expectedUndoLabel: "Set column style",
          act: (ctx) => ctx.store().setColumnDefaultStyle("Sheet", ctx.colId(1), { color: "green", weight: "normal" }),
        },
        {
          name: "clear column default style",
          expectedUndoLabel: "Clear column style",
          act: (ctx) => ctx.store().clearColumnDefaultStyle("Sheet", ctx.colId(1)),
        },
        {
          name: "clear column default format",
          expectedUndoLabel: "Clear column format",
          act: (ctx) => ctx.store().clearColumnDefaultFormat("Sheet", ctx.colId(1)),
        },
        {
          name: "set row default format",
          expectedUndoLabel: "Set row format",
          act: (ctx) => ctx.store().setRowDefaultFormat("Sheet", ctx.rowId(2), GROUPED_1F),
        },
        {
          name: "set row default style",
          expectedUndoLabel: "Set row style",
          act: (ctx) => ctx.store().setRowDefaultStyle("Sheet", ctx.rowId(2), { align: "center", color: "blue" }),
        },
        {
          name: "clear row default style",
          expectedUndoLabel: "Clear row style",
          act: (ctx) => ctx.store().clearRowDefaultStyle("Sheet", ctx.rowId(2)),
        },
        {
          name: "clear row default format",
          expectedUndoLabel: "Clear row format",
          act: (ctx) => ctx.store().clearRowDefaultFormat("Sheet", ctx.rowId(2)),
        },
      ],
    },
    {
      name: "region commands",
      steps: [
        {
          name: "set region with normal endpoints",
          expectedUndoLabel: "Set region",
          act: (ctx) =>
            ctx.store().setRegion(
              {
                sheet: "Sheet",
                start: { rowId: ctx.rowId(2), colId: ctx.colId(1) },
                end: { rowId: ctx.rowId(3), colId: ctx.colId(2) },
              },
              [["10", "= 5 + 5"], ["30", "40"]],
            ),
        },
        {
          name: "set region with reversed endpoints",
          expectedUndoLabel: "Set region",
          act: (ctx) =>
            ctx.store().setRegion(
              {
                sheet: "Sheet",
                start: { rowId: ctx.rowId(3), colId: ctx.colId(2) },
                end: { rowId: ctx.rowId(2), colId: ctx.colId(1) },
              },
              [["11", "12"], ["= B2 + C2", "44"]],
            ),
        },
        {
          name: "set mixed scalar formula region",
          expectedUndoLabel: "Set region",
          act: (ctx) =>
            ctx.store().setRegion(
              {
                sheet: "Sheet",
                start: { rowId: ctx.rowId(4), colId: ctx.colId(1) },
                end: { rowId: ctx.rowId(4), colId: ctx.colId(3) },
              },
              [["= sum(B2:B3)", "99", "= B4 + C4"]],
            ),
        },
        {
          name: "clear edited region",
          expectedUndoLabel: "Clear region",
          act: (ctx) =>
            ctx.store().clearRegion({
              sheet: "Sheet",
              start: { rowId: ctx.rowId(2), colId: ctx.colId(1) },
              end: { rowId: ctx.rowId(4), colId: ctx.colId(3) },
            }),
        },
      ],
    },
    {
      name: "structural row insert edit and delete",
      steps: [
        {
          name: "insert body row",
          expectedUndoLabel: "Insert row",
          act: (ctx) => {
            ctx.data.beforeRowIds = new Set(ctx.sheet().rowIds);
            ctx.store().insertRow("Sheet", "body", 3, 1);
            rememberInsertedRow(ctx, "insertedRowId", ctx.data.beforeRowIds as Set<number>);
          },
          verifyAfterRedo: (ctx) => expect(ctx.sheet().rowIds).toContain(dataNumber(ctx, "insertedRowId")),
        },
        {
          name: "edit inserted row",
          expectedUndoLabel: "Set region",
          act: (ctx) =>
            ctx.store().setRegion(
              {
                sheet: "Sheet",
                start: { rowId: dataNumber(ctx, "insertedRowId"), colId: ctx.colId(1) },
                end: { rowId: dataNumber(ctx, "insertedRowId"), colId: ctx.colId(3) },
              },
              [["77", "88", "= B4 + C4"]],
            ),
        },
        {
          name: "delete leaf row",
          expectedUndoLabel: "Delete row",
          act: (ctx) => ctx.store().deleteRow("Sheet", ctx.rowId(4), "node"),
        },
      ],
    },
    {
      name: "structural row subtree and conversion",
      steps: [
        {
          name: "delete subtree row",
          expectedUndoLabel: "Delete row",
          act: (ctx) => ctx.store().deleteRow("Sheet", ctx.rowId(1), "subtree"),
        },
        {
          name: "convert row to header",
          expectedUndoLabel: "Convert rows to header",
          act: (ctx) => ctx.store().convertRowsToHeader("Sheet", [ctx.rowId(1)]),
        },
        {
          name: "convert row back to body",
          expectedUndoLabel: "Convert rows to body",
          act: (ctx) => ctx.store().convertRowsToBody("Sheet", [ctx.rowId(1)], 0),
        },
      ],
    },
    {
      name: "structural column insert edit and delete",
      steps: [
        {
          name: "insert column",
          expectedUndoLabel: "Insert column",
          act: (ctx) => {
            ctx.data.beforeColIds = new Set(ctx.sheet().colIds);
            ctx.store().insertColumn("Sheet", 2);
            rememberInsertedColumn(ctx, "insertedColId", ctx.data.beforeColIds as Set<number>);
          },
          verifyAfterRedo: (ctx) => expect(ctx.sheet().colIds).toContain(dataNumber(ctx, "insertedColId")),
        },
        {
          name: "edit inserted column",
          expectedUndoLabel: "Set region",
          act: (ctx) =>
            ctx.store().setRegion(
              {
                sheet: "Sheet",
                start: { rowId: ctx.rowId(2), colId: dataNumber(ctx, "insertedColId") },
                end: { rowId: ctx.rowId(3), colId: dataNumber(ctx, "insertedColId") },
              },
              [["55"], ["66"]],
            ),
        },
        {
          name: "delete inserted column",
          expectedUndoLabel: "Delete column",
          act: (ctx) => ctx.store().deleteColumn("Sheet", ctx.sheet().colIds.indexOf(dataNumber(ctx, "insertedColId"))),
        },
      ],
    },
  ];

  for (const scenario of scenarios) {
    it(`round-trips snapshots for ${scenario.name}`, () => {
      runHistoryScenario(scenario);
    });
  }
});

describe("editor store history branch and reset scenarios", () => {
  it("clears redo branch after a new command and preserves snapshot replay", () => {
    resetStore();
    const initial = captureOrdSnapshot();

    useEditorStore.getState().setCellInput({ kind: "index", sheet: "Sheet", rowIndex: 2, colIndex: 1 }, "10");
    const afterA = captureOrdSnapshot();

    useEditorStore.getState().setCellInput({ kind: "index", sheet: "Sheet", rowIndex: 3, colIndex: 1 }, "30");
    const afterB = captureOrdSnapshot();
    expect(afterB.ord).not.toBe(afterA.ord);

    useEditorStore.getState().undo();
    expectSnapshot(captureOrdSnapshot(), afterA, "branch after undo B");
    expect(useEditorStore.getState().redoLabel).toBe("Set cell input");

    useEditorStore.getState().setCellInput({ kind: "index", sheet: "Sheet", rowIndex: 3, colIndex: 2 }, "40");
    const afterC = captureOrdSnapshot();
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState()).toMatchObject({ historyCursor: 2, canRedo: false, redoLabel: null });

    useEditorStore.getState().undo();
    expectSnapshot(captureOrdSnapshot(), afterA, "branch undo C");
    useEditorStore.getState().undo();
    expectSnapshot(captureOrdSnapshot(), initial, "branch undo A");
    useEditorStore.getState().redo();
    expectSnapshot(captureOrdSnapshot(), afterA, "branch redo A");
    useEditorStore.getState().redo();
    expectSnapshot(captureOrdSnapshot(), afterC, "branch redo C");
  });

  it("does not create history for no-op commands", () => {
    resetStore();
    const before = captureOrdSnapshot();
    const revision = useEditorStore.getState().revision;

    useEditorStore.getState().renameSheet("Sheet", "Sheet");

    expectSnapshot(captureOrdSnapshot(), before, "no-op rename");
    expect(useEditorStore.getState()).toMatchObject({
      historyCursor: 0,
      canUndo: false,
      canRedo: false,
      revision,
      isDirty: false,
    });
    expect(useEditorStore.getState().history).toHaveLength(0);
  });

  it("clears app history after successful source mode reparse", () => {
    resetStore();
    useEditorStore.getState().setCellInput({ kind: "index", sheet: "Sheet", rowIndex: 2, colIndex: 1 }, "10");
    expect(useEditorStore.getState().historyCursor).toBe(1);

    useEditorStore.getState().enterSourceMode();
    useEditorStore.getState().exitSourceMode();

    expect(useEditorStore.getState()).toMatchObject({
      mode: "table",
      historyCursor: 0,
      canUndo: false,
      canRedo: false,
      undoLabel: null,
      redoLabel: null,
      isDirty: false,
    });
    expect(useEditorStore.getState().history).toHaveLength(0);
  });

  it("does not mutate the document or push history when a command fails", () => {
    resetStore();
    const before = captureOrdSnapshot();

    expect(() =>
      useEditorStore.getState().setCellLocalStyle(
        { kind: "index", sheet: "Sheet", rowIndex: 0, colIndex: 1 },
        { color: "blue" },
      ),
    ).toThrow("cell edit target must be inside data region");

    expectSnapshot(captureOrdSnapshot(), before, "failed command");
    expect(useEditorStore.getState()).toMatchObject({
      historyCursor: 0,
      canUndo: false,
      canRedo: false,
      isDirty: false,
    });
    expect(useEditorStore.getState().history).toHaveLength(0);
  });
});
