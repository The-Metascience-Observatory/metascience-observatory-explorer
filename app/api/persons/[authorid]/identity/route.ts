import { NextRequest, NextResponse } from "next/server";
import { identityWorkerQuery, identityWorkerQueryOne } from "@/lib/worker-pool";
import { errorResponse } from "@/lib/api-utils";
import type {
  AuthorCareer,
  AuthorIdentity,
  AuthorAffiliationRecord,
  AuthorEducationRecord,
} from "@/lib/types";

interface IdentityRow {
  orcid: string;
  phd_year: number | null;
  first_employment_year: number | null;
  n_employments: number;
  n_orgs: number;
  n_countries: number;
}

interface AffiliationRow {
  org_name: string | null;
  ror: string | null;
  country: string | null;
  role_title: string | null;
  start_year: number | null;
  end_year: number | null;
}

interface EducationRow extends AffiliationRow {
  is_doctorate: number;
}

const EMPTY: AuthorCareer = { identity: null, employment: [], education: [] };

// A career history is a handful of rows; cap defensively so a pathological
// ORCID record can't return thousands.
const LIMIT = 100;

function toRecord(r: AffiliationRow): AuthorAffiliationRecord {
  return {
    orgName: r.org_name,
    ror: r.ror,
    country: r.country,
    roleTitle: r.role_title,
    startYear: r.start_year,
    endYear: r.end_year,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ authorid: string }> }
) {
  const { authorid } = await params;

  try {
    // identity.db is optional: a missing file makes every query return empty,
    // so the panel simply never renders. Same contract as mesh/retractions.
    const identity = await identityWorkerQueryOne<IdentityRow>(
      `SELECT orcid, phd_year, first_employment_year, n_employments, n_orgs, n_countries
       FROM author_identity WHERE authorid = ?`,
      authorid
    );

    if (!identity) {
      return NextResponse.json(EMPTY);
    }

    const [employment, education] = await Promise.all([
      identityWorkerQuery<AffiliationRow>(
        `SELECT org_name, ror, country, role_title, start_year, end_year
         FROM author_employment WHERE authorid = ? ORDER BY rank LIMIT ${LIMIT}`,
        authorid
      ),
      identityWorkerQuery<EducationRow>(
        `SELECT org_name, ror, country, role_title, start_year, end_year, is_doctorate
         FROM author_education WHERE authorid = ? ORDER BY rank LIMIT ${LIMIT}`,
        authorid
      ),
    ]);

    const payload: AuthorCareer = {
      identity: {
        orcid: identity.orcid,
        phdYear: identity.phd_year,
        firstEmploymentYear: identity.first_employment_year,
        nEmployments: identity.n_employments,
        nOrgs: identity.n_orgs,
        nCountries: identity.n_countries,
      } satisfies AuthorIdentity,
      employment: employment.map(toRecord),
      education: education.map(
        (r): AuthorEducationRecord => ({
          ...toRecord(r),
          isDoctorate: Boolean(r.is_doctorate),
        })
      ),
    };

    return NextResponse.json(payload);
  } catch (error) {
    return errorResponse(error, "persons/[authorid]/identity");
  }
}
