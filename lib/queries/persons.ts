import { cache } from "react";
import { getRetractionsDb } from "@/lib/db";
import { workerQuery, workerQueryOne } from "@/lib/worker-pool";
import type {
  PersonDetails,
  PersonPublication,
  PersonRetractionStats,
  PersonSummary,
  PersonTrial,
  PersonYearlyStats,
  PersonAffiliation,
  PersonFunding,
  PersonSelfCitations,
  PersonTweet,
  PersonTwitter,
} from "@/lib/types";

/**
 * Read paths for person_summary and its satellites.
 * See lib/queries/mesh.ts for the contract.
 *
 * Every journals.db read goes through the worker pool so a crawl of person
 * pages cannot block the main thread (see the note in lib/queries/papers.ts).
 * Only the small retractions.db lookup stays synchronous.
 */

/** Indexed single-row lookup — safe for generateMetadata. */
export const getPersonSummary = cache(
  async (authorid: string): Promise<PersonSummary | null> =>
    (await workerQueryOne<PersonSummary>(
      "SELECT * FROM person_summary WHERE authorid = ?",
      authorid
    )) ?? null
);

export const getPersonDetails = cache(
  async (authorid: string): Promise<PersonDetails | null> => {
  try {
  const summary = await workerQueryOne<PersonSummary>(
    `SELECT * FROM person_summary WHERE authorid = ?`,
    authorid
  );

  if (!summary) return null;

  // Get yearly statistics - calculate from person_publications to avoid duplicates
  // The person_yearly_stats table may have incorrect counts due to duplicates in source data
  let yearlyStats: PersonYearlyStats[] = [];
  try {
    yearlyStats = await workerQuery<PersonYearlyStats>(
      `SELECT
         ? as authorid,
         year,
         COUNT(DISTINCT paperid) as paper_count,
         COALESCE(SUM(cited_by_count), 0) as total_citations
       FROM (
         SELECT DISTINCT paperid, year, cited_by_count
         FROM person_publications
         WHERE authorid = ?
       )
       GROUP BY year
       ORDER BY year`,
      authorid,
      authorid
    );
  } catch {
    console.log("person_publications table not found for yearly stats, skipping");
  }

  // Get affiliations - filter to 2+ papers and exclude null/blank institutions
  let affiliations: PersonAffiliation[] = [];
  try {
    affiliations = await workerQuery<PersonAffiliation>(
      `SELECT authorid, institutionid, institution_name, country_code,
              paper_count, first_year, last_year
       FROM person_affiliations
       WHERE authorid = ?
         AND institutionid IS NOT NULL
         AND institution_name IS NOT NULL
         AND institution_name != ''
         AND paper_count >= 2
       ORDER BY paper_count DESC
       LIMIT 10`,
      authorid
    );
  } catch {
    console.log("person_affiliations table not found, skipping");
  }

  // Get funding
  let funding: PersonFunding[] = [];
  try {
    funding = await workerQuery<PersonFunding>(
      `SELECT authorid, funder_name, award_id, paper_count
       FROM person_funding
       WHERE authorid = ?
       ORDER BY paper_count DESC`,
      authorid
    );
  } catch {
    console.log("person_funding table not found, skipping");
  }

  // Get twitter info
  let twitter: PersonTwitter | null = null;
  try {
    twitter =
      (await workerQueryOne<PersonTwitter>(
        `SELECT authorid, tweet_count, first_tweet_date, last_tweet_date
         FROM person_twitter
         WHERE authorid = ?`,
        authorid
      )) ?? null;
  } catch {
    console.log("person_twitter table not found, skipping");
  }

  // Get individual tweets (25 most recent)
  let tweets: PersonTweet[] = [];
  try {
    tweets = await workerQuery<PersonTweet>(
      `SELECT tweet_id, occurred_time, original_tweet_url, doi
       FROM person_tweets
       WHERE authorid = ?
       ORDER BY occurred_time DESC
       LIMIT 25`,
      authorid
    );
  } catch {
    console.log("person_tweets table not found, skipping");
  }

  // Get recent publications (limit to 50 most cited)
  // Use DISTINCT because person_publications may have duplicates from multiple affiliations per paper
  let recentPublications: PersonPublication[] = [];
  try {
    recentPublications = await workerQuery<PersonPublication>(
      `SELECT DISTINCT paperid, title, year, cited_by_count, author_position,
              sourceid, source_name
       FROM person_publications
       WHERE authorid = ?
       ORDER BY cited_by_count DESC NULLS LAST
       LIMIT 50`,
      authorid
    );
  } catch {
    console.log("person_publications table not found, skipping");
  }

  // Get clinical trials associated with this person (via their papers)
  // Join with ctg_studies to get trial title, sponsor, and status
  let trials: PersonTrial[] = [];
  try {
    trials = await workerQuery<PersonTrial>(
      `SELECT pt.authorid, pt.nct_id, pt.paper_count,
              ctg.title, ctg.sponsor, ctg.status
       FROM person_trials pt
       LEFT JOIN ctg_studies ctg ON pt.nct_id = ctg.nct_id
       WHERE pt.authorid = ?
       ORDER BY pt.paper_count DESC
       LIMIT 50`,
      authorid
    );
  } catch {
    console.log("person_trials table not found, skipping");
  }

  // Get retraction statistics from Retraction Watch database
  let retractionStats: PersonRetractionStats | undefined;
  const retractionsDb = getRetractionsDb();
  if (retractionsDb) {
    try {
      const statsRow = retractionsDb.prepare(`
        SELECT
          total_retractions,
          total_concerns,
          total_corrections,
          total_reinstatements
        FROM author_retraction_stats
        WHERE authorid = ?
      `).get(authorid) as {
        total_retractions: number;
        total_concerns: number;
        total_corrections: number;
        total_reinstatements: number;
      } | undefined;

      if (statsRow) {
        retractionStats = {
          totalRetractions: statsRow.total_retractions,
          totalConcerns: statsRow.total_concerns,
          totalCorrections: statsRow.total_corrections,
          totalReinstatements: statsRow.total_reinstatements,
        };
      }
    } catch (e) {
      console.error("Error fetching author retraction stats:", e);
    }
  }

  // Get self-citation statistics
  let selfCitations: PersonSelfCitations | undefined;
  try {
    const selfCitationRow = await workerQueryOne<{
      self_citation_count: number;
      total_citation_count: number;
      self_citation_rate: number | null;
    }>(
      `SELECT
         self_citation_count,
         total_citation_count,
         self_citation_rate
       FROM person_self_citations
       WHERE authorid = ?`,
      authorid
    );

    if (selfCitationRow) {
      selfCitations = {
        self_citation_count: selfCitationRow.self_citation_count,
        total_citation_count: selfCitationRow.total_citation_count,
        self_citation_rate: selfCitationRow.self_citation_rate,
      };
    }
  } catch {
    console.log("person_self_citations table not found or query failed, skipping");
  }

  const response: PersonDetails = {
    summary,
    yearlyStats,
    affiliations,
    funding,
    twitter,
    tweets,
    recentPublications,
    trials,
    retractionStats,
    selfCitations,
  };

    return response;
  } catch (error) {
    console.error("persons/[authorid] query failed:", error);
    throw error;
  }
});
