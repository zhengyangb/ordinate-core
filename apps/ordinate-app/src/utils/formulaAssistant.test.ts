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
  resolveFunctionNameContext,
} from "./formulaAssistant";

describe("formula assistant", () => {
  const functions = listStandardFunctionMetadata();

  it("detects a prefix function-name context in a formula draft", () => {
    expect(resolveFunctionNameContext("=su", 3)).toEqual({
      kind: "name",
      query: "su",
      start: 1,
      end: 3,
    });
  });

  it("does not offer function-name autocomplete inside strings or references", () => {
    expect(resolveFunctionNameContext("=\"su", 4)).toBeNull();
    expect(resolveFunctionNameContext("=@[su", 5)).toBeNull();
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
