import { describe, expect, it, vi } from "vitest";
import type { GridApi } from "ag-grid-community";
import type { GridRow } from "../types/ui";
import { revealSearchCell } from "./searchNavigation";

function fixture() {
  const column = { isVisible: () => true, getActualWidth: () => 120 };
  const api = {
    isDestroyed: vi.fn(() => false), getColumn: vi.fn(() => column),
    ensureIndexVisible: vi.fn(), ensureColumnVisible: vi.fn(),
  };
  return { api, column, grid: { scope: "Destination", api: api as unknown as GridApi<GridRow> } };
}

describe("search reveal readiness", () => {
  it("does not consume navigation before the destination grid has rendered", () => {
    const { grid, api } = fixture();
    expect(revealSearchCell(null, "Destination", 30, 9, true)).toBe(false);
    expect(revealSearchCell(grid, "Other", 30, 9, true)).toBe(false);
    api.isDestroyed.mockReturnValue(true);
    expect(revealSearchCell(grid, "Destination", 30, 9, true)).toBe(false);
    expect(api.ensureColumnVisible).not.toHaveBeenCalled();
  });
  it("reveals a far-right column after readiness, with independent vertical positioning", () => {
    const { grid, api, column } = fixture();
    expect(revealSearchCell(grid, "Destination", 30, 9, true)).toBe(true);
    expect(api.getColumn).toHaveBeenCalledWith("col_30");
    expect(api.ensureColumnVisible).toHaveBeenCalledWith(column, "middle");
    expect(api.ensureIndexVisible).toHaveBeenCalledWith(9, "middle");
  });
  it("waits for collapsed rows, but can reveal frozen headers horizontally", () => {
    const { grid, api } = fixture();
    expect(revealSearchCell(grid, "Destination", 30, undefined, true)).toBe(false);
    expect(revealSearchCell(grid, "Destination", 30, undefined, false)).toBe(true);
    expect(api.ensureIndexVisible).not.toHaveBeenCalled();
  });
});
