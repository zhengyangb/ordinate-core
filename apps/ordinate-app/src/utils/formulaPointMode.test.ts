import { describe, expect, it } from "vitest";

import {
  applyFormulaPointPickToState,
  applyFormulaReferencePick,
  armFormulaPointToken,
  buildReferenceOptions,
  referenceTextForPreferredStyle,
  resolveFormulaReferenceViews,
  syncFormulaPointSelectionState,
  tokenizeFormulaReferences,
  type FormulaPointEditorState,
  type FormulaPointReplacementTarget,
  type FormulaReferenceContext,
} from "./formulaPointMode";

function context(overrides: Partial<FormulaReferenceContext> = {}): FormulaReferenceContext {
  return {
    rowCount: 8,
    colCount: 5,
    headerRowCount: 1,
    rowLabelsByAbsoluteIndex: new Map([
      [2, ["Revenue"]],
      [3, ["Cost"]],
      [4, ["Profit"]],
    ]),
    colLabelPathsByIndex: [["Metric"], ["2024"], ["2025"], ["2026"], ["Notes"]],
    sourceCell: { rAbs: 4, cAbs: 3 },
    ...overrides,
  };
}

function tokenByText(draft: string, text: string) {
  const token = tokenizeFormulaReferences(draft).find((candidate) => candidate.text === text);
  if (!token) throw new Error(`missing token ${text} in ${draft}`);
  return token;
}

function armed(draft: string, text: string): FormulaPointReplacementTarget {
  const token = tokenByText(draft, text);
  return { tokenId: token.id, start: token.start, end: token.end };
}

function state(
  draft: string,
  selectionStart: number,
  selectionEnd = selectionStart,
  overrides: Partial<FormulaPointEditorState> = {},
): FormulaPointEditorState {
  return {
    draft,
    selectionStart,
    selectionEnd,
    activeTokenId: null,
    armedToken: null,
    gestureReplacement: null,
    ...overrides,
  };
}

