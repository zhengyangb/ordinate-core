import { formatErrorTooltip, getExternalErrorLabel } from "../i18n/errorKinds";
import type { UiLocale } from "../i18n/messages";
import { useLayoutEffect, useRef, useState } from "react";

type ErrorCellChipProps = {
  locale: UiLocale;
  externalKind: string;
  internalKind: string;
  context: string;
  onTooltipEnter: (text: string, target: HTMLElement, delayMs?: number) => void;
  onTooltipLeave: () => void;
};

export default function ErrorCellChip({
  locale,
  externalKind,
  internalKind,
  context,
  onTooltipEnter,
  onTooltipLeave,
}: ErrorCellChipProps) {
  const label = getExternalErrorLabel(locale, externalKind);
  const containerRef = useRef<HTMLSpanElement>(null);
  const chipRef = useRef<HTMLSpanElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const [compact, setCompact] = useState(false);
  useLayoutEffect(() => {
    const container = containerRef.current!, chip = chipRef.current!, text = labelRef.current!;
    const measure = () => {
      const style = getComputedStyle(chip);
      const icon = chip.querySelector<HTMLElement>(".error-cell-chip-icon")!;
      const needed = text.scrollWidth + icon.getBoundingClientRect().width + parseFloat(style.columnGap)
        + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 2;
      setCompact(needed > container.clientWidth);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container); observer.observe(text);
    measure();
    return () => observer.disconnect();
  }, [label]);
  const details = formatErrorTooltip({
    locale,
    externalKind,
    internalKind,
    context,
  });

  return (
    <span className="error-cell-chip-container" ref={containerRef}>
    <span
      ref={chipRef}
      className={`error-cell-chip${compact ? " is-compact" : ""}`}
      tabIndex={0}
      role="img"
      aria-label={details}
      onFocus={(event) => onTooltipEnter(details, event.currentTarget, 0)}
      onBlur={onTooltipLeave}
      onMouseEnter={(event) => onTooltipEnter(details, event.currentTarget, 120)}
      onMouseLeave={onTooltipLeave}
    >
      <span className="error-cell-chip-icon" aria-hidden="true">
        <svg viewBox="0 0 14 14" focusable="false">
          <path d="M7 1.2 12.7 11a.8.8 0 0 1-.7 1.2H2a.8.8 0 0 1-.7-1.2L7 1.2Z" />
          <path d="M7 4.3v3.9M7 10.1h.01" />
        </svg>
      </span>
      <span className="error-cell-chip-label" ref={labelRef} aria-hidden="true">{label}</span>
    </span>
    </span>
  );
}
