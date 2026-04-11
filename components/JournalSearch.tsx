"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { JournalCard } from "@/components/JournalCard";
import type { JournalSearchItem } from "@/lib/types";
import { ENTITY_COUNTS } from "@/lib/counts";
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
  const router = useRouter();
  const [results, setResults] = useState<JournalSearchItem[]>([]);
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
        const res = await fetch(`/api/journals/search?q=${encodeURIComponent(debouncedQuery)}`);
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
        router.push(`/journals?q=${encodeURIComponent(query)}`);
      }
    },
    [query, router]
  );

  return (
    <div className="w-full">
      {/* Subtitle with count */}
      {compact && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          Search through {ENTITY_COUNTS.journals.toLocaleString()} journals
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
          <p>Search through {ENTITY_COUNTS.journals.toLocaleString()} journals</p>
          <p className="text-sm mt-1">
            Try searching for &quot;Nature&quot;, &quot;Science&quot;, or &quot;Cell&quot;
          </p>
        </div>
      )}
    </div>
  );
}
