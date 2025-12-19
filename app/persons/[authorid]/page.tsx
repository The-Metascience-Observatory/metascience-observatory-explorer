"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PublicationsChart } from "@/components/PublicationsChart";
import { CitationsChart } from "@/components/CitationsChart";
import type { PersonDetails } from "@/lib/types";
import { formatNumber } from "@/lib/utils";
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  Building2,
  Twitter,
  Award,
  BookOpen,
  Globe,
  ChevronDown,
  ChevronRight,
  ArrowUpDown,
  FlaskConical,
  GraduationCap,
  Briefcase,
} from "lucide-react";
import type { PersonFunding, PersonAffiliation, OrcidData } from "@/lib/types";

// Check if an institution is likely a university (vs lab/institute)
function isUniversity(name: string | null): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return lower.includes('university') ||
         lower.includes('college') ||
         lower.includes('école') ||
         lower.includes('universität') ||
         lower.includes('università') ||
         lower.includes('universidad') ||
         lower.includes('universidade') ||
         lower.includes('universiteit');
}

// Check if an affiliation is dominated by another (likely noise from co-author)
function isDominatedAffiliation(
  candidate: PersonAffiliation,
  dominant: PersonAffiliation,
  stricterForUniversities: boolean
): boolean {
  const candStart = candidate.first_year || 1900;
  const candEnd = candidate.last_year || 2100;
  const domStart = dominant.first_year || 1900;
  const domEnd = dominant.last_year || 2100;

  const overlapStart = Math.max(candStart, domStart);
  const overlapEnd = Math.min(candEnd, domEnd);

  if (overlapStart > overlapEnd) {
    // No overlap - not dominated
    return false;
  }

  const candYears = candEnd - candStart + 1;
  const overlapYears = overlapEnd - overlapStart + 1;
  const overlapRatio = overlapYears / candYears;

  // Stricter thresholds for universities (people rarely have concurrent university positions)
  // Looser thresholds for labs/institutes (collaborations are common)
  if (stricterForUniversities) {
    // University: dominated if 50%+ overlap AND 3x fewer papers
    return overlapRatio >= 0.5 && dominant.paper_count >= candidate.paper_count * 3;
  } else {
    // Non-university: dominated if 80%+ overlap AND 5x fewer papers AND candidate has few papers
    // This catches spurious affiliations from occasional co-authorship
    return overlapRatio >= 0.8 &&
           dominant.paper_count >= candidate.paper_count * 5 &&
           candidate.paper_count <= 5;
  }
}

// Filter affiliations to remove unlikely concurrent positions (co-author noise)
// Logic:
// - A researcher typically has one primary university at a time
// - Weak affiliations (few papers, short duration) during a dominant affiliation are likely noise
// - Labs/institutes are filtered less aggressively since collaborations are common
function filterAffiliations(affiliations: PersonAffiliation[]): PersonAffiliation[] {
  if (affiliations.length <= 1) return affiliations;

  // Sort all affiliations by paper count (descending) - strongest first
  const sorted = [...affiliations].sort((a, b) => b.paper_count - a.paper_count);
  const kept: PersonAffiliation[] = [];

  for (const aff of sorted) {
    const isUni = isUniversity(aff.institution_name);
    let dominated = false;

    for (const keptAff of kept) {
      // Only filter universities against universities
      // But filter all affiliations against the dominant one (first kept)
      const bothUniversities = isUni && isUniversity(keptAff.institution_name);

      if (bothUniversities) {
        // Stricter filtering between universities
        if (isDominatedAffiliation(aff, keptAff, true)) {
          dominated = true;
          break;
        }
      } else if (kept.length > 0 && keptAff === kept[0]) {
        // Check if this affiliation is dominated by the primary (strongest) affiliation
        // This catches spurious weak affiliations regardless of type
        if (isDominatedAffiliation(aff, keptAff, false)) {
          dominated = true;
          break;
        }
      }
    }

    if (!dominated) {
      kept.push(aff);
    }
  }

  return kept;
}

interface GrantDetails {
  award_id: string;
  funder: string;
  title: string | null;
  amount: number | null;
  start_date: string | null;
  end_date: string | null;
  pi_name: string | null;
  organization: string | null;
  url: string | null;
}

interface TweetEmbed {
  html: string | null;
  author_name: string | null;
}

interface FunderGroup {
  funderName: string;
  funderKey: string;
  grants: PersonFunding[];
  totalPapers: number;
}

