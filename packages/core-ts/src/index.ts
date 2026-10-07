export {
  validateDocument,
  type ValidationError,
  type ValidationResult,
  type ValidationSummary,
  type SheetSummary,
} from "./validator";

export { formatDocument } from "./formatter";
export { groupHeaderSpans } from "./presentation";
export { parseSheetNote, serializeSheetNote, matchNoteListItem, SheetNoteError, type SheetNote, type SheetNotePosition, type NoteBlock, type NoteInline, type NoteDiagnostic } from "./sheet_notes";
export { previewRowsToNote, type RowsToNotePreview } from "./core_note_rows";
export { configureImportedDocument, type ImportSheetHeaders } from "./import_layout";
export { isImplicitTextInput } from "./runtime/parse";
export { evaluateAndFormatDocument } from "./materialize";

export {
  importExcelWorkbook, exportExcelWorkbook, DEFAULT_EXCEL_LIMITS,
  prepareExcelImport, importPreparedExcelWorkbook, excelImportNoteCandidates,
  type PreparedExcelImport, type ExcelNoteChoice, type ExcelNoteCandidate,
  type ExcelLimits, type ExcelOptions, type ExcelImportOptions, type ExcelExportOptions, type ExcelResult, type ExcelImportResult, type ExcelDiagnostic, type ExcelDiagnosticCode,
} from "./excel";

export {
  importDelimitedDocument,
  exportDelimitedSheet,
  DEFAULT_DELIMITED_LIMITS,
  type DelimitedImportOptions,
  type DelimitedExportOptions,
  type DelimitedSheetExport,
  type DelimitedFormat,
  type DelimitedLimits,
  type DelimitedDiagnostic,
  type DelimitedDiagnosticCode,
  type DelimitedResult,
} from "./delimited";

export {
  parseDocumentModel,
  type DocumentIR,
  type SheetIR,
  type TableIR,
  type RowIR,
} from "./ir";
export { DocumentParseError, parseHierarchyLabel } from "./parser";

export {
  evaluateDocument,
  formatFormulaReferencePathComponent,
  formatFormulaSheetSelector,
  getCellTextView,
  getStandardFunctionMetadata,
  inspectFormulaInput,
  isError,
  listStandardFunctionMetadata,
  diagnosticFromError,
  describeDisplayMetadataDiagnostic,
  makeError,
  makeInternalError,
  parseCellText,
  parseFormulaReferenceSyntax,
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
  type FormulaEditorArray,
  type FormulaEditorCall,
  type FormulaEditorCaretContext,
  type FormulaEditorCompletableToken,
  type FormulaEditorDiagnostic,
  type FormulaEditorDiagnosticKind,
  type FormulaEditorGroup,
  type FormulaEditorIndex,
  type FormulaEditorInspection,
  type FormulaEditorSimpleToken,
  type FormulaEditorSimpleTokenKind,
  type FormulaEditorStructure,
  type FormulaEditorStructureBase,
  type FormulaEditorToken,
  type FormulaInspectionOptions,
  type FormulaReferenceExpressionSyntax,
  type FormulaReferenceSelectorSyntax,
  type FormulaSourceSpan,
  type FormulaReferenceSyntax,
  type RefSelector,
  type ReferenceExpr,
  type CellBodyState,
  type CellDisplayState,
  type FormatSpec,
  type SheetEvaluation,
  type StylePatch,
  type StyleSpec,
  type RuntimeValue,
} from "./runtime";

export { ChangeKind, DocumentState, SheetState } from "./incremental";
export { planFillRegion, type CoreFillMode, type CoreFillRect, type CoreFillPlan } from "./core_fill";
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
export { decomposeTemporalValue, decomposeDurationValue } from "./runtime/temporal";
export {
  formatPresentedCell,
  resolveDocumentPresentation,
  resolvePresentationFromText,
  type ColumnDisplayDefault,
  type PresentedCell,
  type SheetPresentation,
  type PresentationResult,
} from "./presentation";
