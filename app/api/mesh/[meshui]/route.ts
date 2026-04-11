import { NextRequest, NextResponse } from "next/server";
import { getMeshDb } from "@/lib/db";
import { errorResponse } from "@/lib/api-utils";

interface SummaryRow {
  mesh_ui: string;
  mesh_name: string;
  total_papers: number;
  total_citations: number;
}

interface YearlyRow {
  year: number;
  paper_count: number;
}

interface JournalRow {
  sourceid: string;
  source_name: string;
  paper_count: number;
}

interface ScopeRow {
  scope_note: string;
}

interface TreeRow {
  tree_number: string;
}

interface RelatedTermRow {
  mesh_ui: string;
  mesh_name: string;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ meshui: string }> }
) {
  const { meshui } = await params;

  try {
    const db = getMeshDb();

    if (!db) {
      return NextResponse.json({ error: "MeSH database not available" }, { status: 503 });
    }

    // Get summary
    const summary = db
      .prepare("SELECT mesh_ui, mesh_name, total_papers, total_citations FROM mesh_summary WHERE mesh_ui = ?")
      .get(meshui) as SummaryRow | undefined;

    if (!summary) {
      return NextResponse.json({ error: "MeSH term not found" }, { status: 404 });
    }

    // Get yearly stats
    const yearlyStats = db
      .prepare("SELECT year, paper_count FROM mesh_yearly_stats WHERE mesh_ui = ? ORDER BY year")
      .all(meshui) as YearlyRow[];

    // Get top journals
    const topJournals = db
      .prepare("SELECT sourceid, source_name, paper_count FROM mesh_top_journals WHERE mesh_ui = ? ORDER BY paper_count DESC")
      .all(meshui) as JournalRow[];

    // Get scope note
    let scopeNote: string | null = null;
    try {
      const scopeRow = db
        .prepare("SELECT scope_note FROM mesh_scope WHERE mesh_ui = ?")
        .get(meshui) as ScopeRow | undefined;
      scopeNote = scopeRow?.scope_note || null;
    } catch {
      // Table may not exist yet
    }

    // Get tree numbers for this term
    let treeNumbers: string[] = [];
    let parentTerms: { meshUi: string; meshName: string }[] = [];
    let childTerms: { meshUi: string; meshName: string }[] = [];

    try {
      const treeRows = db
        .prepare("SELECT tree_number FROM mesh_tree WHERE mesh_ui = ?")
        .all(meshui) as TreeRow[];
      treeNumbers = treeRows.map((r) => r.tree_number);

      if (treeNumbers.length > 0) {
        // Get parent terms (by stripping last segment from tree numbers)
        const parentTreeNumbers = treeNumbers
          .map((tn) => {
            const parts = tn.split(".");
            return parts.length > 1 ? parts.slice(0, -1).join(".") : null;
          })
          .filter((tn): tn is string => tn !== null);

        if (parentTreeNumbers.length > 0) {
          const parentPlaceholders = parentTreeNumbers.map(() => "?").join(",");
          const parentRows = db
            .prepare(
              `SELECT DISTINCT t.mesh_ui, COALESCE(s.mesh_name, m.mesh_name) as mesh_name
               FROM mesh_tree t
               LEFT JOIN mesh_summary s ON t.mesh_ui = s.mesh_ui
               LEFT JOIN mesh_terms m ON t.mesh_ui = m.mesh_ui
               WHERE t.tree_number IN (${parentPlaceholders})
               ORDER BY mesh_name`
            )
            .all(...parentTreeNumbers) as RelatedTermRow[];
          parentTerms = parentRows.map((r) => ({ meshUi: r.mesh_ui, meshName: r.mesh_name }));
        }

        // Get child terms (tree numbers that start with this term's tree number + ".")
        // Use first tree number for simplicity (could expand to all)
        const childRows = db
          .prepare(
            `SELECT DISTINCT t.mesh_ui, COALESCE(s.mesh_name, m.mesh_name) as mesh_name
             FROM mesh_tree t
             LEFT JOIN mesh_summary s ON t.mesh_ui = s.mesh_ui
             LEFT JOIN mesh_terms m ON t.mesh_ui = m.mesh_ui
             WHERE t.tree_number LIKE ? || '.%'
               AND t.tree_number NOT LIKE ? || '.%.%'
             ORDER BY mesh_name
             LIMIT 50`
          )
          .all(treeNumbers[0], treeNumbers[0]) as RelatedTermRow[];
        childTerms = childRows.map((r) => ({ meshUi: r.mesh_ui, meshName: r.mesh_name }));
      }
    } catch {
      // Tables may not exist yet
    }

    return NextResponse.json({
      summary: {
        meshUi: summary.mesh_ui,
        meshName: summary.mesh_name,
        totalPapers: summary.total_papers,
        totalCitations: summary.total_citations,
        scopeNote,
      },
      treeNumbers,
      parentTerms,
      childTerms,
      yearlyStats: yearlyStats.map((row) => ({
        year: row.year,
        paper_count: row.paper_count,
      })),
      topJournals: topJournals.map((row) => ({
        sourceid: row.sourceid,
        sourceName: row.source_name,
        paperCount: row.paper_count,
      })),
    });
  } catch (error) {
    return errorResponse(error, "mesh/[meshui]");
  }
}
