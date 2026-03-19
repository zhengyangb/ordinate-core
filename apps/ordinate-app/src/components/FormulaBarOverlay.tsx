import type { FormulaBarData } from "../types/ui";

type FormulaBarOverlayProps = {
  mode: "table" | "source";
  formulaBarData: FormulaBarData | null;
  formulaBarSnapshot: FormulaBarData | null;
};

export default function FormulaBarOverlay({ mode, formulaBarData, formulaBarSnapshot }: FormulaBarOverlayProps) {
  if (mode !== "table" || !formulaBarSnapshot) return null;

  return (
    <aside
      className={formulaBarData ? "formula-bar-shell is-visible" : "formula-bar-shell is-hiding"}
      aria-live="polite"
      aria-hidden={formulaBarData ? undefined : true}
    >
      <div className="formula-bar">
        <div className="formula-bar-meta">
          <span className="formula-chip fx">=</span>
          <span className="formula-address">{formulaBarSnapshot.primaryAddress}</span>
          <span className="formula-subaddress">{formulaBarSnapshot.secondaryAddress}</span>
          <span className="formula-chip">{formulaBarSnapshot.chip}</span>
          <span className="formula-value-preview">{formulaBarSnapshot.displayText || " "}</span>
        </div>
        <div className="formula-source" title={formulaBarSnapshot.sourceText}>
          {formulaBarSnapshot.sourceText}
        </div>
      </div>
    </aside>
  );
}
