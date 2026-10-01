"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PublicationsChart } from "@/components/PublicationsChart";
import { ArrowLeft, Loader2, Building2, ChevronUp, ChevronDown } from "lucide-react";
import { formatNumber, getCountryName } from "@/lib/utils";
import { BROWSE_PAGE_SIZE } from "@/lib/constants";

interface CountryStats {
  funder_count: number;
  total_works: number;
  total_citations: number;
}

interface FunderWithRecentStats {
  funderid: string;
  display_name: string;
  country_code: string;
  grants_count: number | null;
  works_since_2012: number;
  citations_since_2012: number;
}

interface CountryFundersResponse {
  country_code: string;
  stats: CountryStats;
  funders: FunderWithRecentStats[];
  hasMore: boolean;
  offset: number;
  limit: number;
  error?: string;
}

interface YearlyStats {
  year: number;
  works_count: number;
  cited_by_count: number;
}

interface YearlyStatsResponse {
  yearlyStats: YearlyStats[];
}


type SortColumn = "name" | "works" | "citations" | "avgCitations" | "grants";
type SortDirection = "asc" | "desc";

export default function CountryFundersPage() {
  const params = useParams();
  const countryCode = (params.countryCode as string).toUpperCase();

  const [stats, setStats] = useState<CountryStats | null>(null);
  const [funders, setFunders] = useState<FunderWithRecentStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);

  // Lazy-loaded chart data
  const [yearlyStats, setYearlyStats] = useState<YearlyStats[]>([]);
  const [loadingCharts, setLoadingCharts] = useState(true);

  // Sorting state
  const [sortColumn, setSortColumn] = useState<SortColumn>("works");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  // Initial fetch for stats and funders
  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/funders/country/${countryCode}?limit=${BROWSE_PAGE_SIZE}&offset=0`);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const json: CountryFundersResponse = await res.json();
        setStats(json.stats);
        setFunders(json.funders);
        setHasMore(json.hasMore);
        setOffset(json.funders.length);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load funders");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [countryCode]);

  // Lazy load yearly stats for charts
  useEffect(() => {
    async function fetchYearlyStats() {
      try {
        const res = await fetch(`/api/funders/country/${countryCode}/yearly-stats`);
        if (!res.ok) {
          console.error("Failed to fetch yearly stats");
          return;
        }
        const json: YearlyStatsResponse = await res.json();
        setYearlyStats(json.yearlyStats || []);
      } catch (e) {
        console.error("Error fetching yearly stats:", e);
      } finally {
        setLoadingCharts(false);
      }
    }
    fetchYearlyStats();
  }, [countryCode]);

  // Load more funders
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;

    setLoadingMore(true);
    try {
      const res = await fetch(`/api/funders/country/${countryCode}?limit=${BROWSE_PAGE_SIZE}&offset=${offset}`);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json: CountryFundersResponse = await res.json();
      setFunders((prev) => [...prev, ...json.funders]);
      setHasMore(json.hasMore);
      setOffset((prev) => prev + json.funders.length);
    } catch (e) {
      console.error("Error loading more funders:", e);
    } finally {
      setLoadingMore(false);
    }
  }, [countryCode, offset, hasMore, loadingMore]);

  // Intersection observer for infinite scroll
  useEffect(() => {
    if (loading) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current);
    }

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [loading, hasMore, loadingMore, loadMore]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          <span className="ml-3 text-gray-500">Loading funders...</span>
        </div>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Link
          href="/funders-map"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-8"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to map
        </Link>
        <div className="text-center py-24">
          <p className="text-red-600 text-lg">{error || "Country not found"}</p>
        </div>
      </div>
    );
  }

  const countryName = getCountryName(countryCode);

  // Handle column sort
  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("desc");
    }
  };

  // Sort funders
  const sortedFunders = [...funders].sort((a, b) => {
    let aVal: string | number;
    let bVal: string | number;

    switch (sortColumn) {
      case "name":
        aVal = (a.display_name || a.funderid).toLowerCase();
        bVal = (b.display_name || b.funderid).toLowerCase();
        break;
      case "works":
        aVal = a.works_since_2012 || 0;
        bVal = b.works_since_2012 || 0;
        break;
      case "citations":
        aVal = a.citations_since_2012 || 0;
        bVal = b.citations_since_2012 || 0;
        break;
      case "avgCitations":
        aVal = a.works_since_2012 > 0 ? a.citations_since_2012 / a.works_since_2012 : 0;
        bVal = b.works_since_2012 > 0 ? b.citations_since_2012 / b.works_since_2012 : 0;
        break;
      case "grants":
        aVal = a.grants_count || 0;
        bVal = b.grants_count || 0;
        break;
      default:
        return 0;
    }

    if (aVal < bVal) return sortDirection === "asc" ? -1 : 1;
    if (aVal > bVal) return sortDirection === "asc" ? 1 : -1;
    return 0;
  });

  // Sort indicator component
  const SortIndicator = ({ column }: { column: SortColumn }) => {
    if (sortColumn !== column) {
      return <span className="ml-1 text-gray-300">↕</span>;
    }
    return sortDirection === "asc" ? (
      <ChevronUp className="inline h-4 w-4 ml-1" />
    ) : (
      <ChevronDown className="inline h-4 w-4 ml-1" />
    );
  };

  // Convert yearly stats to chart format (filter out 2025 since data is incomplete)
  const chartData = yearlyStats
    .filter((s) => s.year < 2025)
    .map((s) => ({
      year: s.year,
      paper_count: s.works_count,
      total_citations: s.cited_by_count,
    }));

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Back link */}
      <Link
        href="/funders-map"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-8"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to map
      </Link>

      {/* Main layout: Infobox left, Charts right */}
      <div className="grid lg:grid-cols-[352px_1fr] gap-8 mb-8">
        {/* Left: Infobox */}
        <Card>
          <CardContent className="pt-6">
            {/* Country Name */}
            <h1 className="text-2xl font-bold mb-2 text-center">{countryName}</h1>
            <p className="text-xs text-gray-400 mb-4 text-center">Data for 2012–2024</p>

            {/* Key stats */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Funders</span>
                <span className="font-semibold">{formatNumber(stats.funder_count)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Funded Works</span>
                <span className="font-semibold">{formatNumber(stats.total_works)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Total Citations</span>
                <span className="font-semibold">{formatNumber(stats.total_citations)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Right: Charts (lazy loaded) */}
        <div className="space-y-6">
          {loadingCharts ? (
            <Card>
              <CardContent className="py-16">
                <div className="flex items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                  <span className="ml-3 text-gray-500">Loading charts...</span>
                </div>
              </CardContent>
            </Card>
          ) : chartData.length > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Funded Works Over Time</CardTitle>
              </CardHeader>
              <CardContent>
                <PublicationsChart data={chartData} />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-16">
                <p className="text-center text-gray-400">No yearly data available</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Funders Table (full width) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Funders ({formatNumber(stats.funder_count)})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b text-left">
                  <th
                    className="pb-3 pr-6 font-medium text-sm text-gray-500 cursor-pointer hover:text-gray-700 select-none"
                    onClick={() => handleSort("name")}
                  >
                    Name
                    <SortIndicator column="name" />
                  </th>
                  <th
                    className="pb-3 px-3 font-medium text-sm text-gray-500 text-right cursor-pointer hover:text-gray-700 select-none whitespace-nowrap"
                    onClick={() => handleSort("works")}
                  >
                    Works (2012–2024)
                    <SortIndicator column="works" />
                  </th>
                  <th
                    className="pb-3 px-3 font-medium text-sm text-gray-500 text-right cursor-pointer hover:text-gray-700 select-none whitespace-nowrap"
                    onClick={() => handleSort("citations")}
                  >
                    Citations (2012–2024)
                    <SortIndicator column="citations" />
                  </th>
                  <th
                    className="pb-3 px-3 font-medium text-sm text-gray-500 text-right cursor-pointer hover:text-gray-700 select-none"
                    onClick={() => handleSort("avgCitations")}
                  >
                    Avg Cit/Work
                    <SortIndicator column="avgCitations" />
                  </th>
                  <th
                    className="pb-3 pl-3 font-medium text-sm text-gray-500 text-right cursor-pointer hover:text-gray-700 select-none whitespace-nowrap"
                    onClick={() => handleSort("grants")}
                  >
                    Grants (2012–2024)
                    <SortIndicator column="grants" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedFunders.map((funder) => {
                  const avgCitations = funder.works_since_2012 > 0
                    ? funder.citations_since_2012 / funder.works_since_2012
                    : 0;
                  return (
                    <tr
                      key={funder.funderid}
                      className="border-b last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                      <td className="py-3 pr-6">
                        <Link
                          href={`/funders/${funder.funderid}`}
                          className="text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          {funder.display_name || funder.funderid}
                        </Link>
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums">
                        {formatNumber(funder.works_since_2012)}
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums">
                        {formatNumber(funder.citations_since_2012)}
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums">
                        {avgCitations > 0 ? avgCitations.toFixed(1) : "—"}
                      </td>
                      <td className="py-3 pl-3 text-right tabular-nums">
                        {funder.grants_count ? formatNumber(funder.grants_count) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Load more trigger / indicator */}
          <div ref={loadMoreRef} className="mt-4 py-4">
            {loadingMore && (
              <div className="flex items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                <span className="ml-2 text-sm text-gray-500">Loading more...</span>
              </div>
            )}
            {!hasMore && funders.length > 0 && (
              <p className="text-center text-sm text-gray-400">
                Showing all {formatNumber(funders.length)} funders
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
