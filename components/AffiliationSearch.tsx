"use client";

import { useState, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { AffiliationCard } from "@/components/AffiliationCard";
import type { AffiliationSearchItem } from "@/lib/types";
import { Search, Loader2 } from "lucide-react";

interface AffiliationSearchProps {
  compact?: boolean;
}

interface SearchResponse {
  results?: AffiliationSearchItem[];
  total?: number;
  error?: string;
  message?: string;
}

export function AffiliationSearch({ compact = false }: AffiliationSearchProps) {
  const [results, setResults] = useState<AffiliationSearchItem[]>([]);
  const [totalAffiliations, setTotalAffiliations] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  // Load total count on mount
  useEffect(() => {
    async function loadCount() {
      try {
        const res = await fetch("/api/affiliations/search");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: SearchResponse = await res.json();
        if (data.error) {
          throw new Error(data.error);
        }
        setTotalAffiliations(data.total ?? null);
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
        const res = await fetch(`/api/affiliations/search?q=${encodeURIComponent(debouncedQuery)}`);
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
      {compact && totalAffiliations && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          Search through {totalAffiliations.toLocaleString()} institutions.
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
          placeholder={compact ? "Search institutions..." : "Search institutions by name, country, or type..."}
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
          No institutions found matching &quot;{debouncedQuery}&quot;
        </p>
      )}

      {results.length > 0 && (
        <div className="mt-3">
          <div className="grid gap-2">
            {results.slice(0, compact ? 7 : 20).map((affiliation) => (
              <AffiliationCard key={affiliation.institution_id} affiliation={affiliation} compact={compact} />
            ))}
          </div>
        </div>
      )}

      {!compact && query.length === 0 && (
        <div className="mt-6 text-center text-gray-500">
          <p>Search through {totalAffiliations ? totalAffiliations.toLocaleString() : "..."} institutions</p>
          <p className="text-sm mt-1">
            Search for universities, companies, hospitals, and research organizations
          </p>
        </div>
      )}
    </div>
  );
}
