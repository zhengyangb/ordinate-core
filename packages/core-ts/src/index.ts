export {
  validateDocument,
  type ValidationError,
  type ValidationResult,
  type ValidationSummary,
  type SheetSummary,
} from "./validator";

export { formatDocument } from "./formatter";
export { evaluateAndFormatDocument } from "./materialize";

export {
  parseDocumentModel,
  type DocumentIR,
  type SheetIR,
  type TableIR,
  type RowIR,
} from "./ir";
export { parseHierarchyLabel } from "./parser";

export {
  evaluateDocument,
  getCellTextView,
  getStandardFunctionMetadata,
  isError,
  listStandardFunctionMetadata,
  diagnosticFromError,
  describeDisplayMetadataDiagnostic,
  makeError,
  makeInternalError,
  parseCellText,
  parseTemporalFormatSpec,
  projectExternalKind,
  resolveCellInputText,
  validateFormatSpec,
  formatTemporalValue,
  runtimeErrorFromDiagnostic,
  splitCellDisplayMetadata,
  stripCellDisplayMetadata,
  type Diagnostic,
  type ErrorRuntimeValue,
  type EvaluationResult,
  type ExternalErrorKind,
  type FunctionCategory,
  type FunctionExample,
  type FunctionMetadata,
  type FunctionParameter,
  type FunctionSignature,
  type CellBodyState,
  type CellDisplayState,
  type FormatSpec,
  type SheetEvaluation,
  type StylePatch,
  type StyleSpec,
  type RuntimeValue,
} from "./runtime";

export { ChangeKind, DocumentState, SheetState } from "./incremental";
export { serializeDocumentState } from "./serializer";
export {
  resolveSheetRowStructure,
  type SheetBodyRowStructure,
} from "./row_structure";
export {
  applyBatchAtomic,
  applyBatchWithUndo,
  applyCoreEditMemento,
  previewDeleteColumn,
  previewDeleteRow,
  type ApplyBatchAtomicOptions,
  type ApplyBatchAtomicResult,
  type ApplyBatchWithUndoResult,
  type ApplyCoreEditMementoResult,
  type CoreAffectedFormulaCell,
  type CoreCellTarget,
  type CoreCellHandle,
  type CoreDeleteColumnPreview,
  type CoreDeleteRowPreview,
  type CoreEdit,
  type CoreEditError,
  type CoreEditErrorCategory,
  type CoreEditHistoryDirection,
  type CoreEditHistoryMemento,
  type CoreRegionTarget,
  type CoreDeleteSheetEdit,
  type CoreInsertSheetEdit,
  type CoreMoveSheetEdit,
  type CoreRenameSheetEdit,
} from "./core_edit";
export type {
  CoreDeleteRowEdit,
  CoreInsertRowEdit,
  CoreRowDeleteMode,
  CoreRowInsertArea,
} from "./core_edit_rows";
export type {
  CoreDuplicateColumnsEdit,
  CoreDuplicateRowsEdit,
  CoreMoveColumnsEdit,
  CoreMoveRowsEdit,
} from "./core_edit_axis";
export type { CellInputTextView, CellTextViewSource } from "./runtime";
export {
  formatPresentedCell,
  resolveDocumentPresentation,
  resolvePresentationFromText,
  type ColumnDisplayDefault,
  type PresentedCell,
  type SheetPresentation,
  type PresentationResult,
} from "./presentation";
