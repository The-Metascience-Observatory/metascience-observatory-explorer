import { NextRequest, NextResponse } from "next/server";
import { getOpenaireDb, hasTable } from "@/lib/db";
import { errorResponse } from "@/lib/api-utils";
import type {
  OpenaireLinkedProduct,
  OpenaireProject,
  PaperOpenaireResponse,
} from "@/lib/types";

interface PaperOpenaireRow {
  oa_color: string | null;
  best_access_right: string | null;
  is_green: number | null;
  is_diamond: number | null;
  publicly_funded: number | null;
}

interface ProjectRow {
  openaire_project_id: string;
  code: string | null;
  acronym: string | null;
  title: string | null;
  funder_shortname: string | null;
  funding_stream: string | null;
}

interface LinkedProductRow {
  product_type: string;
  title: string | null;
  doi: string | null;
  relation: string | null;
  year: number | null;
}

const EMPTY: PaperOpenaireResponse = { openaire: null, projects: [], linkedProducts: [] };

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ paperid: string }> }
) {
  const { paperid } = await params;

  try {
    const db = getOpenaireDb();
    if (!db) {
      return NextResponse.json(EMPTY);
    }

    const response: PaperOpenaireResponse = { ...EMPTY };

    if (hasTable(db, "paper_openaire")) {
      const row = db
        .prepare(
          `SELECT oa_color, best_access_right, is_green, is_diamond, publicly_funded
           FROM paper_openaire WHERE paperid = ?`
        )
        .get(paperid) as PaperOpenaireRow | undefined;
      if (row) {
        response.openaire = {
          oaColor: row.oa_color,
          bestAccessRight: row.best_access_right,
          isGreen: row.is_green === null ? null : Boolean(row.is_green),
          isDiamond: row.is_diamond === null ? null : Boolean(row.is_diamond),
          publiclyFunded:
            row.publicly_funded === null ? null : Boolean(row.publicly_funded),
        };
      }
    }

    if (hasTable(db, "paper_projects")) {
      const rows = db
        .prepare(
          `SELECT openaire_project_id, code, acronym, title, funder_shortname, funding_stream
           FROM paper_projects WHERE paperid = ? LIMIT 50`
        )
        .all(paperid) as ProjectRow[];
      response.projects = rows.map(
        (r): OpenaireProject => ({
          openaireProjectId: r.openaire_project_id,
          code: r.code,
          acronym: r.acronym,
          title: r.title,
          funderShortname: r.funder_shortname,
          fundingStream: r.funding_stream,
        })
      );
    }

    if (hasTable(db, "paper_linked_products")) {
      const rows = db
        .prepare(
          `SELECT product_type, title, doi, relation, year
           FROM paper_linked_products WHERE paperid = ? LIMIT 50`
        )
        .all(paperid) as LinkedProductRow[];
      response.linkedProducts = rows.map(
        (r): OpenaireLinkedProduct => ({
          productType: r.product_type,
          title: r.title,
          doi: r.doi,
          relation: r.relation,
          year: r.year,
        })
      );
    }

    return NextResponse.json(response);
  } catch (error) {
    return errorResponse(error, "papers/[paperid]/openaire");
  }
}
