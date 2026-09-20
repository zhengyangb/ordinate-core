import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type HTMLAttributes } from "react";

type EditorPopoverProps = HTMLAttributes<HTMLDivElement> & {
  grow?: "up" | "down";
};

/** Shared opaque surface. Resize motion scales only the backdrop, never text or controls. */
export const EditorPopover = forwardRef<HTMLDivElement, EditorPopoverProps>(function EditorPopover(
  { grow = "down", className = "", children, ...props },
  forwardedRef,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(forwardedRef, () => rootRef.current!);

  useLayoutEffect(() => {
    const root = rootRef.current!;
    const surface = surfaceRef.current!;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let previousHeight = root.getBoundingClientRect().height;
    let animation: Animation | null = null;
    const cancelAnimation = () => animation?.cancel();
    const observer = new ResizeObserver(([entry]) => {
      const height = entry.borderBoxSize[0].blockSize;
      const previous = previousHeight;
      previousHeight = height;
      animation?.cancel();
      if (reducedMotion.matches || height <= 0 || previous <= 0 || Math.abs(previous - height) < 1) return;
      animation = surface.animate(
        [{ transform: `scaleY(${previous / height})` }, { transform: "scaleY(1)" }],
        { duration: 180, easing: "cubic-bezier(0.25, 1, 0.5, 1)" },
      );
    });
    observer.observe(root, { box: "border-box" });
    reducedMotion.addEventListener("change", cancelAnimation);
    return () => {
      observer.disconnect();
      reducedMotion.removeEventListener("change", cancelAnimation);
      animation?.cancel();
    };
  }, []);

  return (
    <div {...props} ref={rootRef} className={`editor-popover ${className}`} data-grow={grow}>
      <div ref={surfaceRef} className="editor-popover-surface" aria-hidden="true" />
      {children}
    </div>
  );
});
