import { describe, expect, it } from "vitest";
import { buildDoiCsv } from "@/lib/doi-csv";

describe("buildDoiCsv", () => {
  it("emits a header and one bare DOI per line", () => {
    expect(
      buildDoiCsv(["https://doi.org/10.1038/nature12373", "10.1126/science.1241224"])
    ).toBe("DOI\n10.1038/nature12373\n10.1126/science.1241224\n");
  });

  it("strips http and legacy dx.doi.org prefixes", () => {
    expect(buildDoiCsv(["http://dx.doi.org/10.1016/j.cell.2019.05.031"])).toBe(
      "DOI\n10.1016/j.cell.2019.05.031\n"
    );
  });

  it("skips null and empty values and dedupes, keeping first-seen order", () => {
    expect(
      buildDoiCsv([null, "10.1/b", "", undefined, "https://doi.org/10.1/b", "10.1/a"])
    ).toBe("DOI\n10.1/b\n10.1/a\n");
  });

  it("quotes DOIs that contain commas or quotes", () => {
    expect(buildDoiCsv(['10.1002/(sici)1,2"x'])).toBe('DOI\n"10.1002/(sici)1,2""x"\n');
  });

  it("returns only the header when there are no DOIs", () => {
    expect(buildDoiCsv([])).toBe("DOI\n");
  });
});
