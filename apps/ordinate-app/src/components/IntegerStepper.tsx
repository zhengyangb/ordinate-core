import { useEffect, useState } from "react";
import "./integerStepper.css";

/** A bounded whole-number editor: type then commit, or step with one click. */
export function IntegerStepper({ id, label, value, maximum, disabled = false, onChange }: {
  id: string;
  label: string;
  value: number;
  maximum: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setDraft(String(value)); setError(null); }, [value, maximum]);
  const valid = (raw: string) => raw.trim() !== "" && Number.isInteger(Number(raw)) && Number(raw) >= 0 && Number(raw) <= maximum;
  const commit = (raw: string) => {
    const next = Number(raw);
    if (!valid(raw)) {
      setDraft(String(value));
      setError(`Choose a whole number from 0 to ${maximum}.`);
      return;
    }
    try {
      if (next !== value) onChange(next);
      setDraft(String(next));
      setError(null);
    } catch (issue) {
      // A valid count can still be rejected by the owning domain (e.g. formula headers).
      setDraft(String(value));
      setError(issue instanceof Error ? issue.message : String(issue));
    }
  };
  const step = (direction: -1 | 1) => {
    const current = Number(draft);
    if (!valid(draft)) {
      commit(draft);
      return;
    }
    commit(String(Math.max(0, Math.min(maximum, current + direction))));
  };
  return <div className="integer-stepper-field">
    <div className="integer-stepper" data-disabled={disabled}>
      {/* Step from the current draft without a preceding blur committing it twice. */}
      <button type="button" className="integer-stepper-button" aria-label={`Decrease ${label.toLowerCase()}`}
        disabled={disabled || draft.trim() !== "" && Number(draft) === 0}
        onPointerDown={event => event.preventDefault()} onClick={() => step(-1)}>−</button>
      <input id={id} className="integer-stepper-input" type="number" min={0} max={maximum} step={1} data-escape-owner
        value={draft} disabled={disabled} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}
        onChange={event => { setDraft(event.currentTarget.value); setError(null); }}
        onBlur={event => commit(event.currentTarget.value)}
        onKeyDown={event => {
          if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); event.currentTarget.blur(); }
          if (event.key === "Escape") {
            event.preventDefault(); event.stopPropagation();
            event.currentTarget.value = String(value); setDraft(String(value)); setError(null); event.currentTarget.blur();
          }
        }} />
      <button type="button" className="integer-stepper-button" aria-label={`Increase ${label.toLowerCase()}`}
        disabled={disabled || draft.trim() !== "" && Number(draft) === maximum}
        onPointerDown={event => event.preventDefault()} onClick={() => step(1)}>+</button>
    </div>
    {error && <p id={`${id}-error`} className="integer-stepper-error" role="alert">{error}</p>}
  </div>;
}
