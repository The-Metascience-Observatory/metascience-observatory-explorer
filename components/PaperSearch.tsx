"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { PaperCard } from "@/components/PaperCard";
import type { PaperSearchItem } from "@/lib/types";
import { Search, Loader2 } from "lucide-react";

interface PaperSearchProps {
  compact?: boolean;
}

interface SearchResponse {
  results?: PaperSearchItem[];
  total?: number;
  error?: string;
  message?: string;
  indexRequired?: boolean;
}

export function PaperSearch({ compact = false }: PaperSearchProps) {
  const router = useRouter();
  const [results, setResults] = useState<PaperSearchItem[]>([]);
  const [totalPapers, setTotalPapers] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [indexMissing, setIndexMissing] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Load total count on mount
  useEffect(() => {
    async function loadCount() {
      try {
        const res = await fetch("/api/papers/search");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: SearchResponse = await res.json();
        if (data.error) {
          throw new Error(data.error);
        }
        setTotalPapers(data.total ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to connect to database");
      } finally {
        setInitialLoading(false);
      }
    }
    loadCount();
  }, []);

  // Debounce query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  // Server-side search
  useEffect(() => {
    if (!debouncedQuery || debouncedQuery.length < 3) {
      setResults([]);
      setIndexMissing(false);
      return;
    }

    async function search() {
      setLoading(true);
      try {
        const res = await fetch(`/api/papers/search?q=${encodeURIComponent(debouncedQuery)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: SearchResponse = await res.json();
        if (data.error) {
          throw new Error(data.error);
        }
        if (data.indexRequired) {
          setIndexMissing(true);
          setResults([]);
        } else {
          setIndexMissing(false);
          setResults(data.results ?? []);
        }
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Search failed");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }
    search();
  }, [debouncedQuery]);

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setQuery(e.target.value);
    },
    []
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && query.length >= 3) {
        router.push(`/papers?q=${encodeURIComponent(query)}`);
      }
    },
    [query, router]
  );

  if (initialLoading) {
    return (
      <div className={`flex items-center justify-center ${compact ? "py-4" : "py-12"}`}>
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        <span className="ml-2 text-sm text-gray-500">Loading...</span>
      </div>
    );
  }

  if (error && !results.length && !query) {
    return (
      <div className={`text-center ${compact ? "py-4" : "py-12"}`}>
        <p className="text-red-600 text-sm">Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Subtitle with count */}
      {compact && totalPapers && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          Search through {totalPapers.toLocaleString()} papers
        </p>
      )}

      <div className="relative">
        {loading ? (
          <Loader2 className={`absolute left-3 top-1/2 -translate-y-1/2 ${compact ? "h-4 w-4" : "h-5 w-5"} text-gray-400 animate-spin`} />
        ) : (
          <Search className={`absolute left-3 top-1/2 -translate-y-1/2 ${compact ? "h-4 w-4" : "h-5 w-5"} text-gray-400`} />
        )}
        <Input
          type="text"
          placeholder={compact ? "Search papers..." : "Search papers by title..."}
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          className={compact ? "pl-9 h-10 text-sm" : "pl-10 h-12 text-lg"}
        />
      </div>

      {query.length > 0 && query.length < 3 && (
        <p className="text-xs text-gray-500 mt-2">
          Type at least 3 characters to search
        </p>
      )}

      {indexMissing && (
        <p className="text-xs text-amber-600 mt-3">
          Paper search index is being built. Please check back later.
        </p>
      )}

      {debouncedQuery.length >= 3 && !loading && !indexMissing && results.length === 0 && (
        <p className="text-xs text-gray-500 mt-3">
          No papers found matching &quot;{debouncedQuery}&quot;
        </p>
      )}

      {results.length > 0 && (
        <div className="mt-3">
          <div className="grid gap-2">
            {results.slice(0, compact ? 7 : 20).map((paper) => (
              <PaperCard key={paper.paperid} paper={paper} compact={compact} />
            ))}
          </div>
        </div>
      )}

      {!compact && query.length === 0 && (
        <div className="mt-6 text-center text-gray-500">
          <p>Search through {totalPapers ? totalPapers.toLocaleString() : "..."} papers</p>
          <p className="text-sm mt-1">
            Search by title to find academic publications
          </p>
        </div>
      )}
    </div>
  );
}