describe("formula point mode", () => {
  it("replaces exactly one selected reference token", () => {
    const edit = applyFormulaReferencePick("=SUM(B2:C3)", 5, 10, "D4:E5");
    expect(edit.nextDraft).toBe("=SUM(D4:E5)");
    expect(edit.tokenStart).toBe(5);
    expect(edit.tokenEnd).toBe(10);
  });

  it("inserts after an operator instead of replacing the previous token", () => {
    const edit = applyFormulaReferencePick("=B2+", 4, 4, "C3");
    expect(edit.nextDraft).toBe("=B2+C3");
  });

  it("replaces an adjacent token when no operator separates the next pick", () => {
    const edit = applyFormulaReferencePick("=B2", 3, 3, "C3");
    expect(edit.nextDraft).toBe("=C3");
  });

  it("replaces a manual @ point-pick placeholder at the caret", () => {
    const edit = applyFormulaReferencePick("=B2+@", 5, 5, "C3");
    expect(edit.nextDraft).toBe("=B2+C3");
    expect(edit.tokenStart).toBe(4);
    expect(edit.tokenEnd).toBe(6);
  });

  it("fails early when a selection overlaps multiple reference tokens", () => {
    expect(() => applyFormulaReferencePick("=B2+C3", 1, 6, "D4")).toThrow(/multiple formula references/);
  });

  it("preserves ordinate positional style when replacing an active token", () => {
    const views = resolveFormulaReferenceViews("=@[#2,#2]+B3", context());
    const active = views[0];
    expect(active.style).toBe("ordinate-positional");
    const text = referenceTextForPreferredStyle(
      { rowStart: 4, rowEnd: 5, colStart: 2, colEnd: 3 },
      active.style,
      context(),
    );
    expect(text).toBe("@[#4:#5,#3:#4]");
  });

  it("builds disabled label options when labels are ambiguous", () => {
    const options = buildReferenceOptions(
      { rowStart: 2, rowEnd: 2, colStart: 1, colEnd: 1 },
      context({
        rowLabelsByAbsoluteIndex: new Map([
          [2, ["Revenue"]],
          [3, ["Revenue"]],
        ]),
      }),
    );
    const label = options.find((option) => option.style === "ordinate-label");
    expect(label?.text).toBeNull();
    expect(label?.disabledReason).toMatch(/ambiguous/);
  });

  it("uses full header paths and relative same-axis selectors for label options", () => {
    const options = buildReferenceOptions(
      { rowStart: 2, rowEnd: 2, colStart: 1, colEnd: 1 },
      context({
        sourceCell: { rAbs: 4, cAbs: 1 },
        colLabelPathsByIndex: [["Line Item"], ["2024", "H1"], ["2024", "H2"], ["2025", "H1"], ["2025", "H2"]],
      }),
    );
    const label = options.find((option) => option.style === "ordinate-label");
    expect(label?.text).toBe("@[Revenue,_]");
  });

  it("uses namespaced column labels when the target column differs from the source", () => {
    const options = buildReferenceOptions(
      { rowStart: 2, rowEnd: 2, colStart: 3, colEnd: 3 },
      context({
        sourceCell: { rAbs: 4, cAbs: 1 },
        colLabelPathsByIndex: [["Line Item"], ["2024", "H1"], ["2024", "H2"], ["2025", "H1"], ["2025", "H2"]],
      }),
    );
    const label = options.find((option) => option.style === "ordinate-label");
    expect(label?.text).toBe("@[Revenue,2025.H1]");
  });

  it("resolves every existing reference token to its own colored view", () => {
    const views = resolveFormulaReferenceViews("=B2+@[Profit,2025]+D4:E5", context());
    expect(views).toHaveLength(3);
    expect(views.map((view) => view.rect)).toEqual([
      { rowStart: 2, rowEnd: 2, colStart: 1, colEnd: 1 },
      { rowStart: 4, rowEnd: 4, colStart: 2, colEnd: 2 },
      { rowStart: 4, rowEnd: 5, colStart: 3, colEnd: 4 },
    ]);
    expect(new Set(views.map((view) => view.colorIndex)).size).toBe(3);
  });

  describe("point-pick editor state", () => {
    it.each([
      {
        name: "arms the token containing a collapsed caret",
        draft: "=B2+C3",
        selection: [2, 2],
        expectedActive: "B2",
      },
      {
        name: "arms a partially selected token",
        draft: "=B2+C3",
        selection: [1, 2],
        expectedActive: "B2",
      },
      {
        name: "arms a fully selected token",
        draft: "=B2+C3",
        selection: [4, 6],
        expectedActive: "C3",
      },
      {
        name: "normalizes reversed selections",
        draft: "=B2+C3",
        selection: [6, 4],
        expectedActive: "C3",
      },
      {
        name: "clears active state in non-reference text",
        draft: "=B2+C3",
        selection: [3, 4],
        expectedActive: null,
      },
      {
        name: "clears active state when multiple tokens are selected",
        draft: "=B2+C3",
        selection: [1, 6],
        expectedActive: null,
      },
    ])("$name", ({ draft, selection, expectedActive }) => {
      const next = syncFormulaPointSelectionState(draft, selection[0], selection[1], null, null);
      expect(next.activeTokenId).toBe(expectedActive ? tokenByText(draft, expectedActive).id : null);
      expect(next.armedToken?.tokenId ?? null).toBe(expectedActive ? tokenByText(draft, expectedActive).id : null);
    });

    it.each([
      {
        name: "keeps an armed token active at its right boundary",
        draft: "=B2+C3",
        selected: "B2",
        selection: [3, 3],
      },
      {
        name: "keeps an armed token active at its left boundary",
        draft: "=B2+C3",
        selected: "B2",
        selection: [1, 1],
      },
    ])("$name", ({ draft, selected, selection }) => {
      const target = armed(draft, selected);
      const next = syncFormulaPointSelectionState(draft, selection[0], selection[1], target.tokenId, target);
      expect(next.activeTokenId).toBe(target.tokenId);
      expect(next.armedToken).toEqual(target);
    });

    it("arms a token explicitly selected from the colored formula draft", () => {
      const draft = "=B2+C3";
      const target = tokenByText(draft, "C3");
      expect(armFormulaPointToken(draft, target.id)).toEqual({
        activeTokenId: target.id,
        armedToken: { tokenId: target.id, start: target.start, end: target.end },
      });
    });

    it("fails early when asked to arm a missing token", () => {
      expect(() => armFormulaPointToken("=B2+C3", "ref-100-120")).toThrow(/missing formula reference token/);
    });

    it("replaces an armed token even when the caret is at its end boundary", () => {
      const draft = "=B2+C3";
      const target = armed(draft, "B2");
      const result = applyFormulaPointPickToState(
        state(draft, target.end, target.end, { activeTokenId: target.tokenId, armedToken: target }),
        "D4",
        1,
      );
      expect(result.nextState.draft).toBe("=D4+C3");
      expect(result.nextState.activeTokenId).toBe(tokenByText("=D4+C3", "D4").id);
    });

    it("keeps consecutive point picks replacing the same active slot", () => {
      const draft = "=B2+C3";
      const firstTarget = armed(draft, "B2");
      const first = applyFormulaPointPickToState(
        state(draft, firstTarget.end, firstTarget.end, { activeTokenId: firstTarget.tokenId, armedToken: firstTarget }),
        "D4",
        1,
      );
      const second = applyFormulaPointPickToState(first.nextState, "E5", 2);
      expect(second.nextState.draft).toBe("=E5+C3");
      expect(tokenizeFormulaReferences(second.nextState.draft).map((token) => token.text)).toEqual(["E5", "C3"]);
    });

    it("updates a drag gesture in place instead of appending each drag movement", () => {
      const first = applyFormulaPointPickToState(state("=SUM(", 5), "B2", 7);
      const second = applyFormulaPointPickToState(first.nextState, "B2:C4", 7);
      const third = applyFormulaPointPickToState(second.nextState, "B2:D5", 7);
      expect(third.nextState.draft).toBe("=SUM(B2:D5");
      expect(tokenizeFormulaReferences(third.nextState.draft).map((token) => token.text)).toEqual(["B2:D5"]);
    });

    it("inserts a new token after the user types an operator and clears the armed token", () => {
      const result = applyFormulaPointPickToState(state("=B2+", 4), "C3", 1);
      expect(result.nextState.draft).toBe("=B2+C3");
      expect(tokenizeFormulaReferences(result.nextState.draft).map((token) => token.text)).toEqual(["B2", "C3"]);
    });

    it("replaces an adjacent previous token when no operator was typed", () => {
      const result = applyFormulaPointPickToState(state("=B2", 3), "C3", 1);
      expect(result.nextState.draft).toBe("=C3");
      expect(tokenizeFormulaReferences(result.nextState.draft).map((token) => token.text)).toEqual(["C3"]);
    });

    it("replaces an adjacent next token when the caret is at the token start", () => {
      const result = applyFormulaPointPickToState(state("=B2+C3", 4), "D4", 1);
      expect(result.nextState.draft).toBe("=B2+D4");
      expect(tokenizeFormulaReferences(result.nextState.draft).map((token) => token.text)).toEqual(["B2", "D4"]);
    });

    it("replaces a manual @ placeholder and arms the inserted token", () => {
      const result = applyFormulaPointPickToState(state("=B2+@", 5), "C3", 1);
      expect(result.nextState.draft).toBe("=B2+C3");
      expect(result.nextState.activeTokenId).toBe(tokenByText("=B2+C3", "C3").id);
    });

    it("replaces non-reference selected text without arming a previous token", () => {
      const result = applyFormulaPointPickToState(state("=SUM(foo)", 5, 8), "B2", 1);
      expect(result.nextState.draft).toBe("=SUM(B2)");
    });

    it("fails early when a point pick selection overlaps multiple tokens", () => {
      expect(() => applyFormulaPointPickToState(state("=B2+C3", 1, 6), "D4", 1)).toThrow(/multiple formula references/);
    });
  });
});
