"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { TrialCard } from "@/components/TrialCard";
import type { TrialSearchItem } from "@/lib/types";
import { Search, Loader2, ArrowLeft, FlaskConical, Filter, X } from "lucide-react";

const PAGE_SIZE = 50;

// Available trial phases
const TRIAL_PHASES = [
  { value: "EARLY_PHASE1", label: "Early Phase 1" },
  { value: "PHASE1", label: "Phase 1" },
  { value: "PHASE1|PHASE2", label: "Phase 1/2" },
  { value: "PHASE2", label: "Phase 2" },
  { value: "PHASE2|PHASE3", label: "Phase 2/3" },
  { value: "PHASE3", label: "Phase 3" },
  { value: "PHASE4", label: "Phase 4" },
  { value: "NA", label: "N/A" },
  { value: "NULL", label: "Not Specified" },
];

interface SearchResponse {
  results: TrialSearchItem[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  message?: string;
  error?: string;
}

function TrialsSearchContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") || "";
  const initialIntervention = searchParams.get("intervention") || "";

  const [query, setQuery] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
  const [intervention, setIntervention] = useState(initialIntervention);
  const [results, setResults] = useState<TrialSearchItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalTrials, setTotalTrials] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [selectedPhases, setSelectedPhases] = useState<Set<string>>(new Set(TRIAL_PHASES.map(p => p.value)));
  const [showFilters, setShowFilters] = useState(false);

  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  // Load total trial count on mount
  useEffect(() => {
    async function loadCount() {
      try {
        const res = await fetch("/api/trials/search");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setTotalTrials(data.total ?? null);
      } catch (e) {
        console.error("Failed to load trial count:", e);
      } finally {
        setInitialLoading(false);
      }
    }
    loadCount();
  }, []);

  // Run initial search if query or intervention param exists
  useEffect(() => {
    if (initialIntervention) {
      performSearch(initialQuery, false, undefined, initialIntervention);
    } else if (initialQuery && initialQuery.length >= 2) {
      performSearch(initialQuery);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Perform search
  const performSearch = async (searchQuery: string, isLoadMore = false, phases?: Set<string>, interventionFilter?: string) => {
    const currentIntervention = interventionFilter ?? intervention;

    // Need either a valid query or an intervention filter
    if ((!searchQuery || searchQuery.length < 2) && !currentIntervention) {
      setResults([]);
      setTotal(0);
      setHasMore(false);
      return;
    }

    if (isLoadMore) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      setOffset(0);
    }

    try {
      const currentOffset = isLoadMore ? offset : 0;
      const currentPhases = phases ?? selectedPhases;

      // Build URL with filters
      const params = new URLSearchParams();
      if (searchQuery && searchQuery.length >= 2) {
        params.set("q", searchQuery);
      }
      if (currentIntervention) {
        params.set("intervention", currentIntervention);
      }
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(currentOffset));

      // Only add phases param if not all phases are selected
      if (currentPhases.size < TRIAL_PHASES.length) {
        params.set("phases", Array.from(currentPhases).join(","));
      }

      const url = `/api/trials/search?${params.toString()}`;
      const res = await fetch(url);
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
    if (query.length >= 2) {
      setSubmittedQuery(query);
      // Update URL with query param
      router.push(`/trials?q=${encodeURIComponent(query)}`, { scroll: false });
      performSearch(query);
    }
  };

  // Handle phase filter change
  const handlePhaseChange = (phase: string, checked: boolean) => {
    const newPhases = new Set(selectedPhases);
    if (checked) {
      newPhases.add(phase);
    } else {
      newPhases.delete(phase);
    }
    setSelectedPhases(newPhases);

    // Re-run search with new filters if we have results
    if (submittedQuery) {
      performSearch(submittedQuery, false, newPhases);
    }
  };

  // Select/deselect all phases
  const handleSelectAll = (selectAll: boolean) => {
    if (selectAll) {
      setSelectedPhases(new Set(TRIAL_PHASES.map(p => p.value)));
      if (submittedQuery) {
        performSearch(submittedQuery, false, new Set(TRIAL_PHASES.map(p => p.value)));
      }
    } else {
      setSelectedPhases(new Set());
      if (submittedQuery) {
        performSearch(submittedQuery, false, new Set());
      }
    }
  };

  // Load more results
  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    if (!submittedQuery && !intervention) return;
    performSearch(submittedQuery, true);
  }, [loadingMore, hasMore, submittedQuery, intervention, offset]); // eslint-disable-line react-hooks/exhaustive-deps

  // Intersection observer for infinite scroll
  useEffect(() => {
    if (loading || (!submittedQuery && !intervention)) return;

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
  }, [loading, hasMore, loadingMore, loadMore, submittedQuery, intervention]);

  if (initialLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          <span className="ml-3 text-gray-500">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Back link */}
      <Link
        href="/"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-6"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to search
      </Link>

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <FlaskConical className="h-8 w-8 text-gray-600" />
          <h1 className="text-3xl font-bold">Clinical Trials</h1>
        </div>
        {totalTrials && (
          <p className="text-gray-500">
            Search through {totalTrials.toLocaleString()} clinical trials from ClinicalTrials.gov
          </p>
        )}
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
            placeholder="Search by NCT ID or title... (press Enter to search)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-12 h-14 text-lg"
          />
        </div>
        {query.length > 0 && query.length < 2 && !intervention && (
          <p className="text-sm text-gray-500 mt-2">
            Type at least 2 characters to search
          </p>
        )}
      </form>

      {/* Active intervention filter */}
      {intervention && (
        <div className="mb-4 flex items-center gap-2">
          <span className="text-sm text-gray-500">Filtering by intervention:</span>
          <span className="inline-flex items-center gap-1 px-3 py-1 bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-200 rounded-full text-sm">
            {intervention}
            <button
              onClick={() => {
                setIntervention("");
                router.push("/trials", { scroll: false });
                setResults([]);
                setTotal(0);
              }}
              className="ml-1 hover:bg-orange-200 dark:hover:bg-orange-800 rounded-full p-0.5"
              title="Clear intervention filter"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        </div>
      )}

      {/* Phase Filters */}
      <div className="mb-6">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 mb-2"
        >
          <Filter className="h-4 w-4" />
          <span>Filter by Phase</span>
          {selectedPhases.size < TRIAL_PHASES.length && (
            <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">
              {selectedPhases.size} selected
            </span>
          )}
        </button>

        {showFilters && (
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium">Trial Phases</span>
              <div className="flex gap-2">
                <button
                  onClick={() => handleSelectAll(true)}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  Select All
                </button>
                <span className="text-gray-300">|</span>
                <button
                  onClick={() => handleSelectAll(false)}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  Clear All
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {TRIAL_PHASES.map((phase) => (
                <label
                  key={phase.value}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedPhases.has(phase.value)}
                    onChange={(e) =>
                      handlePhaseChange(phase.value, e.target.checked)
                    }
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>{phase.label}</span>
                </label>
              ))}
            </div>
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
      {submittedQuery && !loading && (
        <div className="mb-4">
          {total > 0 ? (
            <p className="text-gray-600">
              Found <span className="font-semibold">{total.toLocaleString()}</span> trials
              matching &quot;{submittedQuery}&quot;
            </p>
          ) : (
            <p className="text-gray-500">
              No trials found matching &quot;{submittedQuery}&quot;
            </p>
          )}
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
          {results.map((trial) => (
            <TrialCard key={trial.nct_id} trial={trial} hideStatus />
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

      {/* Empty state (no search yet) */}
      {!submittedQuery && !loading && (
        <div className="text-center py-12 text-gray-500">
          <FlaskConical className="h-16 w-16 mx-auto mb-4 text-gray-300" />
          <p className="text-lg">Enter a search term and press Enter</p>
          <p className="text-sm mt-2">
            Try searching by NCT ID (e.g., &quot;NCT04280705&quot;) or trial title
          </p>
        </div>
      )}
    </div>
  );
}

export default function TrialsSearchPage() {
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
      <TrialsSearchContent />
    </Suspense>
  );
}
