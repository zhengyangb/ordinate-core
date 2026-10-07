import "./segmentedChoice.css";

/** A compact, keyboard-accessible single choice. */
export function SegmentedChoice<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void;
}) {
  return <div className="segmented-choice" role="radiogroup" aria-label={label}>
    {options.map((option, index) => <button key={option.value} type="button" role="radio" aria-checked={value === option.value}
      tabIndex={value === option.value ? 0 : -1} onClick={() => onChange(option.value)} onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1
          : (index + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) + options.length) % options.length;
        onChange(options[next].value);
        event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>("button")[next].focus();
      }}>{option.label}</button>)}
  </div>;
}
