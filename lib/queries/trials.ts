import { cache } from "react";
import { workerQuery, workerQueryOne } from "@/lib/worker-pool";
import type {
  TrialDetails,
  TrialPaper,
  TrialSummary,
  TrialYearlyStats,
} from "@/lib/types";

/** Read paths for clinical trials. See lib/queries/mesh.ts for the contract. */

/**
 * A trial can exist in ctg_studies (registry metadata), in trial_summary
 * (linked-paper stats), or both — hence the UNION rather than a plain join.
 * Indexed on nct_id, so this is safe for generateMetadata.
 */
export const getTrialSummary = cache(
  async (nctId: string): Promise<TrialSummary | null> => {
    let summary: TrialSummary | undefined;
    try {
      summary = await workerQueryOne<TrialSummary>(
        `SELECT
           COALESCE(ts.nct_id, ctg.nct_id) as nct_id,
           COALESCE(ts.paper_count, 0) as paper_count,
           ts.result_paper_count, ts.derived_paper_count, ts.background_paper_count,
           ctg.title, ctg.status, ctg.phase, ctg.study_type, ctg.conditions,
           ctg.interventions, ctg.sponsor, ctg.enrollment, ctg.start_date,
           ctg.completion_date, ctg.brief_summary
         FROM ctg_studies ctg
         LEFT JOIN trial_summary ts ON ctg.nct_id = ts.nct_id
        WHERE ctg.nct_id = ?

        UNION ALL

       SELECT
           ts.nct_id, ts.paper_count,
           ts.result_paper_count, ts.derived_paper_count, ts.background_paper_count,
           NULL as title, NULL as status, NULL as phase, NULL as study_type,
           NULL as conditions, NULL as interventions, NULL as sponsor,
           NULL as enrollment, NULL as start_date, NULL as completion_date,
           NULL as brief_summary
         FROM trial_summary ts
        WHERE ts.nct_id = ?
          AND NOT EXISTS (SELECT 1 FROM ctg_studies ctg WHERE ctg.nct_id = ts.nct_id)

        LIMIT 1`,
        nctId,
        nctId
      );
    } catch (e) {
      console.error("Error querying trial:", e);
    }

    if (!summary) return null;

    // Papers with no recorded reference type.
    const known =
      (summary.result_paper_count ?? 0) +
      (summary.derived_paper_count ?? 0) +
      (summary.background_paper_count ?? 0);
    summary.unknown_paper_count = Math.max(0, summary.paper_count - known);

    return summary;
  }
);

export const getTrialPapers = cache(
  async (nctId: string): Promise<TrialPaper[]> => {
    try {
      return await workerQuery<TrialPaper>(
        `SELECT tp.nct_id, tp.paperid, ps.title, ps.year, ps.cited_by_count, tp.reference_type
           FROM trial_papers tp
           LEFT JOIN paper_summary ps ON tp.paperid = ps.paperid
          WHERE tp.nct_id = ?
          ORDER BY ps.cited_by_count DESC NULLS LAST`,
        nctId
      );
    } catch {
      return [];
    }
  }
);

export const getTrialYearlyStats = cache(
  async (nctId: string): Promise<TrialYearlyStats[]> => {
    try {
      return await workerQuery<TrialYearlyStats>(
        `SELECT tp.nct_id, ps.year,
                COUNT(DISTINCT tp.paperid) as paper_count,
                COALESCE(SUM(ps.cited_by_count), 0) as total_citations
           FROM trial_papers tp
           LEFT JOIN paper_summary ps ON tp.paperid = ps.paperid
          WHERE tp.nct_id = ?
            AND ps.year IS NOT NULL AND ps.year > 1800 AND ps.year < 2100
          GROUP BY tp.nct_id, ps.year
          ORDER BY ps.year`,
        nctId
      );
    } catch {
      return [];
    }
  }
);

export const getTrialDetails = cache(
  async (nctId: string): Promise<TrialDetails | null> => {
    const summary = await getTrialSummary(nctId);
    if (!summary) return null;

    const [papers, yearlyStats] = await Promise.all([
      getTrialPapers(nctId),
      getTrialYearlyStats(nctId),
    ]);

    return { summary, papers, yearlyStats };
  }
);
