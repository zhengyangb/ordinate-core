import { Children, isValidElement, type ButtonHTMLAttributes, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { FormatMenuList, FormatPreviewPanel, StylePreviewPanel } from "./DisplayMetadataPreview";
import { defaultNumericFormatOptions } from "../utils/formatDisplay";

// These pure option lists expose the same callbacks to all three editing scopes.
function buttons(node: ReactNode): ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>[] {
  return Children.toArray(node).flatMap((child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return [];
    if (child.type === "button") return [child as ReactElement<ButtonHTMLAttributes<HTMLButtonElement>>];
    return buttons(child.props.children);
  });
}

const click = { preventDefault() {} } as MouseEvent<HTMLButtonElement>;

describe("shared display metadata editor", () => {
  it("Auto clears the local format rather than setting a concrete default", () => {
    const onChange = vi.fn();
    const tree = FormatMenuList({ localFormatKey: "decimal", localFormatOptions: defaultNumericFormatOptions("decimal"), inspectedKey: "decimal", onChange });
    buttons(tree).find((button) => button.props["aria-label"] === "Auto")!.props.onClick!(click);
    expect(onChange).toHaveBeenCalledWith("auto", null);
  });

  it("switches numeric families without introducing unsupported options", () => {
    const onChange = vi.fn();
    const options = { ...defaultNumericFormatOptions("decimal"), precision: 3, grouping: true, padWidth: 0, sign: "parentheses" as const };
    const tree = FormatMenuList({ localFormatKey: "decimal", localFormatOptions: options, inspectedKey: "decimal", onChange });
    buttons(tree).find((button) => button.props["aria-label"] === "Scientific")!.props.onClick!(click);
    expect(onChange).toHaveBeenLastCalledWith("scientific", { ...options, grouping: false });
    buttons(tree).find((button) => button.props["aria-label"] === "Integer")!.props.onClick!(click);
    expect(onChange).toHaveBeenLastCalledWith("integer", { ...options, precision: null });
  });

  it.each(["cell", "row", "column"] as const)("preserves per-axis Auto and explicit Regular for %s style", (scope) => {
    const onChange = vi.fn();
    const tree = StylePreviewPanel({ scope, styleLocal: { weight: "bold", align: "right", color: "blue" }, onChange });
    const options = buttons(tree);
    options.find((button) => button.props.children === "Regular")!.props.onClick!(click);
    expect(onChange).toHaveBeenLastCalledWith("weight", "normal");
    options.find((button) => button.props.children === "Auto")!.props.onClick!(click);
    expect(onChange).toHaveBeenLastCalledWith("weight", "auto");
    options.find((button) => button.props["aria-label"] === "Left")!.props.onClick!(click);
    expect(onChange).toHaveBeenLastCalledWith("align", "left");
    options.find((button) => button.props["aria-label"] === "Red")!.props.onClick!(click);
    expect(onChange).toHaveBeenLastCalledWith("color", "red");
    expect(onChange.mock.calls.every((args) => args.length === 2)).toBe(true);
  });

  it("shows one compact editor with advanced numeric fields collapsed", () => {
    const markup = renderToStaticMarkup(<FormatPreviewPanel scope="column" localFormatKey="decimal" localFormatOptions={defaultNumericFormatOptions("decimal")} inspectedKey="decimal" />);
    expect(markup).toContain("Column");
    expect(markup).toContain('aria-label="No thousands separator"');
    expect(markup).toContain('aria-label="Increase decimal places"');
    expect(markup).toContain('<details class="display-advanced-options"><summary>More options</summary>');
    expect(markup).toContain("Auto follows defaults.");
    expect(markup).not.toContain("flyout");
  });

  it("explains cell format inheritance without presenting it as a local override", () => {
    const markup = renderToStaticMarkup(<FormatPreviewPanel localFormatKey="auto" localFormatOptions={null} inspectedKey="auto" effectiveFormatKey="decimal" effectiveFormatOptions={{ ...defaultNumericFormatOptions("decimal"), precision: 2 }} formatSource="row" />);
    expect(markup).toContain('aria-label="Auto" aria-checked="true"');
    expect(markup).toContain("Row format");
    expect(markup).toContain("Auto follows row, then column, then defaults.");
  });

  it("keeps temporal presets and custom patterns available", () => {
    const markup = renderToStaticMarkup(<FormatPreviewPanel localFormatKey="temporal" localFormatOptions={{ kind: "temporal", pattern: "%F", preset: "iso-date" }} inspectedKey="temporal" />);
    expect(markup).toContain('aria-label="Date &amp; Time presets"');
    expect(markup).toContain("Duration");
    expect(markup).not.toContain("%[ms] ms");
    expect(markup).toContain("Custom pattern");
    expect(markup).toContain('value="%F"');
  });

  it("opens the duration group for an existing duration preset", () => {
    const markup = renderToStaticMarkup(<FormatPreviewPanel localFormatKey="temporal" localFormatOptions={{ kind: "temporal", pattern: "%[h]:%M", preset: "duration-clock-short" }} inspectedKey="temporal" />);
    expect(markup).toContain('aria-label="Duration presets"');
    expect(markup).toContain('title="%[ms] ms"');
    expect(markup).not.toContain('title="%F"');
  });

  it.each(["up", "down"] as const)("keeps the type selector in a separate anchor when growing %s", (grow) => {
    const markup = renderToStaticMarkup(<FormatPreviewPanel grow={grow} localFormatKey="decimal" localFormatOptions={defaultNumericFormatOptions("decimal")} inspectedKey="decimal" />);
    expect(markup).toContain(`data-grow="${grow}"`);
    expect(markup).toContain('class="format-type-anchor"');
    expect(markup).toContain('class="format-detail-region"');
  });
});
