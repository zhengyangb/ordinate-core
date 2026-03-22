import type { SheetIssueViewModel } from "../types/ui";

type SheetParseErrorPanelProps = {
  sheetName: string;
  issues: SheetIssueViewModel[];
  onOpenSourceMode: () => void;
};

function renderIssue(issue: SheetIssueViewModel): string {
  const parts: string[] = [];
  if (issue.row != null && issue.col != null) {
    parts.push(`Row ${issue.row}, Col ${issue.col}`);
  } else if (issue.row != null) {
    parts.push(`Row ${issue.row}`);
  } else if (issue.col != null) {
    parts.push(`Col ${issue.col}`);
  }
  parts.push(issue.message);
  return parts.join(" - ");
}

export default function SheetParseErrorPanel({ sheetName, issues, onOpenSourceMode }: SheetParseErrorPanelProps) {
  const firstIssue = issues[0] ?? null;
  return (
    <div className="sheet-parse-error" role="alert">
      <h3>{`"${sheetName}" cannot be rendered as a table`}</h3>
      <p>This sheet is still preserved in source. Fix the parse/validation issues in Source Mode.</p>
      {firstIssue ? (
        <p className="sheet-parse-error-first">{`First issue: ${renderIssue(firstIssue)}`}</p>
      ) : null}
      <ul className="sheet-parse-error-list">
        {issues.slice(0, 8).map((issue, index) => (
          <li key={`${index}-${issue.row ?? "na"}-${issue.col ?? "na"}-${issue.message}`}>{renderIssue(issue)}</li>
        ))}
      </ul>
      {issues.length > 8 ? <p className="sheet-parse-error-more">{`+${issues.length - 8} more issue(s)`}</p> : null}
      <button className="sheet-parse-error-action" type="button" onClick={onOpenSourceMode}>
        Open Source Mode
      </button>
    </div>
  );
}
