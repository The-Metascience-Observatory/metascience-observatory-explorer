/**
 * Interleaving two citation streams into one "Cited By" list.
 *
 * Both sources hand us items already ordered by citation count descending —
 * journals.db via `ORDER BY citing_cited_by_count DESC NULLS LAST`, the OpenAIRE
 * edge blobs via a build-time sort (scripts/openaire_pack_citations.py). The two
 * are disjoint by construction (SciSciNet<->SciSciNet edges are dropped at
 * import), so this is a merge, never a union: no dedupe is required, and the
 * `seen` guard below is defence against a repeated page, not overlap.
 */

/** The minimum an item needs for us to place it. */
export interface RankedPaper {
  paperid: string;
  cited_by_count: number | null;
  unresolved?: boolean;
}

/**
 * Per-item sort rank, repaired to be non-increasing.
 *
 * The merge's correctness rests on each input being monotone in the field we
 * rank by, so we enforce that rather than assume it. `cited_by_count` is
 * nullable and the two causes of null want opposite treatment:
 *
 *   - `unresolved` — the edge is real, we just couldn't name the paper. Its
 *     position in the pre-sorted blob is still authoritative, so it inherits the
 *     preceding rank and stays put. (Near-impossible; guards rowid-epoch drift.)
 *   - resolved but null — only when the BIP! impact table is missing, which is
 *     an all-or-nothing property of the whole response: when the table IS there
 *     a missing row is stored as 0, never null. Ranking these last makes the
 *     merge degrade gracefully to "OpenAIRE appended after SciSciNet", matching
 *     the "Citations unknown" those rows already display.
 */
function ranks(items: readonly RankedPaper[]): number[] {
  const out: number[] = new Array(items.length);
  let prev = Number.POSITIVE_INFINITY;
  for (let i = 0; i < items.length; i++) {
    const count = items[i].cited_by_count;
    const raw =
      count === null || count === undefined
        ? items[i].unresolved
          ? prev
          : Number.NEGATIVE_INFINITY
        : count;
    prev = Math.min(raw, prev);
    out[i] = prev;
  }
  return out;
}

/**
 * Lower bound on the ranks of everything a stream has not fetched yet. Pages
 * arrive descending, so nothing later can outrank the last item already held;
 * an empty buffer bounds nothing, so it blocks the other stream entirely.
 */
function boundOf(rs: readonly number[]): number {
  return rs.length ? rs[rs.length - 1] : Number.POSITIVE_INFINITY;
}

/**
 * Merge two citation-count-descending streams, emitting only what no unfetched
 * page could outrank.
 *
 * That restraint is the whole point: the emitted prefix is append-only, so a row
 * already on screen never moves or disappears as more pages load — which is what
 * makes an interleaved list survivable under infinite scroll. The caller just
 * keeps feeding both buffers; there is no ordering state to keep in sync.
 *
 * Ties go to `a` — arbitrary, but stable across re-renders.
 */
export function mergeSortedCitations<T extends RankedPaper>(
  a: readonly T[],
  aDone: boolean,
  b: readonly T[],
  bDone: boolean
): T[] {
  const ra = ranks(a);
  const rb = ranks(b);
  const boundA = boundOf(ra);
  const boundB = boundOf(rb);

  const items: T[] = [];
  const seen = new Set<string>();
  let i = 0;
  let j = 0;

  for (;;) {
    const aAvail = i < a.length;
    const bAvail = j < b.length;
    if (!aAvail && !bAvail) break;

    const takeA = aAvail && (!bAvail || ra[i] >= rb[j]);
    const rank = takeA ? ra[i] : rb[j];

    // A finished stream has nothing left to outrank this with. Otherwise the
    // candidate must strictly beat what the other stream might still deliver —
    // strictly, because a tie would be unresolvable after the fact.
    const otherDone = takeA ? bDone : aDone;
    const otherBound = takeA ? boundB : boundA;
    if (!otherDone && !(rank > otherBound)) break;

    const item = takeA ? a[i++] : b[j++];
    // A duplicated page must never produce duplicate React keys.
    if (seen.has(item.paperid)) continue;
    seen.add(item.paperid);
    items.push(item);
  }

  return items;
}
