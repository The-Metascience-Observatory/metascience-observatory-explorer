import { NextResponse } from "next/server";
import { getDb, isDatabaseAvailable } from "@/lib/db";
import { errorResponse } from "@/lib/api-utils";
import type {
  AffiliationSummary,
  AffiliationResearcher,
  AffiliationCollaborator,
  AffiliationChild,
  AffiliationDetails,
} from "@/lib/types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ institutionid: string }> }
) {
  try {
    const { institutionid } = await params;

    // Check if database is available
    if (!isDatabaseAvailable()) {
      return NextResponse.json(
        {
          error: "Database not found. Run the preprocessing script first.",
        },
        { status: 500 }
      );
    }

    const db = getDb();

    // Get affiliation summary
    const summary = db
      .prepare(`SELECT * FROM affiliation_summary WHERE institution_id = ?`)
      .get(institutionid) as AffiliationSummary | undefined;

    if (!summary) {
      return NextResponse.json(
        { error: "Affiliation not found" },
        { status: 404 }
      );
    }

    // Yearly statistics disabled - data not accurate
    const yearlyStats: { institution_id: string; year: number; paper_count: number; total_citations: number }[] = [];

    // Get top researchers - join with person_summary for accurate paper counts
    let topResearchers: AffiliationResearcher[] = [];
    try {
      topResearchers = db
        .prepare(
          `SELECT ar.authorid, ar.display_name, ar.h_index,
                  COALESCE(ps.productivity, ar.paper_count) as paper_count,
                  ar.first_year, ar.last_year
           FROM affiliation_researchers ar
           LEFT JOIN person_summary ps ON ar.authorid = ps.authorid
           WHERE ar.institution_id = ?
           ORDER BY ar.h_index DESC NULLS LAST
           LIMIT 50`
        )
        .all(institutionid) as AffiliationResearcher[];
    } catch {
      console.log("affiliation_researchers table not found, skipping");
    }

    // Get top collaborators - filter out those without display names
    let topCollaborators: AffiliationCollaborator[] = [];
    try {
      topCollaborators = db
        .prepare(
          `SELECT collaborator_id as institution_id, display_name, country_code, joint_papers
           FROM affiliation_collaborators
           WHERE institution_id = ?
             AND display_name IS NOT NULL
             AND display_name != ''
           ORDER BY joint_papers DESC
           LIMIT 20`
        )
        .all(institutionid) as AffiliationCollaborator[];
    } catch {
      console.log("affiliation_collaborators table not found, skipping");
    }

    // Get child institutions (subinstitutions within this institution)
    let childInstitutions: AffiliationChild[] = [];
    try {
      childInstitutions = db
        .prepare(
          `SELECT aa.associated_institution_id as institution_id,
                  s.display_name, s.country_code, s.type
           FROM affiliation_associations aa
           LEFT JOIN affiliation_summary s ON aa.associated_institution_id = s.institution_id
           WHERE aa.institution_id = ? AND aa.relationship = 'child'
           ORDER BY s.display_name`
        )
        .all(institutionid) as AffiliationChild[];
    } catch {
      // Table doesn't exist yet - will be created by add_affiliation_associations.py
    }

    // Get parent institution (if this is a subinstitution)
    let parentInstitution: AffiliationChild | undefined;
    try {
      parentInstitution = db
        .prepare(
          `SELECT aa.associated_institution_id as institution_id,
                  s.display_name, s.country_code, s.type
           FROM affiliation_associations aa
           LEFT JOIN affiliation_summary s ON aa.associated_institution_id = s.institution_id
           WHERE aa.institution_id = ? AND aa.relationship = 'parent'
           LIMIT 1`
        )
        .get(institutionid) as AffiliationChild | undefined;
    } catch {
      // Table doesn't exist yet
    }

    const response: AffiliationDetails = {
      summary,
      yearlyStats,
      topResearchers,
      topCollaborators,
      childInstitutions,
      parentInstitution,
    };

    return NextResponse.json(response);
  } catch (error) {
    return errorResponse(error, "affiliations/[institutionid]");
  }
}
