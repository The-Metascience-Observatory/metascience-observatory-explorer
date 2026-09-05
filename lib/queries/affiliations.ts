import { cache } from "react";
import { workerQuery, workerQueryOne } from "@/lib/worker-pool";
import type {
  AffiliationChild,
  AffiliationCollaborator,
  AffiliationDetails,
  AffiliationResearcher,
  AffiliationSummary,
} from "@/lib/types";

/** Read paths for affiliation_summary and satellites. See lib/queries/mesh.ts for the contract. */

/** Indexed single-row lookup — safe for generateMetadata. */
export const getAffiliationSummary = cache(
  async (institutionId: string): Promise<AffiliationSummary | null> =>
    (await workerQueryOne<AffiliationSummary>(
      "SELECT * FROM affiliation_summary WHERE institution_id = ?",
      institutionId
    )) ?? null
);

export const getAffiliationResearchers = cache(
  async (institutionId: string): Promise<AffiliationResearcher[]> => {
    try {
      // person_summary carries the authoritative paper count; the denormalised
      // one on affiliation_researchers is a fallback.
      return await workerQuery<AffiliationResearcher>(
        `SELECT ar.authorid, ar.display_name, ar.h_index,
                COALESCE(ps.productivity, ar.paper_count) as paper_count,
                ar.first_year, ar.last_year
           FROM affiliation_researchers ar
           LEFT JOIN person_summary ps ON ar.authorid = ps.authorid
          WHERE ar.institution_id = ?
          ORDER BY ar.h_index DESC NULLS LAST
          LIMIT 50`,
        institutionId
      );
    } catch {
      return [];
    }
  }
);

export const getAffiliationCollaborators = cache(
  async (institutionId: string): Promise<AffiliationCollaborator[]> => {
    try {
      return await workerQuery<AffiliationCollaborator>(
        `SELECT collaborator_id as institution_id, display_name, country_code, joint_papers
           FROM affiliation_collaborators
          WHERE institution_id = ?
            AND display_name IS NOT NULL AND display_name != ''
          ORDER BY joint_papers DESC
          LIMIT 20`,
        institutionId
      );
    } catch {
      return [];
    }
  }
);

export const getAffiliationRelations = cache(
  async (
    institutionId: string
  ): Promise<{
    childInstitutions: AffiliationChild[];
    parentInstitution?: AffiliationChild;
  }> => {
    const select = (relationship: "child" | "parent", limit: string) =>
      workerQuery<AffiliationChild>(
        `SELECT aa.associated_institution_id as institution_id,
                s.display_name, s.country_code, s.type
           FROM affiliation_associations aa
           LEFT JOIN affiliation_summary s
                  ON aa.associated_institution_id = s.institution_id
          WHERE aa.institution_id = ? AND aa.relationship = ?
          ORDER BY s.display_name ${limit}`,
        institutionId,
        relationship
      );

    try {
      const [childInstitutions, parents] = await Promise.all([
        select("child", ""),
        select("parent", "LIMIT 1"),
      ]);
      return { childInstitutions, parentInstitution: parents[0] };
    } catch {
      // affiliation_associations is created by add_affiliation_associations.py
      // and may not exist in older snapshots.
      return { childInstitutions: [] };
    }
  }
);

export const getAffiliationDetails = cache(
  async (institutionId: string): Promise<AffiliationDetails | null> => {
    const summary = await getAffiliationSummary(institutionId);
    if (!summary) return null;

    const [topResearchers, topCollaborators, relations] = await Promise.all([
      getAffiliationResearchers(institutionId),
      getAffiliationCollaborators(institutionId),
      getAffiliationRelations(institutionId),
    ]);

    return {
      summary,
      // Yearly stats are intentionally empty: the underlying data was found to
      // be inaccurate and the chart was disabled upstream.
      yearlyStats: [],
      topResearchers,
      topCollaborators,
      childInstitutions: relations.childInstitutions,
      parentInstitution: relations.parentInstitution,
    };
  }
);
