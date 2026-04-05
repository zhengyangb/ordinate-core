import { create } from "zustand";

import {
  DocumentState,
  resolveDocumentPresentation,
  validateDocument,
  type EvaluationResult,
  type PresentationResult,
  type ValidationError,
  type ValidationResult,
  serializeDocumentState,
} from "@ordinate/core";

type EditorMode = "source" | "table";

interface EditorState {
  mode: EditorMode;
  sourceText: string;
  docState: DocumentState | null;
  evaluation: EvaluationResult | null;
  presentation: PresentationResult | null;
  validation: ValidationResult | null;
  sheetIssuesByName: Record<string, ValidationError[]>;
  activeSheet: string | null;
  error: string | null;
  setSourceText: (text: string) => void;
  setActiveSheet: (sheetName: string) => void;
  exitSourceMode: () => void;
  enterSourceMode: () => void;
}

const sampleDocument = `# Management Report
|             || 2024 | 2024 | 2025 | 2025 |
| Line Item   || H1   | H2   | H1   | H2   |
| ----------- || ---- | ---- | ---- | ---- |
| [Revenue]   ||      |      |      |      |
|   Product A || 120  | 140  | 160  | 180  |
|   Product B || 80   | 95   | 105  | 120  |
| Revenue Total || = @[Revenue."Product A",_] + @[Revenue."Product B",_] | = @[Revenue."Product A",_] + @[Revenue."Product B",_] | = @[Revenue."Product A",_] + @[Revenue."Product B",_] | = @[Revenue."Product A",_] + @[Revenue."Product B",_] |
| [Cost of Sales] ||      |      |      |      |
|   Materials  || 60   | 70   | 82   | 90   |
|   Fulfillment|| 20   | 25   | 28   | 35   |
| Cost of Sales Total || = @["Cost of Sales".Materials,_] + @["Cost of Sales".Fulfillment,_] | = @["Cost of Sales".Materials,_] + @["Cost of Sales".Fulfillment,_] | = @["Cost of Sales".Materials,_] + @["Cost of Sales".Fulfillment,_] | = @["Cost of Sales".Materials,_] + @["Cost of Sales".Fulfillment,_] |
| Gross Profit || = @["Revenue Total",_] - @["Cost of Sales Total",_] | = @["Revenue Total",_] - @["Cost of Sales Total",_] | = @["Revenue Total",_] - @["Cost of Sales Total",_] | = @["Revenue Total",_] - @["Cost of Sales Total",_] |
| [Operating Expense] ||      |      |      |      |
|   Marketing || 15   | 16   | 20   | 22   |
|   RND       || 18   | 21   | 24   | 26   |
| Opex Total || = @["Operating Expense".Marketing,_] + @["Operating Expense".RND,_] | = @["Operating Expense".Marketing,_] + @["Operating Expense".RND,_] | = @["Operating Expense".Marketing,_] + @["Operating Expense".RND,_] | = @["Operating Expense".Marketing,_] + @["Operating Expense".RND,_] |
| Operating Profit || = @["Gross Profit",_] - @["Opex Total",_] | = @["Gross Profit",_] - @["Opex Total",_] | = @["Gross Profit",_] - @["Opex Total",_] | = @["Gross Profit",_] - @["Opex Total",_] |
| Margin Ratio || = @["Operating Profit",_] / @["Revenue Total",_] | = @["Operating Profit",_] / @["Revenue Total",_] | = @["Operating Profit",_] / @["Revenue Total",_] | = @["Operating Profit",_] / @["Revenue Total",_] |

# Executive Notes
| Summary | "Revenue momentum stayed healthy in both product lines." |
| Commentary | "Cost mix improved in 2025 H2 due to procurement renegotiation." |
| Key Risk | "Supplier lead time volatility remains high for chip components." |
| Decision | "Prioritize margin quality and controlled hiring in Q4." |
| Owner | "Finance + Operations" |

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
| [North America]    ||     |     |
|   US               || 100 | 110 |
|   Canada           || 40  | 45  |
| [EMEA]             ||     |     |
|   Germany          || 60  | 70  |
|   France           || 35  | 38  |
| [APAC]             ||     |     |
|   Japan            || 44  | 50  |
|   Australia        || 22  | 26  |
| Grand Total        || 301 | 339 |

# Quarterly Cube
|             || 2024 | 2024 | 2024 | 2024 | 2025 | 2025 | 2025 | 2025 |
| Line Item   || H1   | H1   | H2   | H2   | H1   | H1   | H2   | H2   |
|             || Q1   | Q2   | Q3   | Q4   | Q1   | Q2   | Q3   | Q4   |
| ----------- || ---- | ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| [Revenue]   ||      |      |      |      |      |      |      |      |
|   Product A || 58   | 62   | 66   | 71   | 73   | 76   | 79   | 84   |
|   Product B || 41   | 44   | 46   | 49   | 52   | 55   | 57   | 61   |
| Revenue Total || = @[Revenue."Product A",_] + @[Revenue."Product B",_] | = @[Revenue."Product A",_] + @[Revenue."Product B",_] | = @[Revenue."Product A",_] + @[Revenue."Product B",_] | = @[Revenue."Product A",_] + @[Revenue."Product B",_] | = @[Revenue."Product A",_] + @[Revenue."Product B",_] | = @[Revenue."Product A",_] + @[Revenue."Product B",_] | = @[Revenue."Product A",_] + @[Revenue."Product B",_] | = @[Revenue."Product A",_] + @[Revenue."Product B",_] |
| Gross Margin % || = @["Revenue Total",_] / 120 | = @["Revenue Total",_] / 130 | = @["Revenue Total",_] / 140 | = @["Revenue Total",_] / 150 | = @["Revenue Total",_] / 160 | = @["Revenue Total",_] / 170 | = @["Revenue Total",_] / 180 | = @["Revenue Total",_] / 190 |

# A1 Style Demo
| @display     |      || {:,.1f:<,blue} | {:(),.2f:<} | {:.1%:<} | {::<} | {:,.2f:<,blue,bold} |
|              | Item || Revenue         | Cost        | Margin   | Notes | Calc                |
|              | ---- || -------         | ----        | ------   | ----- | ----                |
|              | Product A    || 1234.5 {::red}         | -456.7            | 0.125          | "color override" | = B2 + C2 {::red} |
|              | Product B    || 999.9 {:.3f:>}         | -88.1             | 0.314          | "align + format override" | = B3 + C3 {::normal} |
|              | Temporal     || 2026-03-24T14:30:00Z {::blue} | PT1H30M {::bold} | 0 | "time literals" | = B2 |
|              | Column Sum   || 0                 | 0                  | 0               | ""           | = sum(B:B) |
|              | Row Sum      || 0                 | 0                  | 0               | ""           | = sum(2:2) |
|              | Mixed        || 0                 | 0                  | 0               | "a1 + ordinate" | = B2 + @[#2,#2] |
|              | Invalid Meta || 12.5 {:bad fmt}   | 13 {:,.2f:purple}  | 0               | "non-blocking" | = B8 + C8 |
|              | Div Zero     || 10                | 0                  | 0               | "runtime error" | = B10 / C10 |
|              | Type Clash   || 4                 | 2                  | 0               | "text operand" | = B11 + E11 |
|              | Cycle Ref    || 0                 | 0                  | 0               | "self ref" | = @["Cycle Ref",Calc] |
|              | Parse Crash  || 0                 | 0                  | 0               | "formula parse" | = sum(B2 |
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

const initialState = bootstrapFromSource(sampleDocument);

export const useEditorStore = create<EditorState>((set, get) => ({
  ...initialState,
  setSourceText: (text) => set({ sourceText: text, presentation: null, validation: null, sheetIssuesByName: {}, error: null }),
  setActiveSheet: (sheetName) => set({ activeSheet: sheetName }),
  exitSourceMode: () => {
    try {
      const docState = DocumentState.fromText(get().sourceText);
      const evaluation = docState.evaluate();
      const presentation = resolveDocumentPresentation(docState);
      const validation = validateDocument(get().sourceText);
      const sheetNames = docState.sheets.map((sheet) => sheet.name);
      const sheetIssuesByName = groupSheetValidationErrors(sheetNames, validation.errors);
      const firstGlobalIssue = validation.errors.find((issue) => !issue.sheet);
      const firstSheet = docState.sheets[0]?.name ?? null;

      set({
        mode: "table",
        docState,
        evaluation,
        presentation,
        validation,
        sheetIssuesByName,
        activeSheet: firstSheet,
        error: firstGlobalIssue?.message ?? null,
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
