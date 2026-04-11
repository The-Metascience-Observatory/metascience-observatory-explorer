"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { AffiliationCard } from "@/components/AffiliationCard";
import type { AffiliationSearchItem } from "@/lib/types";
import { ENTITY_COUNTS } from "@/lib/counts";
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
  const router = useRouter();
  const [results, setResults] = useState<AffiliationSearchItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

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
      } catch {
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
      if (e.key === "Enter" && query.length >= 2) {
        router.push(`/affiliations?q=${encodeURIComponent(query)}`);
      }
    },
    [query, router]
  );

  return (
    <div className="w-full">
      {/* Subtitle with count */}
      {compact && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          Search through {ENTITY_COUNTS.affiliations.toLocaleString()} institutions
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
          onKeyDown={handleKeyDown}
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
          <p>Search through {ENTITY_COUNTS.affiliations.toLocaleString()} institutions</p>
          <p className="text-sm mt-1">
            Search for universities, companies, hospitals, and research organizations
          </p>
        </div>
      )}
    </div>
  );
}
