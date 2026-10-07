import type { ExprNode, ReferenceExpr, RefSelector, SheetRefSelector } from "./types";

type BoundSheetSelector = SheetRefSelector & {
  __sheetId?: number;
};

type BoundSelector = RefSelector & {
  source?: RefSelector;
};

export function getBoundSheetId(selector: SheetRefSelector | undefined): number | null {
  const raw = (selector as BoundSheetSelector | undefined)?.__sheetId;
  return Number.isInteger(raw) ? Number(raw) : null;
}

export function setBoundSheetId(selector: SheetRefSelector, sheetId: number): void {
  if (!Number.isInteger(sheetId) || sheetId < 1) {
    throw new Error("bound sheet id must be a positive integer");
  }
  defineHiddenProperty(selector as BoundSheetSelector, "__sheetId", sheetId);
}

export function clearBoundSheetId(selector: SheetRefSelector): void {
  delete (selector as BoundSheetSelector).__sheetId;
}

export function selectorSource(selector: RefSelector): RefSelector | null {
  return (selector as BoundSelector).source ?? null;
}

export function copyExpressionReferenceMetadata(source: ExprNode | null, target: ExprNode | null): void {
  if (!source || !target || source.kind !== target.kind) return;
  if (source.kind === "reference") {
    copyReferenceMetadata(source.value as ReferenceExpr, target.value as ReferenceExpr);
    return;
  }
  if (source.kind === "call") {
    const sourceCall = source.value as { args: ExprNode[] };
    const targetCall = target.value as { args: ExprNode[] };
    sourceCall.args.forEach((arg, index) => copyExpressionReferenceMetadata(arg, targetCall.args[index] ?? null));
    return;
  }
  if (source.kind === "array") {
    const sourceArray = source.value as { rows: ExprNode[][] };
    const targetArray = target.value as { rows: ExprNode[][] };
    sourceArray.rows.forEach((row, rowIndex) =>
      row.forEach((element, colIndex) =>
        copyExpressionReferenceMetadata(element, targetArray.rows[rowIndex]?.[colIndex] ?? null)));
    return;
  }
  if (source.kind === "index") {
    const sourceIndex = source.value as {
      target: ExprNode;
      axes: Array<{ kind: string; value?: ExprNode; start?: ExprNode | null; end?: ExprNode | null }>;
    };
    const targetIndex = target.value as {
      target: ExprNode;
      axes: Array<{ kind: string; value?: ExprNode; start?: ExprNode | null; end?: ExprNode | null }>;
    };
    copyExpressionReferenceMetadata(sourceIndex.target, targetIndex.target);
    sourceIndex.axes.forEach((axis, index) => {
      const targetAxis = targetIndex.axes[index];
      if (!targetAxis || axis.kind !== targetAxis.kind) return;
      if (axis.kind === "scalar") {
        copyExpressionReferenceMetadata(axis.value ?? null, targetAxis.value ?? null);
      } else {
        copyExpressionReferenceMetadata(axis.start ?? null, targetAxis.start ?? null);
        copyExpressionReferenceMetadata(axis.end ?? null, targetAxis.end ?? null);
      }
    });
    return;
  }
  if (source.kind === "unary") {
    copyExpressionReferenceMetadata(source.right ?? null, target.right ?? null);
    return;
  }
  if (source.kind === "binary") {
    copyExpressionReferenceMetadata(source.left ?? null, target.left ?? null);
    copyExpressionReferenceMetadata(source.right ?? null, target.right ?? null);
  }
}

