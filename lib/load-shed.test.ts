import { describe, expect, it } from "vitest";
import { DEFAULT_LAG_BUDGET_MS, exceedsLagBudget, lagBudgetFromEnv } from "@/lib/load-shed";

describe("exceedsLagBudget", () => {
  it("sheds only above the budget", () => {
    expect(exceedsLagBudget(100, 250)).toBe(false);
    expect(exceedsLagBudget(250, 250)).toBe(false);
    expect(exceedsLagBudget(251, 250)).toBe(true);
  });

  it("never sheds when disabled (budget 0 or negative)", () => {
    expect(exceedsLagBudget(10_000, 0)).toBe(false);
    expect(exceedsLagBudget(10_000, -1)).toBe(false);
  });

  it("never sheds on a cold server (lag 0)", () => {
    expect(exceedsLagBudget(0, 1)).toBe(false);
  });
});

describe("lagBudgetFromEnv", () => {
  it("defaults when unset or blank", () => {
    expect(lagBudgetFromEnv(undefined)).toBe(DEFAULT_LAG_BUDGET_MS);
    expect(lagBudgetFromEnv("")).toBe(DEFAULT_LAG_BUDGET_MS);
    expect(lagBudgetFromEnv("  ")).toBe(DEFAULT_LAG_BUDGET_MS);
  });

  it("defaults on garbage rather than disabling silently", () => {
    expect(lagBudgetFromEnv("fast")).toBe(DEFAULT_LAG_BUDGET_MS);
  });

  it("parses numbers, treating 0 and negatives as disabled", () => {
    expect(lagBudgetFromEnv("500")).toBe(500);
    expect(lagBudgetFromEnv("0")).toBe(0);
    expect(lagBudgetFromEnv("-5")).toBe(0);
  });
});
