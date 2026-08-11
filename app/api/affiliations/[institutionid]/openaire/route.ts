import { NextRequest, NextResponse } from "next/server";
import { getOpenaireDb } from "@/lib/db";
import { errorResponse } from "@/lib/api-utils";
import type { OpenaireOrgInfo, OpenaireProject } from "@/lib/types";

interface OrgRow {
  openaire_org_id: string;
  legal_name: string | null;
  country_code: string | null;
  project_count: number;
}

interface OrgProjectRow {
  openaire_project_id: string;
  code: string | null;
  acronym: string | null;
  title: string | null;
  funder_shortname: string | null;
  funding_stream: string | null;
  start_date: string | null;
  end_date: string | null;
  funded_amount: number | null;
  currency: string | null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ institutionid: string }> }
) {
  const { institutionid } = await params;

  try {
    const db = getOpenaireDb();
    if (!db) {
      return NextResponse.json({ org: null });
    }

    const orgRow = db
      .prepare(
        `SELECT openaire_org_id, legal_name, country_code, project_count
         FROM org_openaire WHERE institution_id = ?`
      )
      .get(institutionid) as OrgRow | undefined;

    if (!orgRow) {
      return NextResponse.json({ org: null });
    }

    const projectRows = db
      .prepare(
        `SELECT p.openaire_project_id, p.code, p.acronym, p.title,
                p.funder_shortname, p.funding_stream, p.start_date, p.end_date,
                p.funded_amount, p.currency
         FROM org_projects op
         JOIN projects p ON p.openaire_project_id = op.openaire_project_id
         WHERE op.institution_id = ?
         ORDER BY (p.funded_amount IS NULL OR p.funded_amount = 0), p.funded_amount DESC,
                  p.start_date DESC
         LIMIT 25`
      )
      .all(institutionid) as OrgProjectRow[];

    const org: OpenaireOrgInfo = {
      openaireOrgId: orgRow.openaire_org_id,
      legalName: orgRow.legal_name,
      countryCode: orgRow.country_code,
      projectCount: orgRow.project_count,
      projects: projectRows.map(
        (r): OpenaireProject => ({
          openaireProjectId: r.openaire_project_id,
          code: r.code,
          acronym: r.acronym,
          title: r.title,
          funderShortname: r.funder_shortname,
          fundingStream: r.funding_stream,
          startDate: r.start_date,
          endDate: r.end_date,
          fundedAmount: r.funded_amount,
          currency: r.currency,
        })
      ),
    };

    return NextResponse.json({ org });
  } catch (error) {
    return errorResponse(error, "affiliations/[institutionid]/openaire");
  }
}