// NIH Grant Activity Code descriptions
const NIH_ACTIVITY_CODES: Record<string, string> = {
  // R — Research Project Grants
  "R01": "Research project grant",
  "R03": "Small research grant",
  "R15": "Academic Research Enhancement Award",
  "R21": "Exploratory/developmental grant",
  "R22": "Phased innovation grant",
  "R24": "Resource-related research project",
  "R25": "Education project grant",
  "R29": "FIRST Award (early-career)",
  "R33": "Exploratory phase II grant",
  "R34": "Clinical trial planning grant",
  "R35": "Outstanding Investigator Award",
  "R36": "Dissertation research grant",
  "R37": "MERIT Award",
  "R38": "StARR residency research",
  "R41": "STTR Phase I",
  "R42": "STTR Phase II",
  "R43": "SBIR Phase I",
  "R44": "SBIR Phase II",
  "R56": "High priority short-term award",
  "R61": "Exploratory clinical trial",
  "R00": "Pathway to Independence (independent phase)",
  // K — Career Development Awards
  "K01": "Mentored research scientist award",
  "K02": "Independent scientist award",
  "K05": "Senior scientist award",
  "K07": "Academic career award",
  "K08": "Mentored clinical scientist award",
  "K12": "Institutional career development",
  "K18": "Career enhancement award",
  "K22": "Career transition award",
  "K23": "Mentored patient-oriented research",
  "K24": "Midcareer investigator award",
  "K25": "Mentored quantitative research",
  "K26": "Midcareer quantitative research",
  "K99": "Pathway to Independence (mentored phase)",
  // P — Program Project / Center Grants
  "P01": "Program project grant",
  "P20": "Exploratory center planning grant",
  "P30": "Center core grant",
  "P40": "Animal/biological resource center",
  "P41": "Biomedical technology resource",
  "P50": "Specialized center grant",
  "P51": "Primate research center",
  "P60": "Comprehensive center grant",
  "P17": "Research program grant",
  "P42": "Superfund research center",
  // U — Cooperative Agreements
  "U01": "Cooperative agreement",
  "U10": "Cooperative clinical research",
  "U13": "Conference cooperative agreement",
  "U19": "Multi-project cooperative agreement",
  "U24": "Resource cooperative agreement",
  "U41": "Informatics resource cooperative",
  "U42": "SBIR/STTR cooperative",
  "U54": "Specialized center cooperative",
  "U56": "Exploratory cooperative agreement",
  "UM1": "Multi-component clinical trial",
  "UG1": "Clinical trial cooperative",
  "UG3": "Planning phase cooperative",
  "UH2": "Exploratory cooperative",
  "UH3": "Implementation cooperative",
  // T — Training Grants
  "T15": "Short-term training grant",
  "T32": "Institutional training grant",
  "T34": "Undergraduate training grant",
  "T35": "Short-term institutional training",
  "T90": "Interdisciplinary training grant",
  "TL1": "CTSA predoc/postdoc training",
  // F — Fellowships
  "F30": "Predoctoral dual-degree fellowship",
  "F31": "Predoctoral fellowship",
  "F32": "Postdoctoral fellowship",
  "F33": "Senior fellowship",
  // N — R&D Contracts
  "N01": "R&D contract",
  "N02": "Intramural research contract",
  "N43": "SBIR contract Phase I",
  "N44": "SBIR contract Phase II",
  // M — Clinical Research Infrastructure
  "M01": "General Clinical Research Center",
  "M02": "Clinical research construction",
  // S — Supplements & Other
  "S10": "Shared instrumentation grant",
  "S15": "Small instrumentation grant",
  "S21": "Research education grant",
  "SC1": "Research project (minority-serving)",
  "SC2": "Pilot research (minority-serving)",
  "SC3": "Small research (minority-serving)",
  // Z — Intramural Research
  "ZIA": "NIH intramural research",
  "ZIC": "NIH intramural center support",
  "ZIR": "NIH intramural resource",
  // DP — Director's Programs
  "DP1": "Director's Pioneer Award",
  "DP2": "Director's New Innovator Award",
  "DP3": "Director's Type 1 Diabetes Award",
  "DP4": "Director's Pathfinder Award",
  "DP5": "Director's Early Independence Award",
};

// Valid NIH Activity Codes (for validation)
const VALID_NIH_ACTIVITY_CODES = new Set(Object.keys(NIH_ACTIVITY_CODES));

// Valid NIH Institute/Center codes (2-letter)
const VALID_NIH_IC_CODES = new Set([
  "AA", "AG", "AI", "AR", "AT", "CA", "DA", "DC", "DE", "DK", "EB", "ES", "EY",
  "GM", "HD", "HG", "HL", "LM", "MD", "MH", "NR", "NS", "OD", "RR", "TR", "TW"
]);

// Parse NIH grant ID and extract components
interface NIHGrantInfo {
  isNIH: boolean;
  activityCode: string | null;
  icCode: string | null;
  serialNumber: string | null;
  description: string | null;
}

function parseNIHGrantId(awardId: string): NIHGrantInfo {
  const cleanId = awardId.toUpperCase().replace(/[\s\-]/g, '');

  // Handle intramural grants (ZIA, ZIC, ZIR)
  const intramuralMatch = cleanId.match(/^(ZI[ACR])([A-Z]{2})(\d{6})$/);
  if (intramuralMatch) {
    const [, activityCode, icCode, serial] = intramuralMatch;
    if (VALID_NIH_ACTIVITY_CODES.has(activityCode)) {
      return {
        isNIH: true,
        activityCode,
        icCode,
        serialNumber: serial,
        description: NIH_ACTIVITY_CODES[activityCode] || null
      };
    }
  }

  // Handle extramural grants - may have leading digit (application type)
  // Format: [0-9]?[Activity Code][IC Code][Serial Number][Suffix]?
  // Examples: R01MH050129, 5R01DK102815, 1K24CA123456-01A1
  const extramuralMatch = cleanId.match(/^(\d)?([A-Z]{1,3}\d{1,2})([A-Z]{2})(\d{5,6})/);
  if (extramuralMatch) {
    const [, , activityCode, icCode, serial] = extramuralMatch;

    // Validate all three components
    if (VALID_NIH_ACTIVITY_CODES.has(activityCode) && VALID_NIH_IC_CODES.has(icCode)) {
      return {
        isNIH: true,
        activityCode,
        icCode,
        serialNumber: serial,
        description: NIH_ACTIVITY_CODES[activityCode] || null
      };
    }
  }

  // Check for DP (Director's) awards: DP1, DP2, etc.
  const dpMatch = cleanId.match(/^(\d)?(DP\d)([A-Z]{2})(\d{5,6})/);
  if (dpMatch) {
    const [, , activityCode, icCode, serial] = dpMatch;
    if (VALID_NIH_ACTIVITY_CODES.has(activityCode) && VALID_NIH_IC_CODES.has(icCode)) {
      return {
        isNIH: true,
        activityCode,
        icCode,
        serialNumber: serial,
        description: NIH_ACTIVITY_CODES[activityCode] || null
      };
    }
  }

  return {
    isNIH: false,
    activityCode: null,
    icCode: null,
    serialNumber: null,
    description: null
  };
}