export function structurallyBindSelector(
  selector: RefSelector,
  axis: "row" | "col",
  ids: readonly number[],
  labelMap: Map<string, number[]>,
): RefSelector {
  if (!selector || typeof selector !== "object") return selector;
  if (selector.kind === "range") {
    const [startSel, endSel] = selector.value as [RefSelector | null, RefSelector | null];
    return {
      kind: "range",
      value: [
        startSel ? structurallyBindSelector(startSel, axis, ids, labelMap) : null,
        endSel ? structurallyBindSelector(endSel, axis, ids, labelMap) : null,
      ],
    };
  }
  if (selector.kind === "absolute") {
    const index = Number(selector.value);
    if (index < 0 || index >= ids.length) {
      return { kind: "invalid" };
    }
    return withSelectorSource({ ...selector, kind: "absolute_id", value: ids[index] }, selector);
  }
  if (selector.kind === "label") {
    const key = axis === "row"
      ? JSON.stringify(selector.value as string[])
      : (selector.value as string[]).join(".");
    const matches = labelMap.get(key) ?? [];
    if (matches.length !== 1) {
      return selector;
    }
    const id = ids[matches[0]];
    return id == null ? selector : withSelectorSource({ kind: "label_id", value: id }, selector);
  }
  return selector;
}

export function isStructurallyBoundSelector(selector: RefSelector | null): selector is RefSelector {
  return selector?.kind === "absolute_id" || selector?.kind === "label_id";
}

export function walkExpressionReferences(node: ExprNode | null, visit: (ref: ReferenceExpr) => void): void {
  if (!node) return;
  if (node.kind === "reference") {
    visit(node.value as ReferenceExpr);
    return;
  }
  if (node.kind === "call") {
    const call = node.value as { args: ExprNode[] };
    call.args.forEach((arg) => walkExpressionReferences(arg, visit));
    return;
  }
  if (node.kind === "array") {
    const array = node.value as { rows: ExprNode[][] };
    array.rows.forEach((row) => row.forEach((element) => walkExpressionReferences(element, visit)));
    return;
  }
  if (node.kind === "index") {
    const index = node.value as {
      target: ExprNode;
      axes: Array<{ kind: string; value?: ExprNode; start?: ExprNode | null; end?: ExprNode | null }>;
    };
    walkExpressionReferences(index.target, visit);
    index.axes.forEach((axis) => {
      if (axis.kind === "scalar") {
        walkExpressionReferences(axis.value ?? null, visit);
      } else {
        walkExpressionReferences(axis.start ?? null, visit);
        walkExpressionReferences(axis.end ?? null, visit);
      }
    });
    return;
  }
  if (node.kind === "unary") {
    walkExpressionReferences(node.right ?? null, visit);
    return;
  }
  if (node.kind === "binary") {
    walkExpressionReferences(node.left ?? null, visit);
    walkExpressionReferences(node.right ?? null, visit);
  }
}

function withSelectorSource(selector: RefSelector, source: RefSelector): RefSelector {
  const bound = { ...selector } as BoundSelector;
  defineHiddenProperty(bound, "source", structuredClone(source) as RefSelector);
  return bound;
}

function copyReferenceMetadata(source: ReferenceExpr, target: ReferenceExpr): void {
  if (source.sheetSelector && target.sheetSelector) {
    const sheetId = getBoundSheetId(source.sheetSelector);
    if (sheetId !== null) {
      setBoundSheetId(target.sheetSelector, sheetId);
    }
  }
  copySelectorMetadata(source.rowSelector, target.rowSelector);
  copySelectorMetadata(source.colSelector, target.colSelector);
}

function copySelectorMetadata(source: RefSelector | null, target: RefSelector | null): void {
  if (!source || !target || source.kind !== target.kind) return;
  const sourceFallback = selectorSource(source);
  if (sourceFallback) {
    defineHiddenProperty(target as BoundSelector, "source", structuredClone(sourceFallback) as RefSelector);
  }
  if (source.kind === "range") {
    const [sourceStart, sourceEnd] = source.value as [RefSelector | null, RefSelector | null];
    const [targetStart, targetEnd] = target.value as [RefSelector | null, RefSelector | null];
    copySelectorMetadata(sourceStart, targetStart);
    copySelectorMetadata(sourceEnd, targetEnd);
  }
}

function defineHiddenProperty<T extends object, K extends keyof T>(target: T, key: K, value: T[K]): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: false,
  });
}
