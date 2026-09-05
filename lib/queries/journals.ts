import { cache } from "react";
import { getDb, getRetractionsDb } from "@/lib/db";
import { fetchScopusCiteScore } from "@/lib/scopus";
import type {
  JournalDetails,
  JournalSummary,
  JournalYearlyStats,
  JournalField,
  JournalImpactFactor,
  JournalOfficialMetrics,
  JournalRetractionStats,
  HijackedJournalInfo,
  JournalEnrichment,
  PredatoryInfo,
} from "@/lib/types";

/**
 * Read paths for journal_summary and its many satellite tables.
 * See lib/queries/mesh.ts for the contract.
 *
 * NOTE these still use the synchronous getDb() handle rather than the worker
 * pool. Unlike the other entity modules this one fans out across ~8 small
 * indexed lookups plus three optional databases, and moving it wholesale is a
 * larger change than this pass warrants; journal_summary lookups are indexed
 * and fast. Revisit if journal pages show up as a latency outlier.
 */

/** Indexed single-row lookup — safe for generateMetadata. */
export const getJournalSummary = cache(
  async (sourceid: string): Promise<JournalSummary | null> =>
    (getDb()
      .prepare("SELECT * FROM journal_summary WHERE sourceid = ?")
      .get(sourceid) as JournalSummary | undefined) ?? null
);

/**
 * Everything the detail page needs.
 *
 * `includeScopus` is false on the server-render path: fetchScopusCiteScore()
 * makes an external HTTP call on a cache miss, and 260k journal pages must not
 * each be able to block on api.elsevier.com. The API route still passes true.
 */