// Check if grant ID matches non-US funder patterns
function identifyNonUSFunder(awardId: string): string | null {
  const cleanId = awardId.toUpperCase().replace(/\s+/g, '');

  // EU / Horizon Europe / ERC
  if (/^(H2020|HEU|ERC|FP\d|HORIZON)/i.test(cleanId)) return 'EU';
  if (/^\d{6}$/.test(cleanId) && cleanId.startsWith('2') || cleanId.startsWith('3')) {
    // Could be EU grant number (6 digits starting with 2 or 3)
    // But need more context - skip for now
  }

  // UKRI councils (MRC, BBSRC, EPSRC, etc.)
  if (/^(MR|BB|EP|NE|ST|AH|ES)\/[A-Z]\d+/i.test(cleanId)) return 'UKRI';

  // German DFG
  if (/^DFG/i.test(cleanId) || /^(SFB|SPP|FOR|GRK)\d+/i.test(cleanId)) return 'DFG';

  // French ANR
  if (/^ANR[\-\s]?/i.test(cleanId)) return 'ANR';

  // Japanese JSPS
  if (/^(JSPS|KAKENHI)/i.test(cleanId)) return 'JSPS';

  // Chinese NSFC
  if (/^(NSFC|NNSFC)/i.test(cleanId) || /^\d{8}$/.test(cleanId)) return 'NSFC';

  // Canadian CIHR
  if (/^(CIHR|FRN)/i.test(cleanId)) return 'CIHR';

  // Australian NHMRC/ARC
  if (/^(NHMRC|ARC)/i.test(cleanId)) return 'Australia';

  return null;
}

// Helper to identify funder category for grouping
function categorizeFunder(funderName: string | null, awardId?: string | null): string {
  if (awardId) {
    // First check if it's a valid NIH grant using strict validation
    const nihInfo = parseNIHGrantId(awardId);
    if (nihInfo.isNIH) {
      return 'NIH';
    }

    // Check for non-US funders by award ID pattern
    const nonUSFunder = identifyNonUSFunder(awardId);
    if (nonUSFunder) {
      return nonUSFunder;
    }

    // NSF award IDs
    const cleanId = awardId.toUpperCase().replace(/\s+/g, '');
    if (/^(NSF-?|NIRT-?|EAR-?|DMR-?|CHE-?|PHY-?|DMS-?|AST-?|OCE-?|ATM-?|MCB-?|IOS-?|DEB-?)/i.test(cleanId)) {
      return 'NSF';
    }
    // NSF grants can also be just 7-digit numbers
    if (/^\d{7}$/.test(cleanId)) {
      return 'NSF';
    }
  }

  if (!funderName) return 'Unknown Funder';
  const lower = funderName.toLowerCase();

  // NIH institutes (fallback for when award ID doesn't match pattern)
  const nihPatterns = [
    'national institutes of health', 'nih',
    'national cancer institute', 'nci',
    'national heart', 'nhlbi',
    'national institute of', 'nigms', 'niaid', 'nimh', 'ninds', 'niddk',
    'national eye institute', 'nei',
    'national library of medicine', 'nlm',
    'national center for', 'ncats', 'nccih'
  ];
  if (nihPatterns.some(p => lower.includes(p))) return 'NIH';

  if (lower.includes('national science foundation') || lower === 'nsf') return 'NSF';
  if (lower.includes('darpa')) return 'DARPA';
  if (lower.includes('department of energy') || lower.includes('doe') || (lower.includes('energy') && lower.includes('department'))) return 'DOE';
  if (lower.includes('nasa')) return 'NASA';
  if (lower.includes('defense') || lower.includes('dod') || lower.includes('army') || lower.includes('navy') || lower.includes('air force')) return 'DoD';
  if (lower.includes('european') || lower.includes('horizon') || lower.includes('erc')) return 'EU';
  if (lower.includes('wellcome')) return 'Wellcome Trust';
  if (lower.includes('howard hughes') || lower.includes('hhmi')) return 'HHMI';
  if (lower.includes('medical research council') || lower.includes('mrc') || lower.includes('ukri')) return 'UKRI';
  if (lower.includes('dfg') || lower.includes('deutsche forschungsgemeinschaft')) return 'DFG';
  if (lower.includes('anr') || lower.includes('agence nationale')) return 'ANR';

  return funderName;
}

// Deduplicate funding grants by award_id, keeping the one with most papers
function deduplicateFunding(funding: PersonFunding[]): PersonFunding[] {
  const seen = new Map<string, PersonFunding>();

  for (const grant of funding) {
    // Normalize award ID for comparison (remove prefix variations)
    const normalizedId = grant.award_id.toUpperCase().replace(/^(NSF-?|NIRT-?)/i, '');
    const existing = seen.get(normalizedId);

    if (!existing || grant.paper_count > existing.paper_count) {
      seen.set(normalizedId, grant);
    }
  }

  return Array.from(seen.values());
}

