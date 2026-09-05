import { cache } from "react";
import { workerQuery, workerQueryOne } from "@/lib/worker-pool";
import type {
  FunderConcept,
  FunderDetails,
  FunderSummary,
  FunderYearlyStats,
} from "@/lib/types";

/** Read paths for funder_summary and satellites. See lib/queries/mesh.ts for the contract. */

/** Indexed single-row lookup — safe for generateMetadata. */
export const getFunderSummary = cache(
  async (funderid: string): Promise<FunderSummary | null> => {
    try {
      return (
        (await workerQueryOne<FunderSummary>(
          "SELECT * FROM funder_summary WHERE funderid = ?",
          funderid
        )) ?? null
      );
    } catch {
      // funder_summary is absent in older snapshots.
      return null;
    }
  }
);

export const getFunderYearlyStats = cache(
  async (funderid: string): Promise<FunderYearlyStats[]> => {
    try {
      return await workerQuery<FunderYearlyStats>(
        `SELECT funderid, year, works_count, cited_by_count
           FROM funder_yearly_stats WHERE funderid = ? ORDER BY year`,
        funderid
      );
    } catch {
      return [];
    }
  }
);

export const getFunderConcepts = cache(
  async (funderid: string): Promise<FunderConcept[]> => {
    try {
      return await workerQuery<FunderConcept>(
        `SELECT funderid, fieldid, field_name, level, score
           FROM funder_concepts WHERE funderid = ? ORDER BY score DESC`,
        funderid
      );
    } catch {
      return [];
    }
  }
);

export const getFunderDetails = cache(
  async (funderid: string): Promise<FunderDetails | null> => {
    const summary = await getFunderSummary(funderid);
    if (!summary) return null;

    const [yearlyStats, concepts] = await Promise.all([
      getFunderYearlyStats(funderid),
      getFunderConcepts(funderid),
    ]);

    return { summary, yearlyStats, concepts };
  }
);
