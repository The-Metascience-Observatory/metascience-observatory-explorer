"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Search, Loader2, ArrowLeft, AlertTriangle, Filter, ExternalLink } from "lucide-react";
import { BROWSE_PAGE_SIZE } from "@/lib/constants";


// Retraction nature options
const RETRACTION_NATURES = [
  { value: "Retraction", label: "Retraction", color: "red" },
  { value: "Expression of concern", label: "Expression of Concern", color: "orange" },
  { value: "Correction", label: "Correction", color: "yellow" },
  { value: "Reinstatement", label: "Reinstatement", color: "green" },
];

// Common reasons for filtering
const TOP_REASONS = [
  "Paper Mill",
  "Fake Peer Review",
  "Plagiarism",
  "Data Fabrication",
  "Duplication",
  "Unreliable Results",
  "Image Manipulation",
];

interface RetractionItem {
  record_id: number;
  title: string;
  journal: string;
  publisher: string;
  retraction_date: string | null;
  original_paper_date: string | null;
  original_paper_doi: string | null;
  retraction_nature: string;
  reasons: string | null;
  paperid: string | null;
}

interface SearchResponse {
  results: RetractionItem[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  message?: string;
  error?: string;
  filters?: {
    natures: { retraction_nature: string; count: number }[];
    topReasons: { reason: string; count: number }[];
  };
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Unknown";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function getNatureColor(nature: string): string {
  switch (nature) {
    case "Retraction":
      return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
    case "Expression of concern":
      return "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200";
    case "Correction":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
    case "Reinstatement":
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200";
  }
}

function RetractionsSearchContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") || "";

