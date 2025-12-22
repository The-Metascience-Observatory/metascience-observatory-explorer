"use client";

import { useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { JournalCard } from "@/components/JournalCard";
import type { JournalSearchItem } from "@/lib/types";
import { Search, Loader2 } from "lucide-react";

interface JournalSearchProps {
  compact?: boolean;
}

interface SearchResponse {
  results?: JournalSearchItem[];
  total?: number;
  error?: string;
  message?: string;
}

export function JournalSearch({ compact = false }: JournalSearchProps) {
  const [results, setResults] = useState<JournalSearchItem[]>([]);
  const [totalJournals, setTotalJournals] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Load total count on mount
  useEffect(() => {
    async function loadCount() {
      try {
        const res = await fetch("/api/journals/search");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: SearchResponse = await res.json();
        if (data.error) {
          throw new Error(data.error);
        }
        setTotalJournals(data.total ?? null);
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
    if (!debouncedQuery || debouncedQuery.length < 2) {
      setResults([]);
      return;
    }

    async function search() {
      setLoading(true);
      try {
        const res = await fetch(`/api/journals/search?q=${encodeURIComponent(debouncedQuery)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: SearchResponse = await res.json();
        if (data.error) {
          throw new Error(data.error);
        }
        setResults(data.results ?? []);
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
      {compact && totalJournals && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          Search through {totalJournals.toLocaleString()} journals
        </p>
      )}

      <div className="relative">
        {loading ? (
          <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 animate-spin" />
        ) : (
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        )}
        <Input
          type="text"
          placeholder={compact ? "Search journals..." : "Search journals by name, ISSN, or publisher..."}
          value={query}
          onChange={handleInputChange}
          className={compact ? "pl-9 h-10 text-sm" : "pl-10 h-12 text-lg"}
        />
      </div>

      {query.length > 0 && query.length < 2 && (
        <p className="text-xs text-gray-500 mt-2">
          Type at least 2 characters to search
        </p>
      )}

      {debouncedQuery.length >= 2 && !loading && results.length === 0 && (
        <p className="text-xs text-gray-500 mt-3">
          No journals found matching &quot;{debouncedQuery}&quot;
        </p>
      )}

      {results.length > 0 && (
        <div className="mt-3">
          <div className="grid gap-2">
            {results.slice(0, compact ? 7 : 20).map((journal) => (
              <JournalCard key={journal.sourceid} journal={journal} compact={compact} />
            ))}
          </div>
        </div>
      )}

      {!compact && query.length === 0 && (
        <div className="mt-6 text-center text-gray-500">
          <p>Search through {totalJournals ? totalJournals.toLocaleString() : "..."} journals</p>
          <p className="text-sm mt-1">
            Try searching for &quot;Nature&quot;, &quot;Science&quot;, or &quot;Cell&quot;
          </p>
        </div>
      )}
    </div>
  );
}
