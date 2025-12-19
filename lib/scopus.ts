// Scopus API for official CiteScore
// Requires SCOPUS_API_KEY and optionally SCOPUS_INST_TOKEN env vars
// Get API key from: https://dev.elsevier.com/

const SCOPUS_API_KEY = process.env.SCOPUS_API_KEY;
const SCOPUS_INST_TOKEN = process.env.SCOPUS_INST_TOKEN;

interface ScopusSourceMetrics {
  citescore?: number;
  citescoreYear?: number;
  percentile?: number;
  rank?: string;
}

// Simple in-memory cache to avoid repeated API calls
const cache = new Map<string, { data: ScopusSourceMetrics | null; timestamp: number }>();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export async function fetchScopusCiteScore(issn: string): Promise<ScopusSourceMetrics | null> {
  if (!SCOPUS_API_KEY) {
    // Silently return null if API key not configured
    return null;
  }

  // Clean ISSN (remove dashes)
  const cleanIssn = issn.replace(/-/g, '');

  // Check cache
  const cached = cache.get(cleanIssn);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const headers: Record<string, string> = {
      'X-ELS-APIKey': SCOPUS_API_KEY,
      'Accept': 'application/json',
    };

    if (SCOPUS_INST_TOKEN) {
      headers['X-ELS-Insttoken'] = SCOPUS_INST_TOKEN;
    }

    const response = await fetch(
      `https://api.elsevier.com/content/serial/title/issn/${cleanIssn}?view=CITESCORE`,
      { headers }
    );

    if (!response.ok) {
      // Cache the failure to avoid repeated failed requests
      cache.set(cleanIssn, { data: null, timestamp: Date.now() });
      return null;
    }

    const data = await response.json();
    const entry = data['serial-metadata-response']?.entry?.[0];

    if (!entry) {
      cache.set(cleanIssn, { data: null, timestamp: Date.now() });
      return null;
    }

    // Extract CiteScore metrics
    // The structure varies - try different paths
    const citeScoreYearInfo = entry['citeScoreYearInfoList'];
    const currentMetric = citeScoreYearInfo?.citeScoreCurrentMetric ||
                          citeScoreYearInfo?.citeScoreCurrentMetricYear;

    const result: ScopusSourceMetrics = {};

    if (currentMetric) {
      if (currentMetric.citeScore) {
        result.citescore = parseFloat(currentMetric.citeScore);
      }
      if (currentMetric.citeScoreYear) {
        result.citescoreYear = parseInt(currentMetric.citeScoreYear);
      }
      if (currentMetric.citeScorePercentile) {
        result.percentile = parseFloat(currentMetric.citeScorePercentile);
      }
      // Get rank from subject rankings if available
      const subjectRank = currentMetric.citeScoreSubjectRank;
      if (Array.isArray(subjectRank) && subjectRank.length > 0) {
        result.rank = subjectRank[0].rank;
      }
    }

    // Cache successful result
    cache.set(cleanIssn, { data: Object.keys(result).length > 0 ? result : null, timestamp: Date.now() });

    return Object.keys(result).length > 0 ? result : null;
  } catch (e) {
    console.error('Scopus API error:', e);
    // Cache the error to avoid repeated failed requests
    cache.set(cleanIssn, { data: null, timestamp: Date.now() });
    return null;
  }
}
