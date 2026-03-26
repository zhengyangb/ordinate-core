import type { ChromeVisibilityPhase, FormulaBarData } from "../types/ui";

type FormulaBarOverlayProps = {
  mode: "table" | "source";
  phase: ChromeVisibilityPhase;
  formulaBarData: FormulaBarData | null;
  formulaBarSnapshot: FormulaBarData | null;
};

export default function FormulaBarOverlay({ mode, phase, formulaBarData, formulaBarSnapshot }: FormulaBarOverlayProps) {
  if (mode !== "table" || phase === "hidden" || !formulaBarSnapshot) return null;

  const hasDisplayMeta =
    Boolean(formulaBarSnapshot.displaySource) ||
    Boolean(formulaBarSnapshot.displayFormatRaw) ||
    Boolean(formulaBarSnapshot.displayStyleRaw) ||
    Boolean(formulaBarSnapshot.displayErrors?.length);

  return (
    <aside
      className={`formula-bar-shell formula-bar-shell--${phase}`}
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
        {hasDisplayMeta ? (
          <div className="formula-display-meta" aria-label="Display metadata">
            {formulaBarSnapshot.displaySource ? <span className="formula-meta-chip">{`source:${formulaBarSnapshot.displaySource}`}</span> : null}
            {formulaBarSnapshot.displayFormatRaw ? <span className="formula-meta-chip">{`fmt:${formulaBarSnapshot.displayFormatRaw}`}</span> : null}
            {formulaBarSnapshot.displayStyleRaw ? <span className="formula-meta-chip">{`sty:${formulaBarSnapshot.displayStyleRaw}`}</span> : null}
            {formulaBarSnapshot.displayErrors?.length
              ? formulaBarSnapshot.displayErrors.map((issue, index) => (
                  <span key={`display-error-${index}`} className="formula-meta-chip is-warning" title={issue}>
                    {issue}
                  </span>
                ))
              : null}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
