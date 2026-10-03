import { type RefObject, useLayoutEffect } from "react";
import { formulaBarSurfaceFrames } from "../utils/formulaBarGeometry";

/** Size once per edit/width change; reveal upward without per-frame layout. */
export function useFormulaBarLayout(
  shellRef: RefObject<HTMLElement>,
  editorRef: RefObject<HTMLTextAreaElement>,
  draft: string,
  editing: boolean,
  formula: boolean,
  visible: boolean,
) {
  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const resize = () => {
      editor.style.height = "auto";
      const style = getComputedStyle(editor);
      const borders = Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
      editor.style.height = `${editor.scrollHeight + borders}px`;
      editor.style.overflowY = editor.scrollHeight > editor.clientHeight ? "auto" : "hidden";
    };
    resize();
    let width = editor.clientWidth;
    const observer = new ResizeObserver(() => {
      if (editor.clientWidth === width) return;
      width = editor.clientWidth;
      resize();
    });
    observer.observe(editor);
    return () => observer.disconnect();
  }, [draft, editing, formula, editorRef]);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const owner = shell.parentElement!;
    const surface = shell.querySelector<HTMLElement>(".formula-bar-surface")!;
    let previousHeight = shell.offsetHeight;
    let animation: Animation | undefined;
    const measure = () => {
      const height = shell.offsetHeight;
      owner.style.setProperty("--formula-bar-measured-space", `${height + 28}px`);
      if (height !== previousHeight) {
        // The content keeps its natural size and bottom alignment throughout.
        // Only the background stretches, so glyphs never squash or blur.
        const startHeight = previousHeight * surface.getBoundingClientRect().height / surface.offsetHeight;
        animation?.cancel();
        if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          const timing = { duration: 180, easing: "cubic-bezier(0.22, 1, 0.36, 1)" };
          const radius = Number.parseFloat(getComputedStyle(shell).borderTopLeftRadius);
          animation = surface.animate(
            formulaBarSurfaceFrames(startHeight, height, radius),
            timing,
          );
          // The editor and its shadow update immediately. Clipping the editor
          // during growth hides its focus edge until the animation finishes.
        }
        previousHeight = height;
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(shell);
    return () => {
      animation?.cancel();
      observer.disconnect();
      owner.style.removeProperty("--formula-bar-measured-space");
    };
  }, [visible, shellRef, editorRef]);
}
