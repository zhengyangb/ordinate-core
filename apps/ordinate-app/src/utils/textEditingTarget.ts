export function isNativeTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      "input, textarea, [contenteditable='true'], .formula-source-editor, .formula-source-textarea, .sheet-tab-rename-input",
    ),
  );
}
