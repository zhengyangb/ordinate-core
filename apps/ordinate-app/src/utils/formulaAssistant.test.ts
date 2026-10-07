import { describe, expect, it } from "vitest";
import { getStandardFunctionMetadata, listStandardFunctionMetadata } from "@ordinate/core";

import {
  activeParameterIndexForFormulaAssistant,
  applyFormulaAssistantTextReplacement,
  buildFunctionCallInsertion,
  buildFunctionSuggestions,
  correctFormulaAssistantInputChange,
  isFormulaAssistantImeEvent,
  nextFormulaAssistantSelectedIndex,
  resolveActiveFunctionCallContext,
  resolveFormulaAssistantContexts,
  resolveFunctionNameContext,
} from "./formulaAssistant";

describe("formula assistant", () => {
  const functions = listStandardFunctionMetadata();

  it.each(functions.filter(fn => fn.category === 'numeric' || fn.category === 'statistical').map(fn => fn.name))
    ('offers %s from the runtime catalog and resolves its active argument', name => {
      expect(buildFunctionSuggestions(functions, name).some(item => item.displayName === name)).toBe(true);
      const draft = `= ${name}(`;
      expect(resolveActiveFunctionCallContext(draft, draft.length, candidate => candidate === name))
        .toMatchObject({ name, argumentIndex: 0 });
      expect(getStandardFunctionMetadata(name)?.signatures.length).toBeGreaterThan(0);
    });

  it("completes functions in an unfinished interpolation, not literal text or specs", () => {
    const field = '= f"Total: {for';
    expect(resolveFunctionNameContext(field, field.length)).toMatchObject({ query: 'for' });
    const literal = '= f"for';
    expect(resolveFunctionNameContext(literal, literal.length)).toBeNull();
    const spec = '= f"{A1:for';
    expect(resolveFunctionNameContext(spec, spec.length)).toBeNull();
    expect(functions.find(fn => fn.name === 'format')?.signatures).toHaveLength(2);
  });

  it("shows the active function parameter inside an f-string field", () => {
    const draft = '= f"{format(A1, ';
    expect(resolveActiveFunctionCallContext(draft, draft.length, name => name === 'format')).toMatchObject({ name: 'format', argumentIndex: 1 });
  });

  it("detects a prefix function-name context in a formula draft", () => {
    expect(resolveFunctionNameContext("=su", 3)).toEqual({
      kind: "name",
      query: "su",
      start: 1,
      end: 3,
    });
  });

  it.each(["=su()", "=su + 1", "=su "])("keeps autocomplete active before an existing boundary in %s", (draft) => {
    expect(resolveFunctionNameContext(draft, 3)).toEqual({
      kind: "name",
      query: "su",
      start: 1,
      end: 3,
    });
  });

  it("does not offer function-name autocomplete inside strings or references", () => {
    expect(resolveFunctionNameContext("=\"su", 4)).toBeNull();
    expect(resolveFunctionNameContext("=@[su", 5)).toBeNull();
    const crossSheetDraft = "=@[\"Inputs\"::[su";
    expect(resolveFunctionNameContext(crossSheetDraft, crossSheetDraft.length)).toBeNull();
  });

  it("uses prefix matching only and includes matching aliases", () => {
    const suggestions = buildFunctionSuggestions(functions, "su");
    expect(suggestions.map((suggestion) => suggestion.displayName)).toContain("sum");
    expect(suggestions.map((suggestion) => suggestion.displayName)).toContain("sumproduct");
    expect(suggestions.find((suggestion) => suggestion.displayName === "sumproduct")?.isAlias).toBe(true);
    expect(buildFunctionSuggestions(functions, "um")).toEqual([]);
  });

  it("builds a function call insertion with the caret inside the parentheses", () => {
    const suggestion = buildFunctionSuggestions(functions, "su").find((candidate) => candidate.displayName === "sum");
    if (!suggestion) throw new Error("missing sum suggestion");

    expect(
      buildFunctionCallInsertion({
        draft: "=su",
        isFormulaDraft: true,
        suggestion,
        replacementStart: 1,
        replacementEnd: 3,
      }),
    ).toEqual({
      nextInput: "=sum()",
      nextCaret: 5,
      nextGuardedCloseParen: 5,
    });
  });

  it.each([
    ["=su()", "=sum()", 5, 5],
    ["=su(", "=sum(", 5, null],
    ["=su(1)", "=sum(1)", 5, null],
    ["=su ()", "=sum ()", 6, 6],
    ["=su\n(1)", "=sum\n(1)", 6, null],
  ] as const)("reuses an existing call opener in %s", (draft, nextInput, nextCaret, nextGuardedCloseParen) => {
    const suggestion = buildFunctionSuggestions(functions, "su").find((candidate) => candidate.displayName === "sum");
    if (!suggestion) throw new Error("missing sum suggestion");

    expect(buildFunctionCallInsertion({
      draft,
      isFormulaDraft: true,
      suggestion,
      replacementStart: 1,
      replacementEnd: 3,
    })).toEqual({ nextInput, nextCaret, nextGuardedCloseParen });
  });

  it("keeps the enclosing call context active after a keyword", () => {
    expect(resolveFormulaAssistantContexts("=if(true, 1, 0)", 8)).toEqual({
      name: null,
      call: { kind: "call", name: "if", argumentIndex: 0 },
    });
  });

  it("builds a formula call when inserting from a non-formula value", () => {
    const suggestion = buildFunctionSuggestions(functions, "su").find((candidate) => candidate.displayName === "sum");
    if (!suggestion) throw new Error("missing sum suggestion");

    expect(
      buildFunctionCallInsertion({
        draft: "hello",
        isFormulaDraft: false,
        suggestion,
        replacementStart: 0,
        replacementEnd: 5,
      }),
    ).toEqual({
      nextInput: "= sum()",
      nextCaret: 6,
      nextGuardedCloseParen: 6,
    });
  });

  it("keeps text typed after an inserted call inside the guarded close paren", () => {
    expect(
      correctFormulaAssistantInputChange({
        draft: "=sum()",
        nextInput: "=sum()12",
        isFormulaDraft: true,
        guardedCloseParen: 5,
        explicitReferenceView: null,
      }),
    ).toEqual({
      nextInput: "=sum(12)",
      nextCaret: 7,
      nextGuardedCloseParen: 7,
    });
  });

  it("redirects direct text replacement before the guarded close paren", () => {
    expect(
      applyFormulaAssistantTextReplacement({
        draft: "=sum()",
        start: 6,
        end: 6,
        text: "12",
        guardedCloseParen: 5,
      }),
    ).toEqual({
      nextInput: "=sum(12)",
      nextCaret: 7,
      nextGuardedCloseParen: 7,
    });
  });

  it("resolves active function-call parameter context", () => {
    expect(resolveActiveFunctionCallContext("=sum(@[:,Revenue], ", 18)).toEqual({
      kind: "call",
      name: "sum",
      argumentIndex: 1,
    });
  });

  it("ignores commas inside strings and references while resolving parameter context", () => {
    expect(resolveActiveFunctionCallContext("=sum(\"a,b\", @[:,Revenue])", 12)).toEqual({
      kind: "call",
      name: "sum",
      argumentIndex: 1,
    });
    expect(resolveActiveFunctionCallContext("=sum(@[Revenue,2025], ", 22)).toEqual({
      kind: "call",
      name: "sum",
      argumentIndex: 1,
    });
    const crossSheetDraft = "=sum(@[\"Inputs\"::[Revenue,Amount]], ";
    expect(resolveActiveFunctionCallContext(crossSheetDraft, crossSheetDraft.length)).toEqual({
      kind: "call",
      name: "sum",
      argumentIndex: 1,
    });
  });

  it("counts only direct call separators around arrays and postfix indexes", () => {
    const arrayDraft = "=dotProduct([1, 2], [3, 4])";
    expect(resolveActiveFunctionCallContext(arrayDraft, arrayDraft.indexOf("2]") + 1)).toEqual({
      kind: "call",
      name: "dotProduct",
      argumentIndex: 0,
    });
    expect(resolveActiveFunctionCallContext(arrayDraft, arrayDraft.indexOf("4]") + 1)).toEqual({
      kind: "call",
      name: "dotProduct",
      argumentIndex: 1,
    });

    const indexDraft = "=sum(@[:,Revenue][0:2, 0:1], 5)";
    expect(resolveActiveFunctionCallContext(indexDraft, indexDraft.indexOf("0:1") + 2)).toEqual({
      kind: "call",
      name: "sum",
      argumentIndex: 0,
    });
    expect(resolveActiveFunctionCallContext(indexDraft, indexDraft.lastIndexOf("5"))).toEqual({
      kind: "call",
      name: "sum",
      argumentIndex: 1,
    });
  });

  it("selects the innermost known call and switches back to its parent", () => {
    const draft = "=if(sum([1,2]) > 0, 1, 0)";
    expect(resolveActiveFunctionCallContext(draft, draft.indexOf("2]"))).toEqual({
      kind: "call",
      name: "sum",
      argumentIndex: 0,
    });
    expect(resolveActiveFunctionCallContext(draft, draft.indexOf("> 0") + 2)).toEqual({
      kind: "call",
      name: "if",
      argumentIndex: 0,
    });
  });

  it("derives name and call contexts from one core inspection", () => {
    expect(resolveFormulaAssistantContexts("=sum(su", 7)).toEqual({
      name: { kind: "name", query: "su", start: 5, end: 7 },
      call: { kind: "call", name: "sum", argumentIndex: 0 },
    });
  });

  it("clamps active parameter and list navigation without wrapping", () => {
    const rank = getStandardFunctionMetadata("rank");
    if (!rank) throw new Error("missing rank metadata");

    expect(activeParameterIndexForFormulaAssistant(rank, -1)).toBe(0);
    expect(activeParameterIndexForFormulaAssistant(rank, 20)).toBe(1);
    expect(nextFormulaAssistantSelectedIndex(0, 4, "ArrowUp")).toBe(0);
    expect(nextFormulaAssistantSelectedIndex(3, 4, "ArrowDown")).toBe(3);
    expect(nextFormulaAssistantSelectedIndex(1, 4, "ArrowDown")).toBe(2);
  });

  it("recognizes IME composition keyboard events", () => {
    expect(isFormulaAssistantImeEvent({ isComposing: true, keyCode: 13 })).toBe(true);
    expect(isFormulaAssistantImeEvent({ isComposing: false, keyCode: 229 })).toBe(true);
    expect(isFormulaAssistantImeEvent({ isComposing: false, keyCode: 13 })).toBe(false);
  });
});
