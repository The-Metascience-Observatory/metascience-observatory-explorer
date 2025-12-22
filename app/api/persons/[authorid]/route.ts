import { NextResponse } from "next/server";
import { getDb, isDatabaseAvailable } from "@/lib/db";
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

    // Get yearly statistics
    let yearlyStats: PersonYearlyStats[] = [];
    try {
      yearlyStats = db
        .prepare(
          `SELECT authorid, year, paper_count, total_citations
           FROM person_yearly_stats
           WHERE authorid = ?
           ORDER BY year`
        )
        .all(authorid) as PersonYearlyStats[];
    } catch {
      console.log("person_yearly_stats table not found, skipping");
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
    let trials: PersonTrial[] = [];
    try {
      trials = db
        .prepare(
          `SELECT authorid, nct_id, paper_count
           FROM person_trials
           WHERE authorid = ?
           ORDER BY paper_count DESC
           LIMIT 25`
        )
        .all(authorid) as PersonTrial[];
    } catch {
      console.log("person_trials table not found, skipping");
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
    };

    return NextResponse.json(response);
  } catch (error) {
    return errorResponse(error, "persons/[authorid]");
  }
}
