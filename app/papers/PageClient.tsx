"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { PaperCard } from "@/components/PaperCard";
import type { PaperSearchItem } from "@/lib/types";
import { Search, Loader2, ArrowLeft, FileText } from "lucide-react";

const PAGE_SIZE = 50;

interface SearchResponse {
  results: PaperSearchItem[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  message?: string;
  error?: string;
  indexRequired?: boolean;
}

function PapersSearchContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") || "";

  const [query, setQuery] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
  const [results, setResults] = useState<PaperSearchItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [indexMissing, setIndexMissing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  // Load total paper count on mount
  useEffect(() => {
    async function loadCount() {
      try {
        const res = await fetch("/api/papers/search");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await res.json();
      } catch (e) {
        console.error("Failed to load paper count:", e);
      } finally {
        setInitialLoading(false);
      }
    }
    loadCount();
  }, []);

  // Run initial search if query param exists
  useEffect(() => {
    if (initialQuery && initialQuery.length >= 3) {
      performSearch(initialQuery);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Perform search
  const performSearch = async (searchQuery: string, isLoadMore = false) => {
    if (!searchQuery || searchQuery.length < 3) {
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
      const res = await fetch(
        `/api/papers/search?q=${encodeURIComponent(searchQuery)}&limit=${PAGE_SIZE}&offset=${currentOffset}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SearchResponse = await res.json();

      if (data.error) {
        throw new Error(data.error);
      }

      if (data.indexRequired) {
        setIndexMissing(true);
        setResults([]);
        setTotal(0);
        setHasMore(false);
      } else {
        setIndexMissing(false);
        if (isLoadMore) {
          setResults((prev) => [...prev, ...data.results]);
        } else {
          setResults(data.results);
        }
        setTotal(data.total);
        setHasMore(data.hasMore);
        setOffset(currentOffset + data.results.length);
      }
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
    if (query.length >= 3) {
      setSubmittedQuery(query);
      // Update URL with query param
      router.push(`/papers?q=${encodeURIComponent(query)}`, { scroll: false });
      performSearch(query);
    }
  };

  // Load more results
  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore || !submittedQuery) return;
    performSearch(submittedQuery, true);
  }, [loadingMore, hasMore, submittedQuery, offset]); // eslint-disable-line react-hooks/exhaustive-deps

  // Intersection observer for infinite scroll
  useEffect(() => {
    if (loading || !submittedQuery) return;

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
  }, [loading, hasMore, loadingMore, loadMore, submittedQuery]);

  if (initialLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          <span className="ml-3 text-gray-500">Loading...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-8">
      {/* Back link */}
      <Link
        href="/"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-6"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to search
      </Link>

      {/* Header lives in the server component (app/papers/page.tsx) so the
          <h1> is present in the initial HTML rather than behind Suspense. */}

      {/* Search form */}
      <form onSubmit={handleSubmit} className="mb-8">
        <div className="relative">
          {loading ? (
            <Loader2 className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 animate-spin" />
          ) : (
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
          )}
          <Input
            type="text"
            placeholder="Search papers by title... (press Enter to search)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-12 h-14 text-lg"
          />
        </div>
        {query.length > 0 && query.length < 3 && (
          <p className="text-sm text-gray-500 mt-2">
            Type at least 3 characters to search
          </p>
        )}
      </form>

      {/* Error */}
      {error && (
        <Card className="p-4 mb-6 border-red-200 bg-red-50">
          <p className="text-red-600">{error}</p>
        </Card>
      )}

      {/* Index missing warning */}
      {indexMissing && (
        <Card className="p-4 mb-6 border-amber-200 bg-amber-50">
          <p className="text-amber-700">
            Paper search index is being built. Please check back later.
          </p>
        </Card>
      )}

      {/* Results count */}
      {submittedQuery && !loading && !indexMissing && (
        <div className="mb-4">
          {total > 0 ? (
            <p className="text-gray-600">
              Found <span className="font-semibold">{total.toLocaleString()}</span> papers
              matching &quot;{submittedQuery}&quot;
            </p>
          ) : (
            <p className="text-gray-500">
              No papers found matching &quot;{submittedQuery}&quot;
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
          {results.map((paper) => (
            <PaperCard key={paper.paperid} paper={paper} />
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
          <FileText className="h-16 w-16 mx-auto mb-4 text-gray-300" />
          <p className="text-lg">Enter a search term and press Enter</p>
          <p className="text-sm mt-2">
            Search for papers by title keywords
          </p>
        </div>
      )}
    </div>
  );
}

export default function PapersSearchPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-12">
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
            <span className="ml-3 text-gray-500">Loading...</span>
          </div>
        </div>
      }
    >
      <PapersSearchContent />
    </Suspense>
  );
}
