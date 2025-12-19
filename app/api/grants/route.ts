import { NextResponse } from "next/server";
import { getCachedGrants, setCachedGrant } from "@/lib/db";

export interface GrantDetails {
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

// Clean up grant ID - remove common prefixes/suffixes and standardize
function cleanGrantId(awardId: string, funder: string): string {
  let cleaned = awardId.trim();

  // Remove common prefixes
  cleaned = cleaned.replace(/^(Grant\s*#?|Award\s*#?|#)/i, '').trim();

  return cleaned;
}

// Extract core NIH grant number from various formats
function extractNIHProjectNum(awardId: string): string {
  // NIH grants often have format like: 5R01DK102815-05, R01DK102815, DK102815
  // Also handle: 1R01CA123456-01A1, U01CA123456, etc.
  let cleaned = awardId.toUpperCase().replace(/\s+/g, '');

  // If it starts with a digit followed by a letter, it might have a prefix indicator
  // Remove trailing year/suffix info like -01, -01A1
  // But keep the core grant mechanism and number

  return cleaned;
}

// Build URL for NIH RePORTER
function getNIHReporterUrl(awardId: string): string {
  const projectNum = extractNIHProjectNum(awardId);
  return `https://reporter.nih.gov/quickSearch/${encodeURIComponent(projectNum)}`;
}

// Build URL for NSF Award Search
function getNSFUrl(awardId: string): string {
  // NSF award IDs are typically 7-digit numbers
  const numericId = awardId.replace(/\D/g, '');
  return `https://www.nsf.gov/awardsearch/showAward?AWD_ID=${numericId}`;
}

// Build URL for other funders
function getFunderUrl(awardId: string, funderName: string | null | undefined): string | null {
  if (!funderName) return null;
  const funderLower = funderName.toLowerCase();
  const cleanId = cleanGrantId(awardId, funderName);

  if (funderLower.includes('darpa')) {
    // DARPA doesn't have a public grant database, but we can link to their site
    return `https://www.darpa.mil/`;
  }

  if (funderLower.includes('doe') || funderLower.includes('department of energy') || funderLower.includes('energy')) {
    // DOE OSTI
    return `https://www.osti.gov/search/semantic:${encodeURIComponent(cleanId)}`;
  }

  if (funderLower.includes('nasa')) {
    return `https://techport.nasa.gov/search?searchQuery=${encodeURIComponent(cleanId)}`;
  }

  if (funderLower.includes('usda') || funderLower.includes('agriculture')) {
    return `https://cris.nifa.usda.gov/cgi-bin/starfinder/0?path=fastlink1.txt&id=anon&pass=&search=AN%3D${encodeURIComponent(cleanId)}&format=WEBFMT6NT`;
  }

  if (funderLower.includes('army') || funderLower.includes('navy') || funderLower.includes('air force') || funderLower.includes('dod') || funderLower.includes('defense')) {
    // DoD grants can be searched through DTIC
    return `https://discover.dtic.mil/results/?q=${encodeURIComponent(cleanId)}`;
  }

  if (funderLower.includes('cdc') || funderLower.includes('centers for disease control')) {
    return `https://taggs.hhs.gov/Detail/AwardDetail?arg_AwardNum=${encodeURIComponent(cleanId)}`;
  }

  if (funderLower.includes('european') || funderLower.includes('horizon') || funderLower.includes('erc')) {
    return `https://cordis.europa.eu/search?q=${encodeURIComponent(cleanId)}`;
  }

  if (funderLower.includes('wellcome')) {
    return `https://wellcome.org/grant-funding`;
  }

  if (funderLower.includes('howard hughes') || funderLower.includes('hhmi')) {
    return `https://www.hhmi.org/`;
  }

  return null;
}

// Identify funder type from name
function identifyFunderType(funderName: string | null | undefined): 'NIH' | 'NSF' | 'OTHER' {
  if (!funderName) return 'OTHER';
  const lower = funderName.toLowerCase();

  // NIH institutes and centers
  const nihPatterns = [
    'national institutes of health', 'nih',
    'national cancer institute', 'nci',
    'national heart', 'nhlbi',
    'national institute of', 'nigms', 'niaid', 'nimh', 'ninds', 'niddk',
    'national eye institute', 'nei',
    'national library of medicine', 'nlm',
    'national center for', 'ncats', 'nccih'
  ];

  if (nihPatterns.some(p => lower.includes(p))) {
    return 'NIH';
  }

  if (lower.includes('national science foundation') || lower === 'nsf') {
    return 'NSF';
  }

  return 'OTHER';
}

async function fetchNIHGrantDetails(awardId: string): Promise<Partial<GrantDetails> | null> {
  try {
    const projectNum = extractNIHProjectNum(awardId);

    const response = await fetch('https://api.reporter.nih.gov/v2/projects/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        criteria: {
          project_nums: [projectNum]
        },
        limit: 1,
        offset: 0
      })
    });