export const getJournalDetails = cache(
  async (sourceid: string, includeScopus = false): Promise<JournalDetails | null> => {
  const db = getDb();
  try {
  // Get journal summary
  const summary = db
    .prepare(
      `SELECT * FROM journal_summary WHERE sourceid = ?`
    )
    .get(sourceid) as JournalSummary | undefined;

  if (!summary) return null;

  // Get yearly statistics
  const yearlyStats = db
    .prepare(
      `SELECT sourceid, year, paper_count, total_citations
       FROM journal_yearly_stats
       WHERE sourceid = ?
       ORDER BY year`
    )
    .all(sourceid) as JournalYearlyStats[];

  // Get field associations
  let fields: JournalField[] = [];
  try {
    fields = db
      .prepare(
        `SELECT sourceid, fieldid, field_name, level, paper_count, score_sum
         FROM journal_fields
         WHERE sourceid = ?
         ORDER BY paper_count DESC
         LIMIT 20`
      )
      .all(sourceid) as JournalField[];
  } catch {
    // journal_fields table might not exist if --skip-fields was used
    console.log("journal_fields table not found, skipping");
  }

  // Get computed impact factors
  let impactFactors: JournalImpactFactor[] = [];
  try {
    impactFactors = db
      .prepare(
        `SELECT sourceid, year, citations_2yr, papers_2yr, impact_factor_2yr,
                citations_5yr, papers_5yr, impact_factor_5yr,
                citations_citescore, papers_citescore, citescore
         FROM journal_impact_factors
         WHERE sourceid = ?
         ORDER BY year`
      )
      .all(sourceid) as JournalImpactFactor[];
  } catch {
    // journal_impact_factors table might not exist yet
    console.log("journal_impact_factors table not found, skipping");
  }

  // Fetch official CiteScore from Scopus API (if ISSN available)
  let officialMetrics: JournalOfficialMetrics | undefined;
  if (includeScopus && summary.issn) {
    try {
      // Parse ISSN (may be JSON array string)
      const issnList: string[] = summary.issn.startsWith('[')
        ? JSON.parse(summary.issn)
        : [summary.issn];

      for (const issn of issnList) {
        const scopusData = await fetchScopusCiteScore(issn);
        if (scopusData?.citescore) {
          officialMetrics = {
            scopus_citescore: scopusData.citescore,
            scopus_citescore_year: scopusData.citescoreYear,
            scopus_percentile: scopusData.percentile,
            scopus_rank: scopusData.rank,
          };
          break; // Found valid data
        }
      }
    } catch (e) {
      console.error("Error fetching Scopus data:", e);
    }
  }

  // Fetch retraction statistics from Retraction Watch database
  let retractionStats: JournalRetractionStats | undefined;
  const retractionsDb = getRetractionsDb();
  if (retractionsDb) {
    try {
      const statsRow = retractionsDb.prepare(`
        SELECT
          total_retractions,
          total_concerns,
          total_corrections,
          total_reinstatements,
          first_retraction_year,
          last_retraction_year
        FROM journal_retraction_stats
        WHERE sourceid = ?
      `).get(sourceid) as {
        total_retractions: number;
        total_concerns: number;
        total_corrections: number;
        total_reinstatements: number;
        first_retraction_year: number | null;
        last_retraction_year: number | null;
      } | undefined;

      if (statsRow) {
        // Calculate papers since 2010 for rate calculation
        const papersSince2010 = yearlyStats
          .filter(ys => ys.year >= 2010)
          .reduce((sum, ys) => sum + ys.paper_count, 0);

        const retractionRate = papersSince2010 > 0
          ? (statsRow.total_retractions / papersSince2010) * 100
          : null;

        retractionStats = {
          totalRetractions: statsRow.total_retractions,
          totalConcerns: statsRow.total_concerns,
          totalCorrections: statsRow.total_corrections,
          totalReinstatements: statsRow.total_reinstatements,
          retractionRate,
          papersSince2010,
          firstRetractionYear: statsRow.first_retraction_year,
          lastRetractionYear: statsRow.last_retraction_year,
        };
      }
    } catch (e) {
      console.error("Error fetching retraction stats:", e);
    }
  }

  // Get hijacked journal info from Retraction Watch
  let hijackedInfo: HijackedJournalInfo | undefined;
  try {
    const hijackedRow = db.prepare(`
      SELECT hijacked_title, hijacked_url, hijacked_issn,
             original_title, original_issn, original_url
      FROM hijacked_journals
      WHERE sourceid = ?
    `).get(sourceid) as {
      hijacked_title: string;
      hijacked_url: string | null;
      hijacked_issn: string | null;
      original_title: string | null;
      original_issn: string | null;
      original_url: string | null;
    } | undefined;

    if (hijackedRow) {
      hijackedInfo = {
        hijacked_title: hijackedRow.hijacked_title,
        hijacked_url: hijackedRow.hijacked_url,
        hijacked_issn: hijackedRow.hijacked_issn,
        original_title: hijackedRow.original_title,
        original_issn: hijackedRow.original_issn,
        original_url: hijackedRow.original_url,
      };
    }
  } catch {
    // Table may not exist yet
    console.log("hijacked_journals table not found, skipping");
  }

  // Get enrichment data from Scopus/DOAJ
  let enrichment: JournalEnrichment | undefined;
  try {
    const enrichmentRow = db.prepare(`
      SELECT scopus_source_id, publisher_scopus, license_type,
             apc_amount, apc_currency, apc_year, languages,
             is_discontinued, discontinued_for_quality,
             asjc_codes, lcc_codes, subjects_doaj, data_source,
             eissn, coverage, source_type, is_medline, articles_in_press,
             title_history, related_titles, top_level_categories
      FROM journal_enrichment
      WHERE sourceid = ?
    `).get(sourceid) as {
      scopus_source_id: string | null;
      publisher_scopus: string | null;
      license_type: string | null;
      apc_amount: number | null;
      apc_currency: string | null;
      apc_year: number | null;
      languages: string | null;
      is_discontinued: number;
      discontinued_for_quality: number;
      asjc_codes: string | null;
      lcc_codes: string | null;
      subjects_doaj: string | null;
      data_source: string | null;
      eissn: string | null;
      coverage: string | null;
      source_type: string | null;
      is_medline: number;
      articles_in_press: number;
      title_history: string | null;
      related_titles: string | null;
      top_level_categories: string | null;
    } | undefined;

    if (enrichmentRow) {
      enrichment = {
        scopus_source_id: enrichmentRow.scopus_source_id,
        publisher_scopus: enrichmentRow.publisher_scopus,
        license_type: enrichmentRow.license_type,
        apc_amount: enrichmentRow.apc_amount,
        apc_currency: enrichmentRow.apc_currency,
        apc_year: enrichmentRow.apc_year,
        languages: enrichmentRow.languages ? JSON.parse(enrichmentRow.languages) : null,
        is_discontinued: enrichmentRow.is_discontinued === 1,
        discontinued_for_quality: enrichmentRow.discontinued_for_quality === 1,
        asjc_codes: enrichmentRow.asjc_codes ? JSON.parse(enrichmentRow.asjc_codes) : null,
        lcc_codes: enrichmentRow.lcc_codes ? JSON.parse(enrichmentRow.lcc_codes) : null,
        subjects_doaj: enrichmentRow.subjects_doaj,
        data_source: enrichmentRow.data_source as 'scopus' | 'doaj' | 'both' | null,
        // New fields
        eissn: enrichmentRow.eissn,
        coverage: enrichmentRow.coverage,
        source_type: enrichmentRow.source_type,
        is_medline: enrichmentRow.is_medline === 1,
        articles_in_press: enrichmentRow.articles_in_press === 1,
        title_history: enrichmentRow.title_history,
        related_titles: enrichmentRow.related_titles ? JSON.parse(enrichmentRow.related_titles) : null,
        top_level_categories: enrichmentRow.top_level_categories ? JSON.parse(enrichmentRow.top_level_categories) : null,
      };
    }
  } catch {
    // Table may not exist yet
    console.log("journal_enrichment table not found, skipping");
  }

  // Get predatory journal info from Beall's List
  let predatoryInfo: PredatoryInfo | undefined;
  try {
    const predRow = db.prepare(`
      SELECT predatory_source, matched_name, matched_publisher, predatory_url, confidence
      FROM predatory_journals
      WHERE sourceid = ?
    `).get(sourceid) as {
      predatory_source: string;
      matched_name: string;
      matched_publisher: string | null;
      predatory_url: string | null;
      confidence: string;
    } | undefined;

    if (predRow) {
      predatoryInfo = {
        source: predRow.predatory_source,
        name: predRow.matched_name,
        publisher: predRow.matched_publisher,
        url: predRow.predatory_url,
        confidence: predRow.confidence,
      };
    }
  } catch {
    // Table may not exist yet
  }

  const response: JournalDetails = {
    summary,
    yearlyStats,
    fields,
    impactFactors: impactFactors.length > 0 ? impactFactors : undefined,
    officialMetrics,
    retractionStats,
    hijackedInfo,
    enrichment,
    predatoryInfo,
  };

    return response;
  } catch (error) {
    console.error("journals/[sourceid] query failed:", error);
    throw error;
  }
});
