import { NextRequest, NextResponse } from "next/server";
import { meshWorkerQueryOne, pubmedWorkerQuery } from "@/lib/worker-pool";
import { errorResponse } from "@/lib/api-utils";

interface PmidRow { pmid: number }
interface TypeRow { type_ui: string; type_name: string }
interface GrantRow { grant_id: string | null; agency: string | null; country: string | null }
interface DatabankRow { databank: string; accession: string }

const EMPTY = { publicationTypes: [], grants: [], databanks: [] };

// Publication types that describe HOW the study was done. The raw list is dominated
// by cataloguing and funding flags -- "Research Support, Non-U.S. Gov't" alone is 16%
// of articles -- which are not study designs and must not be presented as such.
const DESIGN_TYPES = new Set([
  "Randomized Controlled Trial",
  "Systematic Review",
  "Meta-Analysis",
  "Clinical Trial",
  "Observational Study",
  "Comparative Study",
  "Case Reports",
  "Review",
]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ paperid: string }> }
) {
  const { paperid } = await params;

  try {
    // paperid -> pmid lives in mesh.db (31.2M rows). papers_extra has the same
    // mapping but only 6.3M rows, so it is deliberately not used here.
    const row = await meshWorkerQueryOne<PmidRow>(
      "SELECT pmid FROM paperid_pmid WHERE paperid = ? LIMIT 1",
      paperid
    );
    if (!row?.pmid) return NextResponse.json(EMPTY);

    const [types, grants, databanks] = await Promise.all([
      pubmedWorkerQuery<TypeRow>(
        `SELECT p.type_ui, t.type_name
         FROM paper_pubtypes p JOIN pubtype_terms t USING(type_ui)
         WHERE p.pmid = ? ORDER BY t.type_name LIMIT 40`,
        row.pmid
      ),
      pubmedWorkerQuery<GrantRow>(
        `SELECT grant_id, agency, country FROM paper_grants
         WHERE pmid = ? ORDER BY rank LIMIT 40`,
        row.pmid
      ),
      pubmedWorkerQuery<DatabankRow>(
        `SELECT databank, accession FROM paper_databanks
         WHERE pmid = ? ORDER BY rank LIMIT 40`,
        row.pmid
      ),
    ]);

    return NextResponse.json({
      pmid: row.pmid,
      // Split rather than filtered: the caller gets designs for badges and keeps the
      // rest (funding/indexing flags) available without conflating the two.
      publicationTypes: types
        .filter((t) => DESIGN_TYPES.has(t.type_name))
        .map((t) => ({ ui: t.type_ui, name: t.type_name })),
      otherTypes: types
        .filter((t) => !DESIGN_TYPES.has(t.type_name))
        .map((t) => ({ ui: t.type_ui, name: t.type_name })),
      grants: grants.map((g) => ({
        grantId: g.grant_id,
        agency: g.agency,
        country: g.country,
      })),
      databanks: databanks.map((d) => ({ databank: d.databank, accession: d.accession })),
    });
  } catch (error) {
    return errorResponse(error, "papers/[paperid]/pubmed");
  }
}