    if (!response.ok) {
      console.log(`NIH API returned ${response.status} for ${projectNum}`);
      return null;
    }

    const data = await response.json();

    if (data.results && data.results.length > 0) {
      const project = data.results[0];
      return {
        title: project.project_title || null,
        amount: project.award_amount || null,
        start_date: project.project_start_date || null,
        end_date: project.project_end_date || null,
        pi_name: project.principal_investigators?.[0]?.full_name || null,
        organization: project.organization?.org_name || null,
        url: `https://reporter.nih.gov/search/${encodeURIComponent(projectNum)}/project-details`
      };
    }

    return null;
  } catch (error) {
    console.error('Error fetching NIH grant details:', error);
    return null;
  }
}

async function fetchNSFGrantDetails(awardId: string): Promise<Partial<GrantDetails> | null> {
  try {
    // Extract numeric ID
    const numericId = awardId.replace(/\D/g, '');

    if (!numericId || numericId.length < 6) {
      return null;
    }

    const response = await fetch(`https://api.nsf.gov/services/v1/awards/${numericId}.json`);

    if (!response.ok) {
      console.log(`NSF API returned ${response.status} for ${numericId}`);
      return null;
    }

    const data = await response.json();

    if (data.response?.award && data.response.award.length > 0) {
      const award = data.response.award[0];
      return {
        title: award.title || null,
        amount: award.fundsObligatedAmt ? parseInt(award.fundsObligatedAmt) : null,
        start_date: award.startDate || null,
        end_date: award.expDate || null,
        pi_name: award.piFirstName && award.piLastName
          ? `${award.piFirstName} ${award.piLastName}`
          : null,
        organization: award.awardeeCity && award.awardeeName
          ? `${award.awardeeName}, ${award.awardeeCity}`
          : award.awardeeName || null,
        url: `https://www.nsf.gov/awardsearch/showAward?AWD_ID=${numericId}`
      };
    }

    return null;
  } catch (error) {
    console.error('Error fetching NSF grant details:', error);
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const awardId = searchParams.get('award_id');
  const funderName = searchParams.get('funder');

  if (!awardId || !funderName) {
    return NextResponse.json(
      { error: 'award_id and funder parameters are required' },
      { status: 400 }
    );
  }

  const funderType = identifyFunderType(funderName);

  let details: Partial<GrantDetails> | null = null;

  if (funderType === 'NIH') {
    details = await fetchNIHGrantDetails(awardId);
    if (!details) {
      // Return basic info with URL even if API fails
      details = {
        url: getNIHReporterUrl(awardId)
      };
    }
  } else if (funderType === 'NSF') {
    details = await fetchNSFGrantDetails(awardId);
    if (!details) {
      details = {
        url: getNSFUrl(awardId)
      };
    }
  } else {
    // For other funders, just provide URL if available
    details = {
      url: getFunderUrl(awardId, funderName)
    };
  }

  const result: GrantDetails = {
    award_id: awardId,
    funder: funderName,
    title: details?.title || null,
    amount: details?.amount || null,
    start_date: details?.start_date || null,
    end_date: details?.end_date || null,
    pi_name: details?.pi_name || null,
    organization: details?.organization || null,
    url: details?.url || null
  };

  return NextResponse.json(result);
}

// Batch endpoint for multiple grants
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { grants } = body as { grants: Array<{ award_id: string; funder: string }> };

    if (!grants || !Array.isArray(grants)) {
      return NextResponse.json(
        { error: 'grants array is required' },
        { status: 400 }
      );
    }

    // Limit to prevent abuse
    const limitedGrants = grants.slice(0, 20);

    // Check cache first
    const awardIds = limitedGrants.map(g => g.award_id);
    const cachedResults = getCachedGrants(awardIds);

    // Separate cached and uncached grants
    const uncachedGrants: Array<{ award_id: string; funder: string }> = [];
    const results: GrantDetails[] = [];

    for (const grant of limitedGrants) {
      const cached = cachedResults.get(grant.award_id);
      if (cached) {
        results.push(cached as GrantDetails);
      } else {
        uncachedGrants.push(grant);
      }
    }

    // If all grants were cached, return early
    if (uncachedGrants.length === 0) {
      return NextResponse.json({ grants: results });
    }

    // Group uncached grants by funder type for batch processing
    const nihGrants: Array<{ award_id: string; funder: string }> = [];
    const nsfGrants: Array<{ award_id: string; funder: string }> = [];
    const otherGrants: Array<{ award_id: string; funder: string }> = [];

    for (const grant of uncachedGrants) {
      const funderType = identifyFunderType(grant.funder);
      if (funderType === 'NIH') {
        nihGrants.push(grant);
      } else if (funderType === 'NSF') {
        nsfGrants.push(grant);
      } else {
        otherGrants.push(grant);
      }
    }

    // Fetch NIH grants - can batch up to a few at once
    if (nihGrants.length > 0) {
      // NIH API supports multiple project_nums in one request
      try {
        const projectNums = nihGrants.map(g => extractNIHProjectNum(g.award_id));
        const response = await fetch('https://api.reporter.nih.gov/v2/projects/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            criteria: { project_nums: projectNums },
            limit: 50,
            offset: 0
          })
        });

        if (response.ok) {
          const data = await response.json();
          // Map by both serial number and full project number for flexible matching
          const projectBySerial = new Map<string, typeof data.results[0]>();
          const projectByFull = new Map<string, typeof data.results[0]>();

          for (const project of data.results || []) {
            if (project.project_serial_num) {
              // Serial number like "MH083866" - keep best (most recent) result
              const serial = project.project_serial_num.toUpperCase();
              if (!projectBySerial.has(serial) || project.is_active) {
                projectBySerial.set(serial, project);
              }
            }
            if (project.project_num) {
              projectByFull.set(project.project_num.toUpperCase(), project);
            }
          }

          for (const grant of nihGrants) {
            const projectNum = extractNIHProjectNum(grant.award_id);
            // Extract serial number (letters + digits at end, e.g., MH083866 from R34MH083866)
            const serialMatch = projectNum.match(/([A-Z]{2}\d+)$/);
            const serial = serialMatch ? serialMatch[1] : null;
            // Try matching by serial first, then full project num
            const project = (serial && projectBySerial.get(serial)) || projectByFull.get(projectNum.toUpperCase());

            const grantDetails: GrantDetails = {
              award_id: grant.award_id,
              funder: grant.funder,
              title: project?.project_title || null,
              amount: project?.award_amount || null,
              start_date: project?.project_start_date || null,
              end_date: project?.project_end_date || null,
              pi_name: project?.principal_investigators?.[0]?.full_name || null,
              organization: project?.organization?.org_name || null,
              url: getNIHReporterUrl(grant.award_id)
            };
            results.push(grantDetails);
            // Cache the result
            setCachedGrant(grant.award_id, 'NIH', grantDetails);
          }
        } else {
          // Fallback - just provide URLs (don't cache failures)
          for (const grant of nihGrants) {
            results.push({
              award_id: grant.award_id,
              funder: grant.funder,
              title: null,
              amount: null,
              start_date: null,
              end_date: null,
              pi_name: null,
              organization: null,
              url: getNIHReporterUrl(grant.award_id)
            });
          }
        }
      } catch {
        // Don't cache errors
        for (const grant of nihGrants) {
          results.push({
            award_id: grant.award_id,
            funder: grant.funder,
            title: null,
            amount: null,
            start_date: null,
            end_date: null,
            pi_name: null,
            organization: null,
            url: getNIHReporterUrl(grant.award_id)
          });
        }
      }
    }

    // Fetch NSF grants - need individual requests (rate limited)
    for (const grant of nsfGrants) {
      const details = await fetchNSFGrantDetails(grant.award_id);
      const grantDetails: GrantDetails = {
        award_id: grant.award_id,
        funder: grant.funder,
        title: details?.title || null,
        amount: details?.amount || null,
        start_date: details?.start_date || null,
        end_date: details?.end_date || null,
        pi_name: details?.pi_name || null,
        organization: details?.organization || null,
        url: details?.url || getNSFUrl(grant.award_id)
      };
      results.push(grantDetails);
      // Cache if we got meaningful data
      if (details?.title) {
        setCachedGrant(grant.award_id, 'NSF', grantDetails);
      }

      // Small delay to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Other funders - just provide URLs (no caching needed, no external API)
    for (const grant of otherGrants) {
      results.push({
        award_id: grant.award_id,
        funder: grant.funder,
        title: null,
        amount: null,
        start_date: null,
        end_date: null,
        pi_name: null,
        organization: null,
        url: getFunderUrl(grant.award_id, grant.funder)
      });
    }

    return NextResponse.json({ grants: results });
  } catch (error) {
    console.error('Error in batch grant lookup:', error);
    return NextResponse.json(
      { error: 'Failed to fetch grant details' },
      { status: 500 }
    );
  }
}
