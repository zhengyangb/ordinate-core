import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    if (element.getAttribute("aria-hidden") === "true") return false;
    return element.getClientRects().length > 0;
  });
}

type ModalShellProps = {
  open: boolean;
  titleId?: string;
  descriptionId?: string;
  className?: string;
  initialFocusRef?: RefObject<HTMLElement>;
  onClose: () => void;
  children: ReactNode;
};

export default function ModalShell({
  open,
  titleId,
  descriptionId,
  className = "",
  initialFocusRef,
  onClose,
  children,
}: ModalShellProps) {
  const fallbackTitleId = useId();
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => {
      const shell = shellRef.current;
      if (!shell) return;
      const target = initialFocusRef?.current ?? getFocusableElements(shell)[0] ?? shell;
      target.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      const shell = shellRef.current;
      if (!shell) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const focusableElements = getFocusableElements(shell);
      if (focusableElements.length === 0) {
        event.preventDefault();
        shell.focus();
        return;
      }

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];
      const active = document.activeElement;

      if (event.shiftKey) {
        if (active === first || !shell.contains(active)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (active === last || !shell.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown, true);
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [initialFocusRef, onClose, open]);

  if (!open) return null;

  return createPortal(
    <div
      className="app-modal-backdrop"
      onMouseDown={(event) => {
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
      }}
    >
      <div
        ref={shellRef}
        className={["app-modal-shell", className].join(" ").trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId ?? fallbackTitleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
