import { describe, expect, it } from "vitest";
import { mergeSortedCitations, type RankedPaper } from "@/lib/merge-citations";

const P = (
  paperid: string,
  cited_by_count: number | null,
  extra: Partial<RankedPaper> = {}
): RankedPaper => ({ paperid, cited_by_count, ...extra });

const ids = (rows: RankedPaper[]) => rows.map((r) => r.paperid);

describe("mergeSortedCitations", () => {
  it("interleaves two finished streams by citation count", () => {
    expect(
      ids(mergeSortedCitations([P("s1", 900), P("s2", 500)], true, [P("o1", 700), P("o2", 100)], true))
    ).toEqual(["s1", "o1", "s2", "o2"]);
  });

  it("emits nothing while a stream is unfetched and unfinished", () => {
    // The OpenAIRE page-1 fetch has not landed. Any of its rows could outrank
    // everything SciSciNet holds, so nothing is placeable yet.
    expect(ids(mergeSortedCitations([P("s1", 900), P("s2", 500)], false, [], false))).toEqual([]);
  });

  it("falls through to the other stream when one is empty and finished", () => {
    expect(ids(mergeSortedCitations([P("s1", 900), P("s2", 500)], true, [], true))).toEqual([
      "s1",
      "s2",
    ]);
  });

  it("does not emit a lower-ranked row ahead of an unfetched page", () => {
    // Regression guard: emitting s1/s2 here and then receiving a higher-ranked
    // OpenAIRE page would REPLACE rows already on screen, not reorder them.
    expect(
      ids(mergeSortedCitations([P("s1", 900), P("s2", 800)], false, [P("o1", 5000), P("o2", 4000)], false))
    ).toEqual(["o1", "o2"]);
  });

  it("emits rows that strictly outrank what the other stream might still deliver", () => {
    // sci's floor is 800, so OpenAIRE rows above 800 are provably placeable.
    expect(
      ids(
        mergeSortedCitations(
          [P("s1", 900), P("s2", 800)],
          false,
          [P("o1", 850), P("o2", 820), P("o3", 810)],
          false
        )
      )
    ).toEqual(["s1", "o1", "o2", "o3"]);
  });

  it("blocks on a drained-but-unfinished stream", () => {
    // o1 (780) is held back: sci could still deliver something between 800 and 780.
    expect(
      ids(mergeSortedCitations([P("s1", 900), P("s2", 800)], false, [P("o1", 780)], false))
    ).toEqual(["s1", "s2"]);
  });

  it("is append-only as buffers grow", () => {
    // The property that makes interleaving safe under infinite scroll: a row
    // already rendered never moves or disappears.
    const sci = [P("s1", 900), P("s2", 800)];
    const oa = [P("o1", 850)];
    const before = ids(mergeSortedCitations(sci, false, oa, false));
    const after = ids(
      mergeSortedCitations([...sci, P("s3", 700)], true, [...oa, P("o2", 600)], true)
    );
    expect(before.length).toBeGreaterThan(0);
    expect(after.slice(0, before.length)).toEqual(before);
  });

  it("degrades to appending when every count is unknown", () => {
    // impactAvailable === false: the BIP! table is absent, so the whole OpenAIRE
    // response has null counts. They sort last rather than being read as zero.
    expect(
      ids(mergeSortedCitations([P("s1", 900), P("s2", 500)], true, [P("o1", null), P("o2", null)], true))
    ).toEqual(["s1", "s2", "o1", "o2"]);
  });

  it("keeps an unresolved row in its build-time position", () => {
    // Its position in the pre-sorted blob is authoritative even though we can't
    // name the paper, so it inherits the preceding rank instead of sinking.
    expect(
      ids(
        mergeSortedCitations(
          [P("s1", 1000), P("s2", 10)],
          true,
          [P("o1", 900), P("o2", null, { unresolved: true }), P("o3", 800)],
          true
        )
      )
    ).toEqual(["s1", "o1", "o2", "o3", "s2"]);
  });

  it("never emits a duplicate id", () => {
    expect(ids(mergeSortedCitations([P("s1", 900), P("s1", 900)], true, [], true))).toEqual(["s1"]);
  });

  it("breaks ties toward the first stream", () => {
    expect(ids(mergeSortedCitations([P("s1", 500)], true, [P("o1", 500)], true))).toEqual([
      "s1",
      "o1",
    ]);
  });

  it("returns nothing when both streams are empty and finished", () => {
    expect(mergeSortedCitations([], true, [], true)).toEqual([]);
  });
});