  const [query, setQuery] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
  const [results, setResults] = useState<RetractionItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);

  // Filters
  const [selectedNature, setSelectedNature] = useState<string | null>(null);
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [yearFrom, setYearFrom] = useState<string>("");
  const [yearTo, setYearTo] = useState<string>("");
  const [showFilters, setShowFilters] = useState(false);

  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  // Build URL with filters
  const buildUrl = useCallback((searchQuery: string | null, currentOffset: number) => {
    const params = new URLSearchParams();
    if (searchQuery) params.set("q", searchQuery);
    params.set("limit", String(BROWSE_PAGE_SIZE));
    params.set("offset", String(currentOffset));
    if (selectedNature) params.set("nature", selectedNature);
    if (selectedReason) params.set("reason", selectedReason);
    if (yearFrom) params.set("yearFrom", yearFrom);
    if (yearTo) params.set("yearTo", yearTo);
    return `/api/retractions?${params.toString()}`;
  }, [selectedNature, selectedReason, yearFrom, yearTo]);

  // Load initial data
  useEffect(() => {
    async function loadInitial() {
      try {
        const res = await fetch(buildUrl(null, 0));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: SearchResponse = await res.json();
        setResults(data.results);
        setTotal(data.total);
        setHasMore(data.hasMore);
        setOffset(data.results.length);
      } catch (e) {
        console.error("Failed to load retractions:", e);
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setInitialLoading(false);
      }
    }
    loadInitial();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Run initial search if query param exists
  useEffect(() => {
    if (initialQuery && initialQuery.length >= 2) {
      performSearch(initialQuery);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Perform search
  const performSearch = async (searchQuery: string | null, isLoadMore = false) => {
    if (isLoadMore) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setOffset(0);
    }

    try {
      const currentOffset = isLoadMore ? offset : 0;
      const res = await fetch(buildUrl(searchQuery, currentOffset));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SearchResponse = await res.json();

      if (data.error) {
        throw new Error(data.error);
      }

      if (isLoadMore) {
        setResults((prev) => [...prev, ...data.results]);
      } else {
        setResults(data.results);
      }

      setTotal(data.total);
      setHasMore(data.hasMore);
      setOffset(currentOffset + data.results.length);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
      if (!isLoadMore) {
        setResults([]);
        setTotal(0);
      }
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  // Handle form submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.length >= 2 || query.length === 0) {
      setSubmittedQuery(query);
      if (query) {
        router.push(`/retractions?q=${encodeURIComponent(query)}`, { scroll: false });
      } else {
        router.push(`/retractions`, { scroll: false });
      }
      performSearch(query || null);
    }
  };

  // Handle filter changes - re-run search
  const handleFilterChange = () => {
    performSearch(submittedQuery || null);
  };

  // Load more results
  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    performSearch(submittedQuery || null, true);
  }, [loadingMore, hasMore, submittedQuery, offset]); // eslint-disable-line react-hooks/exhaustive-deps

  // Intersection observer for infinite scroll
  useEffect(() => {
    if (loading || initialLoading) return;

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
  }, [loading, initialLoading, hasMore, loadingMore, loadMore]);

  if (initialLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          <span className="ml-3 text-gray-500">Loading retractions...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Back link */}
      <Link
        href="/retractions"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-6"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to analytics
      </Link>

      {/* Header */}
      <div className="mb-8">
        {/* Heading lives in the server component
            (app/retractions/search/page.tsx) so the <h1> is in the initial HTML
            rather than behind this component's Suspense boundary. */}
        <p className="text-gray-500">
          Browse {total.toLocaleString()} retracted papers from{" "}
          <a
            href="https://retractionwatch.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            Retraction Watch
          </a>
        </p>
      </div>

      {/* Search form */}
      <form onSubmit={handleSubmit} className="mb-4">
        <div className="relative">
          {loading ? (
            <Loader2 className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 animate-spin" />
          ) : (
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
          )}
          <Input
            type="text"
            placeholder="Search by title, journal, or DOI... (press Enter)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-12 h-14 text-lg"
          />
        </div>
      </form>

      {/* Filters */}
      <div className="mb-6">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-2"
        >
          <Filter className="h-4 w-4" />
          <span>Filters</span>
          {(selectedNature || selectedReason || yearFrom || yearTo) && (
            <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">
              Active
            </span>
          )}
        </button>

        {showFilters && (
          <Card className="p-4">
            <div className="grid gap-4 md:grid-cols-2">
              {/* Nature filter */}
              <div>
                <label className="text-sm font-medium mb-2 block">Type</label>
                <select
                  value={selectedNature || ""}
                  onChange={(e) => {
                    setSelectedNature(e.target.value || null);
                    setTimeout(handleFilterChange, 0);
                  }}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm bg-white dark:bg-gray-900"
                >
                  <option value="">All types</option>
                  {RETRACTION_NATURES.map((n) => (
                    <option key={n.value} value={n.value}>
                      {n.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Reason filter */}
              <div>
                <label className="text-sm font-medium mb-2 block">Reason</label>
                <select
                  value={selectedReason || ""}
                  onChange={(e) => {
                    setSelectedReason(e.target.value || null);
                    setTimeout(handleFilterChange, 0);
                  }}
                  className="w-full rounded-md border border-gray-300 dark:border-gray-700 px-3 py-2 text-sm bg-white dark:bg-gray-900"
                >
                  <option value="">All reasons</option>
                  {TOP_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              {/* Year range */}
              <div className="md:col-span-2">
                <label className="text-sm font-medium mb-2 block">Retraction Year</label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    placeholder="From"
                    value={yearFrom}
                    onChange={(e) => setYearFrom(e.target.value)}
                    onBlur={handleFilterChange}
                    className="w-24"
                    min="1970"
                    max="2025"
                  />
                  <span className="text-gray-400">–</span>
                  <Input
                    type="number"
                    placeholder="To"
                    value={yearTo}
                    onChange={(e) => setYearTo(e.target.value)}
                    onBlur={handleFilterChange}
                    className="w-24"
                    min="1970"
                    max="2025"
                  />
                  <button
                    onClick={() => {
                      setYearFrom("");
                      setYearTo("");
                      setTimeout(handleFilterChange, 0);
                    }}
                    className="text-sm text-blue-600 hover:text-blue-800"
                  >
                    Clear
                  </button>
                </div>
              </div>
            </div>

            {/* Clear all filters */}
            {(selectedNature || selectedReason || yearFrom || yearTo) && (
              <div className="mt-4 pt-4 border-t">
                <button
                  onClick={() => {
                    setSelectedNature(null);
                    setSelectedReason(null);
                    setYearFrom("");
                    setYearTo("");
                    setTimeout(handleFilterChange, 0);
                  }}
                  className="text-sm text-red-600 hover:text-red-800"
                >
                  Clear all filters
                </button>
              </div>
            )}
          </Card>
        )}
      </div>

      {/* Error */}
      {error && (
        <Card className="p-4 mb-6 border-red-200 bg-red-50">
          <p className="text-red-600">{error}</p>
        </Card>
      )}

      {/* Results count */}
      {!loading && (
        <div className="mb-4">
          <p className="text-gray-600">
            {submittedQuery ? (
              <>
                Found <span className="font-semibold">{total.toLocaleString()}</span> results
                matching &quot;{submittedQuery}&quot;
              </>
            ) : (
              <>
                Showing <span className="font-semibold">{total.toLocaleString()}</span> retractions
              </>
            )}
          </p>
        </div>
      )}

      {/* Initial loading state */}
      {loading && results.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          <span className="ml-2 text-gray-500">Searching...</span>
        </div>
      )}

      {/* Results list */}
      {results.length > 0 && (
        <div className="space-y-3">
          {results.map((item) => (
            <Card key={item.record_id} className="p-4">
              <div className="flex flex-col gap-2">
                {/* Nature badge and date */}
                <div className="flex items-center justify-between gap-2">
                  <span className={`px-2 py-0.5 text-xs font-medium rounded ${getNatureColor(item.retraction_nature)}`}>
                    {item.retraction_nature}
                  </span>
                  <span className="text-sm text-gray-500">
                    {formatDate(item.retraction_date)}
                  </span>
                </div>

                {/* Title */}
                <h3 className="font-medium line-clamp-2">
                  {item.paperid ? (
                    <Link
                      href={`/papers/${item.paperid}`}
                      className="text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      {item.title}
                    </Link>
                  ) : (
                    item.title
                  )}
                </h3>

                {/* Journal and publisher */}
                <div className="text-sm text-gray-500">
                  <span className="italic">{item.journal}</span>
                  {item.publisher && <span> · {item.publisher}</span>}
                </div>

                {/* Reasons */}
                {item.reasons && (
                  <div className="flex flex-wrap gap-1">
                    {item.reasons.split(";").slice(0, 3).map((reason, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded"
                      >
                        {reason.trim()}
                      </span>
                    ))}
                    {item.reasons.split(";").length > 3 && (
                      <span className="px-2 py-0.5 text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 rounded">
                        +{item.reasons.split(";").length - 3} more
                      </span>
                    )}
                  </div>
                )}

                {/* DOI link */}
                {item.original_paper_doi && (
                  <a
                    href={`https://doi.org/${item.original_paper_doi}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                  >
                    <ExternalLink className="h-3 w-3" />
                    {item.original_paper_doi}
                  </a>
                )}
              </div>
            </Card>
          ))}

          {/* Load more sentinel */}
          <div ref={loadMoreRef} className="py-4">
            {loadingMore && (
              <div className="flex items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                <span className="ml-2 text-sm text-gray-500">Loading more...</span>
              </div>
            )}
            {!hasMore && results.length > 0 && (
              <p className="text-center text-sm text-gray-500">
                Showing all {results.length.toLocaleString()} results
              </p>
            )}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && results.length === 0 && !error && (
        <div className="text-center py-12 text-gray-500">
          <AlertTriangle className="h-16 w-16 mx-auto mb-4 text-gray-300" />
          <p className="text-lg">No retractions found</p>
          <p className="text-sm mt-2">
            Try adjusting your search or filters
          </p>
        </div>
      )}
    </div>
  );
}

export default function RetractionsPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            <span className="ml-3 text-gray-500">Loading...</span>
          </div>
        </div>
      }
    >
      <RetractionsSearchContent />
    </Suspense>
  );
}