// Group funding by funder category
function groupFundingByFunder(funding: PersonFunding[]): FunderGroup[] {
  const groups = new Map<string, FunderGroup>();

  // First deduplicate
  const dedupedFunding = deduplicateFunding(funding);

  for (const grant of dedupedFunding) {
    const category = categorizeFunder(grant.funder_name, grant.award_id);

    if (!groups.has(category)) {
      groups.set(category, {
        funderName: category,
        funderKey: category,
        grants: [],
        totalPapers: 0
      });
    }

    const group = groups.get(category)!;
    group.grants.push(grant);
    group.totalPapers += grant.paper_count;
  }

  // Sort groups by total papers (descending)
  return Array.from(groups.values()).sort((a, b) => b.totalPapers - a.totalPapers);
}

// Format currency
function formatCurrency(amount: number): string {
  if (amount >= 1000000) {
    return `$${(amount / 1000000).toFixed(1)}M`;
  }
  if (amount >= 1000) {
    return `$${(amount / 1000).toFixed(0)}K`;
  }
  return `$${amount.toLocaleString()}`;
}

// Format grant year range from dates
function formatGrantYears(startDate: string | null, endDate: string | null): string | null {
  const startYear = startDate ? new Date(startDate).getFullYear() : null;
  const endYear = endDate ? new Date(endDate).getFullYear() : null;

  if (startYear && endYear) {
    return startYear === endYear ? `${startYear}` : `${startYear}–${endYear}`;
  }
  if (startYear) return `${startYear}–`;
  if (endYear) return `–${endYear}`;
  return null;
}

// Generate grant URL immediately based on funder category
function getGrantUrl(awardId: string, funderCategory: string): string | null {
  const cleanId = awardId.replace(/\s+/g, '');

  if (funderCategory === 'NIH') {
    return `https://reporter.nih.gov/quickSearch/${encodeURIComponent(cleanId)}`;
  }
  if (funderCategory === 'NSF') {
    const numericId = cleanId.replace(/\D/g, '');
    if (numericId.length >= 6) {
      return `https://www.nsf.gov/awardsearch/showAward?AWD_ID=${numericId}`;
    }
  }
  if (funderCategory === 'DOE') {
    return `https://www.osti.gov/search/semantic:${encodeURIComponent(cleanId)}`;
  }
  if (funderCategory === 'NASA') {
    return `https://techport.nasa.gov/search?searchQuery=${encodeURIComponent(cleanId)}`;
  }
  if (funderCategory === 'DoD') {
    return `https://discover.dtic.mil/results/?q=${encodeURIComponent(cleanId)}`;
  }
  if (funderCategory === 'EU') {
    return `https://cordis.europa.eu/search?q=${encodeURIComponent(cleanId)}`;
  }
  return null;
}

interface WikidataInfo {
  wikidata_id: string | null;
  wikipedia_url: string | null;
  birth_date: string | null;
  death_date: string | null;
  image_url: string | null;
  description: string | null;
  scopus_id: string | null;
  researcher_id: string | null;
  twitter_username: string | null;
}

// Convert various tweet URL formats to x.com web URL
function convertToWebTweetUrl(url: string): string {
  // Handle twitter:// protocol URLs like twitter://status?id=123
  const twitterProtocolMatch = url.match(/twitter:\/\/status\?id=(\d+)/);
  if (twitterProtocolMatch) {
    return `https://x.com/i/status/${twitterProtocolMatch[1]}`;
  }

  // Handle http(s)://twitter.com/user/statuses/123 format
  const statusesMatch = url.match(/twitter\.com\/([^/]+)\/statuses\/(\d+)/);
  if (statusesMatch) {
    return `https://x.com/${statusesMatch[1]}/status/${statusesMatch[2]}`;
  }

  // Handle existing twitter.com/user/status/123 format
  const statusMatch = url.match(/twitter\.com\/([^/]+)\/status\/(\d+)/);
  if (statusMatch) {
    return `https://x.com/${statusMatch[1]}/status/${statusMatch[2]}`;
  }

  // Fallback: just replace twitter.com with x.com and http with https
  return url.replace('http://', 'https://').replace('twitter.com', 'x.com');
}

