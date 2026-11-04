"use client";

import { apiFetch } from "@/lib/edge-challenge";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { GrantCard } from "@/components/GrantCard";
import type { GrantLookupResponse } from "@/lib/types";
import { ENTITY_COUNTS } from "@/lib/counts";
import { Search, Loader2 } from "lucide-react";

interface GrantSearchProps {
  compact?: boolean;
}

/** Homepage-grid widget: debounced lookup, Enter goes to the /grants hub. */
export function GrantSearch({ compact = false }: GrantSearchProps) {
  const router = useRouter();
  const [response, setResponse] = useState<GrantLookupResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (debouncedQuery.length < 5) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await apiFetch(`/api/grants/lookup?q=${encodeURIComponent(debouncedQuery)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: GrantLookupResponse = await res.json();
        if (!cancelled) setResponse(data);
      } catch {
        if (!cancelled) setResponse(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && query.trim().length >= 3) {
        router.push(`/grants?q=${encodeURIComponent(query.trim())}`);
      }
    },
    [query, router]
  );

  const matches = response?.matches ?? [];

  return (
    <div className="w-full">
      {compact && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          Look up {ENTITY_COUNTS.grants.toLocaleString()} grants by award number
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
          placeholder={compact ? "Grant number, e.g. R01AG066215" : "Grant or award number..."}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (e.target.value.trim().length < 5) setResponse(null);
          }}
          onKeyDown={handleKeyDown}
          className={compact ? "pl-9 h-10 text-sm font-mono" : "pl-10 h-12 text-lg font-mono"}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {debouncedQuery.length >= 5 && !loading && response?.available && matches.length === 0 && (
        <p className="text-xs text-gray-500 mt-3">No grant found for &quot;{debouncedQuery}&quot;</p>
      )}
      {matches.length > 0 && (
        <div className="mt-3 grid gap-2">
          {matches.slice(0, compact ? 5 : 20).map((m) => (
            <GrantCard key={`${m.funder}:${m.key}`} grant={m} compact={compact} />
          ))}
        </div>
      )}
    </div>
  );
}
