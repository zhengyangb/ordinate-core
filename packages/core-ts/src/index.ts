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
  type SectionIR,
} from "./ir";

export {
  evaluateDocument,
  isError,
  makeError,
  makeInternalError,
  projectExternalKind,
  resolveCellInputText,
  splitCellDisplayMetadata,
  stripCellDisplayMetadata,
  type ErrorRuntimeValue,
  type EvaluationResult,
  type ExternalErrorKind,
  type FormatSpec,
  type SheetEvaluation,
  type StylePatch,
  type StyleSpec,
  type RuntimeValue,
} from "./runtime";

export { ChangeKind, DocumentState, SheetState } from "./incremental";
export { serializeDocumentState } from "./serializer";
export {
  applyBatchAtomic,
  type ApplyBatchAtomicOptions,
  type ApplyBatchAtomicResult,
  type CoreCellTarget,
  type CoreEdit,
  type CoreEditError,
  type CoreEditErrorCategory,
} from "./core_edit";
export type { CellInputTextView } from "./runtime";
export {
  formatPresentedCell,
  resolveDocumentPresentation,
  resolvePresentationFromText,
  type ColumnDisplayDefault,
  type PresentedCell,
  type SheetPresentation,
  type PresentationResult,
} from "./presentation";