export default function PersonDetailPage() {
  const params = useParams();
  const authorid = params.authorid as string;

  const [data, setData] = useState<PersonDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorStack, setErrorStack] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [wikidata, setWikidata] = useState<WikidataInfo | null>(null);
  const [orcidData, setOrcidData] = useState<OrcidData | null>(null);
  const [showAllTweets, setShowAllTweets] = useState(false);

  // Funding state
  const [expandedFunders, setExpandedFunders] = useState<Set<string>>(new Set());
  const [grantDetails, setGrantDetails] = useState<Map<string, GrantDetails>>(new Map());
  const [loadingGrants, setLoadingGrants] = useState<Set<string>>(new Set());

  // Tweet embeds state
  const [tweetEmbeds, setTweetEmbeds] = useState<Map<string, TweetEmbed>>(new Map());
  const [loadingTweetEmbeds, setLoadingTweetEmbeds] = useState(false);

  // Publications sort state
  const [pubSortBy, setPubSortBy] = useState<"citations" | "year">("citations");

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/persons/${authorid}`);
        if (!res.ok) {
          const err = await res.json();
          if (err.stack) {
            setErrorStack(err.stack);
          }
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const json = await res.json();
        setData(json);

        // Fetch Wikidata and ORCID info if ORCID is available
        if (json.summary?.orcid) {
          // Extract ORCID ID from URL if needed (e.g., "https://orcid.org/0000-0001-2345-6789" -> "0000-0001-2345-6789")
          const orcidId = json.summary.orcid.replace(/^https?:\/\/orcid\.org\//, '');

          // Fetch both in parallel
          const [wdRes, orcidRes] = await Promise.all([
            fetch(`/api/wikidata?orcid=${encodeURIComponent(json.summary.orcid)}`).catch(() => null),
            fetch(`/api/orcid/${encodeURIComponent(orcidId)}`).catch(() => null),
          ]);

          // Handle Wikidata response
          if (wdRes?.ok) {
            try {
              const wdJson = await wdRes.json();
              if (wdJson.wikidata_id) {
                setWikidata(wdJson);
              }
            } catch {
              // Silently fail
            }
          }

          // Handle ORCID response - only set if we have meaningful data
          if (orcidRes?.ok) {
            try {
              const orcidJson = await orcidRes.json();
              if (orcidJson.education?.length > 0 || orcidJson.employment?.length > 0) {
                setOrcidData(orcidJson);
              }
            } catch {
              // Silently fail
            }
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load person");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [authorid]);

  // Fetch tweet embeds when tweets are available
  useEffect(() => {
    async function fetchTweetEmbeds() {
      if (!data?.tweets || data.tweets.length === 0) return;

      // Only fetch embeds for the first 5 tweets initially
      const tweetsToFetch = data.tweets.slice(0, 5);
      const urlsToFetch = tweetsToFetch.map(t => t.original_tweet_url);

      setLoadingTweetEmbeds(true);
      try {
        const response = await fetch('/api/tweet-embed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls: urlsToFetch }),
        });

        if (response.ok) {
          const result = await response.json();
          const newEmbeds = new Map<string, TweetEmbed>();
          for (const tweet of result.tweets) {
            newEmbeds.set(tweet.url, { html: tweet.html, author_name: tweet.author_name });
          }
          setTweetEmbeds(newEmbeds);
        }
      } catch (err) {
        console.error('Failed to fetch tweet embeds:', err);
      } finally {
        setLoadingTweetEmbeds(false);
      }
    }

    fetchTweetEmbeds();
  }, [data?.tweets]);

  // Toggle funder expansion and fetch grant details
  const toggleFunderExpansion = async (funderKey: string, grants: PersonFunding[]) => {
    const newExpanded = new Set(expandedFunders);

    if (newExpanded.has(funderKey)) {
      newExpanded.delete(funderKey);
      setExpandedFunders(newExpanded);
      return;
    }

    newExpanded.add(funderKey);
    setExpandedFunders(newExpanded);

    // Fetch details for grants we don't have yet
    const grantsToFetch = grants.filter(g => !grantDetails.has(g.award_id));

    if (grantsToFetch.length > 0) {
      const grantIds = grantsToFetch.map(g => g.award_id);
      setLoadingGrants(prev => new Set([...prev, ...grantIds]));

      try {
        const response = await fetch('/api/grants', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            grants: grantsToFetch.map(g => ({
              award_id: g.award_id,
              funder: g.funder_name
            }))
          })
        });

        if (response.ok) {
          const data = await response.json();
          const newDetails = new Map(grantDetails);
          for (const grant of data.grants) {
            newDetails.set(grant.award_id, grant);
          }
          setGrantDetails(newDetails);
        }
      } catch (err) {
        console.error('Failed to fetch grant details:', err);
      } finally {
        setLoadingGrants(prev => {
          const next = new Set(prev);
          grantIds.forEach(id => next.delete(id));
          return next;
        });
      }
    }
  };

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          <span className="ml-3 text-gray-500">Loading author details...</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    const copyStackTrace = async () => {
      if (errorStack) {
        await navigator.clipboard.writeText(errorStack);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    };

    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Link
          href="/"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-8"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to search
        </Link>
        <div className="text-center py-24">
          <p className="text-red-600 text-lg">{error || "Person not found"}</p>
          <p className="text-gray-500 mt-2">
            Make sure the preprocessing script has been run with author data.
          </p>
          {errorStack && (
            <div className="mt-6 max-w-2xl mx-auto">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-gray-500">Stack trace (for debugging):</span>
                <button
                  onClick={copyStackTrace}
                  className="text-sm px-3 py-1 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 rounded transition-colors"
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
              </div>
              <pre className="text-left text-xs bg-gray-100 dark:bg-gray-900 p-4 rounded overflow-x-auto whitespace-pre-wrap text-gray-700 dark:text-gray-300">
                {errorStack}
              </pre>
            </div>
          )}
        </div>
      </div>
    );
  }

  const { summary, yearlyStats, affiliations, funding, twitter, tweets, recentPublications, trials } = data;

  // Parse and clean up alternative names
  const getAlternativeNames = (): string[] => {
    if (!summary.display_name_alternatives) return [];
    let names: string[] = [];
    try {
      // Try parsing as JSON array
      const parsed = JSON.parse(summary.display_name_alternatives);
      if (Array.isArray(parsed)) {
        names = parsed;
      } else {
        names = [String(parsed)];
      }
    } catch {
      // If not valid JSON, treat as comma-separated or single string
      names = summary.display_name_alternatives.split(',').map(s => s.trim());
    }
    // Filter out names that match the display name (case-insensitive, ignoring special chars)
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const displayNorm = normalize(summary.display_name);
    return names.filter(name => normalize(name) !== displayNorm);
  };
  const alternativeNames = getAlternativeNames();

  // Format Wikidata dates
  const formatWikidataDate = (dateStr: string | null): string | null => {
    if (!dateStr) return null;
    // Handle year-only (4 digits)
    if (/^\d{4}$/.test(dateStr)) {
      return dateStr;
    }
    // Handle full date
    const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    }
    return dateStr;
  };

  const birthDate = formatWikidataDate(wikidata?.birth_date ?? null);
  const deathDate = formatWikidataDate(wikidata?.death_date ?? null);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Back link */}
      <Link
        href="/"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-8"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to search
      </Link>

      {/* Main layout: Infobox left, Charts right */}
      <div className="grid lg:grid-cols-[352px_1fr] gap-8 mb-8">
        {/* Left: Infobox */}
        <Card>
          <CardContent className="pt-6">
            {/* Photo from Wikidata */}
            {wikidata?.image_url && (
              <div className="mb-4 flex justify-center">
                <div className="relative w-32 h-32 rounded-full overflow-hidden bg-gray-100">
                  <Image
                    src={wikidata.image_url}
                    alt={summary.display_name}
                    fill
                    className="object-cover"
                    unoptimized
                  />
                </div>
              </div>
            )}

            {/* Name */}
            <h1 className="text-2xl font-bold mb-2 text-center">{summary.display_name}</h1>

            {/* Wikidata description - skip generic "researcher" descriptions and ORCID-only descriptions */}
            {wikidata?.description && !/^(researcher|scientist)$/i.test(wikidata.description.trim()) && !/orcid/i.test(wikidata.description) && (
              <p className="text-sm text-gray-500 text-center mb-2 italic">
                {wikidata.description}
              </p>
            )}

            {/* Birth/Death dates */}
            {(birthDate || deathDate) && (
              <p className="text-sm text-gray-500 text-center mb-2">
                {birthDate && deathDate
                  ? `${birthDate} – ${deathDate}`
                  : birthDate
                  ? `Born ${birthDate}`
                  : `Died ${deathDate}`}
              </p>
            )}

            {alternativeNames.length > 0 && (
              <p className="text-sm text-gray-500 mb-2 text-center">
                Also known as: {alternativeNames.join(', ')}
              </p>
            )}
            <p className="text-xs text-gray-400 mb-4 text-center">Data up to Jan 2025</p>

            {/* Key stats */}
            <div className="space-y-3 mb-6">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Publications</span>
                <span className="font-semibold">{formatNumber(summary.works_count)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Citations</span>
                <span className="font-semibold">{formatNumber(summary.cited_by_count)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">h-index</span>
                <span className="font-semibold">{summary.h_index || "—"}</span>
              </div>
              {summary.avg_c10 != null && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500" title="Mean number of citations received by this author's papers 10 years after publication">
                    Avg citations after 10 years
                  </span>
                  <span className="font-semibold">{summary.avg_c10.toFixed(1)}</span>
                </div>
              )}
              {summary.orcid && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">ORCID</span>
                  {(() => {
                    const orcidId = summary.orcid.replace(/^https?:\/\/orcid\.org\//, '');
                    return (
                      <a
                        href={`https://orcid.org/${orcidId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                      >
                        {orcidId}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* External Links */}
            {(wikidata?.wikipedia_url || wikidata?.scopus_id || wikidata?.researcher_id || wikidata?.twitter_username) && (
              <div className="border-t pt-4 mb-4">
                <div className="flex items-center gap-2 text-sm font-medium mb-2">
                  <Globe className="h-4 w-4" />
                  External Links
                </div>
                <div className="flex flex-col gap-2">
                  {wikidata.wikipedia_url && (
                    <a
                      href={wikidata.wikipedia_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                    >
                      Wikipedia
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {wikidata.scopus_id && (
                    <a
                      href={`https://www.scopus.com/authid/detail.uri?authorId=${wikidata.scopus_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                    >
                      Scopus Author ({wikidata.scopus_id})
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {wikidata.researcher_id && (
                    <a
                      href={`https://www.webofscience.com/wos/author/rid/${wikidata.researcher_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                    >
                      ResearcherID ({wikidata.researcher_id})
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {wikidata.twitter_username && (
                    <a
                      href={`https://x.com/${wikidata.twitter_username}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                    >
                      X (@{wikidata.twitter_username})
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Social Media - Twitter with embedded tweets */}
            {twitter && (
              <div className="border-t pt-4">
                <div className="flex items-center gap-2 text-sm font-medium mb-2">
                  <Twitter className="h-4 w-4" />
                  X tweets mentioning papers
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                  <span className="font-semibold">{formatNumber(twitter.tweet_count)}</span> total tweets
                </div>

                {/* Tweet embeds - show first 5 by default */}
                {tweets && tweets.length > 0 && (
                  <>
                    {loadingTweetEmbeds && tweetEmbeds.size === 0 && (
                      <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading tweets...
                      </div>
                    )}
                    <div
                      className={showAllTweets ? "max-h-[500px] overflow-y-auto space-y-3 pr-1" : "space-y-3"}
                      style={showAllTweets ? { scrollbarWidth: 'thin' } : undefined}
                    >
                      {(showAllTweets ? tweets : tweets.slice(0, 5)).map((tweet, idx) => {
                        const webUrl = convertToWebTweetUrl(tweet.original_tweet_url);
                        const embed = tweetEmbeds.get(tweet.original_tweet_url);
                        // Format timestamp
                        const tweetDate = tweet.occurred_time ? new Date(tweet.occurred_time) : null;
                        const formattedDate = tweetDate
                          ? tweetDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
                          : null;

                        // If we have embed HTML, render it
                        if (embed?.html) {
                          return (
                            <div
                              key={`${tweet.tweet_id}-${idx}`}
                              className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg p-3 bg-white dark:bg-gray-900"
                            >
                              <div
                                className="tweet-embed [&_blockquote]:m-0 [&_blockquote]:border-0 [&_blockquote]:p-0 [&_a]:text-blue-600 [&_a]:no-underline [&_a:hover]:underline"
                                dangerouslySetInnerHTML={{ __html: embed.html }}
                              />
                            </div>
                          );
                        }

                        // Fallback: show link with timestamp
                        // Extract username from URL
                        const usernameMatch = tweet.original_tweet_url.match(/twitter\.com\/([^/]+)\//);
                        const username = usernameMatch ? usernameMatch[1] : null;

                        return (
                          <div key={`${tweet.tweet_id}-${idx}`} className="text-sm flex items-center gap-2">
                            <a
                              href={webUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800"
                            >
                              {username ? `@${username}` : 'View tweet'}
                              <ExternalLink className="h-3 w-3" />
                            </a>
                            {formattedDate && (
                              <span className="text-gray-400 text-xs">
                                {formattedDate}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Load all button */}
                    {!showAllTweets && tweets.length > 5 && (
                      <button
                        onClick={() => setShowAllTweets(true)}
                        className="mt-3 w-full flex items-center justify-center gap-1 text-sm text-blue-600 hover:text-blue-800 py-2 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                      >
                        <ChevronDown className="h-4 w-4" />
                        Show all {tweets.length} tweets
                      </button>
                    )}
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right: Charts stacked */}
        <div className="space-y-6">
          {yearlyStats.length > 0 && (
            <>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Publications Over Time</CardTitle>
                </CardHeader>
                <CardContent>
                  <PublicationsChart data={yearlyStats} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Citations Over Time</CardTitle>
                </CardHeader>
                <CardContent>
                  <CitationsChart data={yearlyStats} />
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>

      {/* ORCID Employment - CV style */}
      {orcidData && orcidData.employment.length > 0 && (
        <div className="mb-8">
          <h2 className="flex items-center gap-2 text-lg font-semibold mb-3">
            <Briefcase className="h-5 w-5" />
            Employment History
            <span className="text-xs font-normal text-gray-400 ml-1">(from ORCID)</span>
          </h2>
          <div className="divide-y dark:divide-gray-800">
            {orcidData.employment.map((emp, idx) => (
              <div
                key={`emp-${idx}`}
                className="py-2"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{emp.organization}</div>
                    {emp.role && (
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        {emp.role}
                        {emp.department && ` · ${emp.department}`}
                      </div>
                    )}
                    {!emp.role && emp.department && (
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        {emp.department}
                      </div>
                    )}
                  </div>
                  <div className="text-sm text-gray-500 tabular-nums whitespace-nowrap">
                    {emp.startYear && emp.endYear
                      ? `${emp.startYear}–${emp.endYear}`
                      : emp.startYear
                      ? `${emp.startYear}–present`
                      : emp.endYear
                      ? `–${emp.endYear}`
                      : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ORCID Education - CV style */}
      {orcidData && orcidData.education.length > 0 && (
        <div className="mb-8">
          <h2 className="flex items-center gap-2 text-lg font-semibold mb-3">
            <GraduationCap className="h-5 w-5" />
            Education
            <span className="text-xs font-normal text-gray-400 ml-1">(from ORCID)</span>
          </h2>
          <div className="divide-y dark:divide-gray-800">
            {orcidData.education.map((edu, idx) => (
              <div
                key={`edu-${idx}`}
                className="py-2"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{edu.institution}</div>
                    {edu.degree && (
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        {edu.degree}
                        {edu.department && ` · ${edu.department}`}
                      </div>
                    )}
                    {!edu.degree && edu.department && (
                      <div className="text-sm text-gray-600 dark:text-gray-400">
                        {edu.department}
                      </div>
                    )}
                  </div>
                  <div className="text-sm text-gray-500 tabular-nums whitespace-nowrap">
                    {edu.startYear && edu.endYear
                      ? `${edu.startYear}–${edu.endYear}`
                      : edu.startYear
                      ? `${edu.startYear}–`
                      : edu.endYear
                      ? edu.endYear.toString()
                      : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Likely Affiliations - compact list */}
      {filterAffiliations(affiliations).filter(a => a.paper_count >= 4).length > 0 && (
        <div className="mb-8">
          <h2 className="flex items-center gap-2 text-lg font-semibold mb-3">
            <Building2 className="h-5 w-5" />
            Likely Affiliations
            <span className="text-xs font-normal text-gray-400 ml-1">(imputed from papers dat, and likely to have errors!)</span>
          </h2>
          <div className="divide-y dark:divide-gray-800">
            {filterAffiliations(affiliations).filter(a => a.paper_count >= 4).map((aff, idx) => (
              <div
                key={`${aff.institutionid}-${idx}`}
                className="flex items-center justify-between py-2"
              >
                <div className="flex items-baseline gap-2">
                  <span className="font-medium">
                    {aff.institution_name || aff.institutionid}
                  </span>
                  {aff.first_year && aff.last_year && (
                    <span className="text-sm text-gray-500">
                      {aff.first_year}–{aff.last_year}
                    </span>
                  )}
                </div>
                <span className="text-sm text-gray-500 tabular-nums">
                  {formatNumber(aff.paper_count)} papers
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Funding - collapsible bars by funder */}
      {funding.length > 0 && (
        <div className="mb-8">
          <h2 className="flex items-center gap-2 text-lg font-semibold mb-3">
            <Award className="h-5 w-5" />
            Funding
          </h2>
          <div className="space-y-2">
            {groupFundingByFunder(funding).map((group) => {
              const isExpanded = expandedFunders.has(group.funderKey);

              return (
                <div key={group.funderKey} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                  {/* Funder bar header */}
                  <button
                    onClick={() => toggleFunderExpansion(group.funderKey, group.grants)}
                    className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-gray-500" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-gray-500" />
                      )}
                      <span className="font-medium">{group.funderName}</span>
                      <span className="px-2 py-0.5 bg-gray-200 dark:bg-gray-600 rounded text-xs">
                        {group.grants.length} grant{group.grants.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <span className="text-sm text-gray-500 tabular-nums">
                      {formatNumber(group.totalPapers)} papers
                    </span>
                  </button>

                  {/* Expanded grant list */}
                  {isExpanded && (
                    <div className="divide-y divide-gray-100 dark:divide-gray-700">
                      {group.grants.map((grant, idx) => {
                        const details = grantDetails.get(grant.award_id);
                        const isLoading = loadingGrants.has(grant.award_id);
                        // Parse NIH grant info for description and URL
                        const nihInfo = parseNIHGrantId(grant.award_id);
                        // Use API-fetched URL if available, otherwise use immediate URL
                        // For NIH grants, always link to NIH Reporter
                        const immediateUrl = nihInfo.isNIH
                          ? `https://reporter.nih.gov/quickSearch/${encodeURIComponent(grant.award_id.replace(/\s+/g, ''))}`
                          : getGrantUrl(grant.award_id, group.funderKey);
                        const displayUrl = details?.url || immediateUrl;

                        return (
                          <div
                            key={`${grant.award_id}-${idx}`}
                            className="px-4 py-3 pl-11"
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1 min-w-0">
                                {/* Grant ID, description, year, and link */}
                                <div className="flex items-center gap-2 flex-wrap">
                                  {displayUrl ? (
                                    <a
                                      href={displayUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="font-medium text-blue-600 hover:text-blue-800 inline-flex items-center gap-1"
                                    >
                                      {grant.award_id}
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                  ) : (
                                    <span className="font-medium">{grant.award_id}</span>
                                  )}
                                  {/* NIH activity code description */}
                                  {nihInfo.isNIH && nihInfo.description && (
                                    <span className="text-xs text-gray-400">
                                      {nihInfo.description}
                                    </span>
                                  )}
                                  {details && formatGrantYears(details.start_date, details.end_date) && (
                                    <span className="text-sm text-gray-500">
                                      ({formatGrantYears(details.start_date, details.end_date)})
                                    </span>
                                  )}
                                </div>

                                {/* Grant title and amount */}
                                {isLoading ? (
                                  <div className="flex items-center gap-2 mt-1">
                                    <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
                                    <span className="text-sm text-gray-400">Loading details...</span>
                                  </div>
                                ) : details?.title ? (
                                  <div className="text-sm text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
                                    {details.title}
                                    {details.amount && (
                                      <span className="font-semibold"> - {formatCurrency(details.amount)}</span>
                                    )}
                                  </div>
                                ) : details?.amount ? (
                                  <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                                    <span className="font-semibold">{formatCurrency(details.amount)}</span>
                                  </div>
                                ) : null}
                              </div>

                              {/* Paper count */}
                              <div className="text-right flex-shrink-0">
                                <div className="text-sm text-gray-500 tabular-nums">
                                  {formatNumber(grant.paper_count)} papers
                                </div>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Clinical Trials */}
      {trials && trials.length > 0 && (
        <div className="mb-8">
          <h2 className="flex items-center gap-2 text-lg font-semibold mb-3">
            <FlaskConical className="h-5 w-5" />
            Clinical Trials
          </h2>
          <div className="divide-y dark:divide-gray-800">
            {trials.map((trial, idx) => (
              <Link
                key={`${trial.nct_id}-${idx}`}
                href={`/trials/${trial.nct_id}`}
                className="flex items-center justify-between py-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 -mx-2 px-2 rounded transition-colors"
              >
                <span className="font-medium text-blue-600 hover:text-blue-800">
                  {trial.nct_id}
                </span>
                <span className="text-sm text-gray-500 tabular-nums">
                  {trial.paper_count} paper{trial.paper_count !== 1 ? 's' : ''}
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Publications */}
      {recentPublications.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <BookOpen className="h-5 w-5" />
              Publications
            </h2>
            <div className="flex items-center gap-1">
              <ArrowUpDown className="h-4 w-4 text-gray-400" />
              <button
                onClick={() => setPubSortBy("citations")}
                className={`px-2 py-1 text-sm rounded transition-colors ${
                  pubSortBy === "citations"
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200"
                    : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                Citations
              </button>
              <button
                onClick={() => setPubSortBy("year")}
                className={`px-2 py-1 text-sm rounded transition-colors ${
                  pubSortBy === "year"
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200"
                    : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                Year
              </button>
            </div>
          </div>
          <div className="divide-y dark:divide-gray-800">
            {[...recentPublications]
              .sort((a, b) => {
                if (pubSortBy === "citations") {
                  return (b.cited_by_count || 0) - (a.cited_by_count || 0);
                } else {
                  return (b.year || 0) - (a.year || 0);
                }
              })
              .map((pub, idx) => (
              <Link
                key={`${pub.paperid}-${idx}`}
                href={`/papers/${pub.paperid}`}
                className="block py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 -mx-2 px-2 rounded transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium line-clamp-2">
                      {pub.title || "Untitled"}
                    </div>
                    <div className="text-sm text-gray-500 mt-1 flex items-center gap-3 flex-wrap">
                      {pub.year && <span>{pub.year}</span>}
                      {pub.source_name && (
                        <span className="truncate italic">{pub.source_name}</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0 tabular-nums">
                    <span className="text-sm text-gray-500">
                      {formatNumber(pub.cited_by_count)} citations
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
