import { NextResponse } from "next/server";
import { getDb, isDatabaseAvailable, getRetractionsDb } from "@/lib/db";
import { errorResponse } from "@/lib/api-utils";
import type {
  PersonSummary,
  PersonYearlyStats,
  PersonAffiliation,
  PersonFunding,
  PersonTwitter,
  PersonTweet,
  PersonPublication,
  PersonDetails,
  PersonTrial,
  PersonRetractionStats,
} from "@/lib/types";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ authorid: string }> }
) {
  try {
    const { authorid } = await params;

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

    // Get person summary
    const summary = db
      .prepare(`SELECT * FROM person_summary WHERE authorid = ?`)
      .get(authorid) as PersonSummary | undefined;

    if (!summary) {
      return NextResponse.json(
        { error: "Person not found" },
        { status: 404 }
      );
    }

    // Get yearly statistics - calculate from person_publications to avoid duplicates
    // The person_yearly_stats table may have incorrect counts due to duplicates in source data
    let yearlyStats: PersonYearlyStats[] = [];
    try {
      yearlyStats = db
        .prepare(
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
           ORDER BY year`
        )
        .all(authorid, authorid) as PersonYearlyStats[];
    } catch {
      console.log("person_publications table not found for yearly stats, skipping");
    }

    // Get affiliations - filter to 2+ papers and exclude null/blank institutions
    let affiliations: PersonAffiliation[] = [];
    try {
      affiliations = db
        .prepare(
          `SELECT authorid, institutionid, institution_name, country_code,
                  paper_count, first_year, last_year
           FROM person_affiliations
           WHERE authorid = ?
             AND institutionid IS NOT NULL
             AND institution_name IS NOT NULL
             AND institution_name != ''
             AND paper_count >= 2
           ORDER BY paper_count DESC
           LIMIT 10`
        )
        .all(authorid) as PersonAffiliation[];
    } catch {
      console.log("person_affiliations table not found, skipping");
    }

    // Get funding
    let funding: PersonFunding[] = [];
    try {
      funding = db
        .prepare(
          `SELECT authorid, funder_name, award_id, paper_count
           FROM person_funding
           WHERE authorid = ?
           ORDER BY paper_count DESC`
        )
        .all(authorid) as PersonFunding[];
    } catch {
      console.log("person_funding table not found, skipping");
    }

    // Get twitter info
    let twitter: PersonTwitter | null = null;
    try {
      twitter = db
        .prepare(
          `SELECT authorid, tweet_count, first_tweet_date, last_tweet_date
           FROM person_twitter
           WHERE authorid = ?`
        )
        .get(authorid) as PersonTwitter | undefined ?? null;
    } catch {
      console.log("person_twitter table not found, skipping");
    }

    // Get individual tweets (25 most recent)
    let tweets: PersonTweet[] = [];
    try {
      tweets = db
        .prepare(
          `SELECT tweet_id, occurred_time, original_tweet_url, doi
           FROM person_tweets
           WHERE authorid = ?
           ORDER BY occurred_time DESC
           LIMIT 25`
        )
        .all(authorid) as PersonTweet[];
    } catch {
      console.log("person_tweets table not found, skipping");
    }

    // Get recent publications (limit to 50 most cited)
    // Use DISTINCT because person_publications may have duplicates from multiple affiliations per paper
    let recentPublications: PersonPublication[] = [];
    try {
      recentPublications = db
        .prepare(
          `SELECT DISTINCT paperid, title, year, cited_by_count, author_position,
                  sourceid, source_name
           FROM person_publications
           WHERE authorid = ?
           ORDER BY cited_by_count DESC NULLS LAST
           LIMIT 50`
        )
        .all(authorid) as PersonPublication[];
    } catch {
      console.log("person_publications table not found, skipping");
    }

    // Get clinical trials associated with this person (via their papers)
    // Join with ctg_studies to get trial title, sponsor, and status
    let trials: PersonTrial[] = [];
    try {
      trials = db
        .prepare(
          `SELECT pt.authorid, pt.nct_id, pt.paper_count,
                  ctg.title, ctg.sponsor, ctg.status
           FROM person_trials pt
           LEFT JOIN ctg_studies ctg ON pt.nct_id = ctg.nct_id
           WHERE pt.authorid = ?
           ORDER BY pt.paper_count DESC
           LIMIT 50`
        )
        .all(authorid) as PersonTrial[];
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
    };

    return NextResponse.json(response);
  } catch (error) {
    return errorResponse(error, "persons/[authorid]");
  }
}
