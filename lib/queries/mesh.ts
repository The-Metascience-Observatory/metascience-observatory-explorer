import { cache } from "react";
import { meshWorkerQuery, meshWorkerQueryOne } from "@/lib/worker-pool";
import type {
  MeshDetails,
  MeshRelatedTerm,
  MeshSummary,
  MeshTopJournal,
  MeshYearlyStats,
} from "@/lib/types";

/**
 * Read paths for mesh.db, shared by the API route and the server page.
 *
 * Contract for every function here (and in the sibling modules):
 *   - async, plain arguments, returns a lib/types.ts shape or null
 *   - "not found" is `null`, never a thrown error
 *   - wrapped in React's cache() so generateMetadata, the page body and the
 *     JSON-LD builder share ONE execution per request
 *   - goes through the worker pool, never the synchronous main-thread handle:
 *     mesh.db is 32GB and this now runs during render
 *
 * Server components must call these directly rather than fetching the API
 * route: a self-fetch re-enters middleware, spends the rate-limit budget under
 * the container's own address, and doubles JSON serialisation.
 */

interface SummaryRow {
  mesh_ui: string;
  mesh_name: string;
  total_papers: number;
  total_citations: number;
}

/**
 * The single indexed lookup. Safe to call from generateMetadata — it must stay
 * that way, because generateMetadata blocks the entire first flush.
 */
export const getMeshSummary = cache(
  async (meshUi: string): Promise<MeshSummary | null> => {
    const row = await meshWorkerQueryOne<SummaryRow>(
      `SELECT mesh_ui, mesh_name, total_papers, total_citations
         FROM mesh_summary WHERE mesh_ui = ?`,
      meshUi
    );
    if (!row) return null;

    return {
      meshUi: row.mesh_ui,
      meshName: row.mesh_name,
      totalPapers: row.total_papers,
      totalCitations: row.total_citations,
      scopeNote: await getMeshScopeNote(meshUi),
    };
  }
);

/**
 * The NLM definition of the term. The best descriptive prose in the dataset,
 * so it is what the meta description and JSON-LD use.
 */
export const getMeshScopeNote = cache(
  async (meshUi: string): Promise<string | null> => {
    try {
      const row = await meshWorkerQueryOne<{ scope_note: string }>(
        "SELECT scope_note FROM mesh_scope WHERE mesh_ui = ?",
        meshUi
      );
      return row?.scope_note || null;
    } catch {
      // mesh_scope is an optional table in older snapshots.
      return null;
    }
  }
);

export const getMeshYearlyStats = cache(
  async (meshUi: string): Promise<MeshYearlyStats[]> =>
    meshWorkerQuery<MeshYearlyStats>(
      `SELECT year, paper_count FROM mesh_yearly_stats
        WHERE mesh_ui = ? ORDER BY year`,
      meshUi
    )
);

export const getMeshTopJournals = cache(
  async (meshUi: string): Promise<MeshTopJournal[]> => {
    const rows = await meshWorkerQuery<{
      sourceid: string;
      source_name: string;
      paper_count: number;
    }>(
      `SELECT sourceid, source_name, paper_count FROM mesh_top_journals
        WHERE mesh_ui = ? ORDER BY paper_count DESC`,
      meshUi
    );
    return rows.map((r) => ({
      sourceid: r.sourceid,
      sourceName: r.source_name,
      paperCount: r.paper_count,
    }));
  }
);

/** Tree numbers plus the broader/narrower terms derived from them. */
export const getMeshHierarchy = cache(
  async (
    meshUi: string
  ): Promise<{
    treeNumbers: string[];
    parentTerms: MeshRelatedTerm[];
    childTerms: MeshRelatedTerm[];
  }> => {
    const empty = { treeNumbers: [], parentTerms: [], childTerms: [] };

    try {
      const treeRows = await meshWorkerQuery<{ tree_number: string }>(
        "SELECT tree_number FROM mesh_tree WHERE mesh_ui = ?",
        meshUi
      );
      const treeNumbers = treeRows.map((r) => r.tree_number);
      if (treeNumbers.length === 0) return empty;

      // A broader term is this term's tree number minus its last segment.
      const parentTreeNumbers = treeNumbers
        .map((tn) => {
          const parts = tn.split(".");
          return parts.length > 1 ? parts.slice(0, -1).join(".") : null;
        })
        .filter((tn): tn is string => tn !== null);

      const [parentRows, childRows] = await Promise.all([
        parentTreeNumbers.length > 0
          ? meshWorkerQuery<{ mesh_ui: string; mesh_name: string }>(
              `SELECT DISTINCT t.mesh_ui, COALESCE(s.mesh_name, m.mesh_name) as mesh_name
                 FROM mesh_tree t
                 LEFT JOIN mesh_summary s ON t.mesh_ui = s.mesh_ui
                 LEFT JOIN mesh_terms m ON t.mesh_ui = m.mesh_ui
                WHERE t.tree_number IN (${parentTreeNumbers.map(() => "?").join(",")})
                ORDER BY mesh_name`,
              ...parentTreeNumbers
            )
          : Promise.resolve([]),
        // Direct children only: one segment deeper, no grandchildren.
        meshWorkerQuery<{ mesh_ui: string; mesh_name: string }>(
          `SELECT DISTINCT t.mesh_ui, COALESCE(s.mesh_name, m.mesh_name) as mesh_name
             FROM mesh_tree t
             LEFT JOIN mesh_summary s ON t.mesh_ui = s.mesh_ui
             LEFT JOIN mesh_terms m ON t.mesh_ui = m.mesh_ui
            WHERE t.tree_number LIKE ? || '.%'
              AND t.tree_number NOT LIKE ? || '.%.%'
            ORDER BY mesh_name
            LIMIT 50`,
          treeNumbers[0],
          treeNumbers[0]
        ),
      ]);

      const toTerm = (r: { mesh_ui: string; mesh_name: string }): MeshRelatedTerm => ({
        meshUi: r.mesh_ui,
        meshName: r.mesh_name,
      });

      return {
        treeNumbers,
        parentTerms: parentRows.map(toTerm),
        childTerms: childRows.map(toTerm),
      };
    } catch {
      // mesh_tree / mesh_terms are optional in older snapshots.
      return empty;
    }
  }
);

/** Everything the detail page and the API route need. */
export const getMeshDetails = cache(
  async (meshUi: string): Promise<MeshDetails | null> => {
    const summary = await getMeshSummary(meshUi);
    if (!summary) return null;

    const [hierarchy, yearlyStats, topJournals] = await Promise.all([
      getMeshHierarchy(meshUi),
      getMeshYearlyStats(meshUi),
      getMeshTopJournals(meshUi),
    ]);

    return {
      summary,
      treeNumbers: hierarchy.treeNumbers,
      parentTerms: hierarchy.parentTerms,
      childTerms: hierarchy.childTerms,
      yearlyStats,
      topJournals,
    };
  }
);
