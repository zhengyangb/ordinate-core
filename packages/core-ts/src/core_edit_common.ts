export type CoreEditErrorCategory =
  | "invalid_target"
  | "ambiguous_target"
  | "out_of_bounds"
  | "invalid_operation"
  | "rebase_conflict";

export class CoreEditFailure extends Error {
  readonly category: CoreEditErrorCategory;

  constructor(category: CoreEditErrorCategory, message: string) {
    super(message);
    this.category = category;
  }
}

export function assertInteger(
  value: number,
  name: string,
  fail: (category: CoreEditErrorCategory, message: string) => never,
  category: CoreEditErrorCategory = "invalid_target",
): void {
  if (!Number.isInteger(value)) {
    fail(category, `${name} must be an integer`);
  }
}
