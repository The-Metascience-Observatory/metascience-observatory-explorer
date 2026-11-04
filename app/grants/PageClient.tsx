"use client";

import { apiFetch } from "@/lib/edge-challenge";
import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { GrantCard } from "@/components/GrantCard";
import { grantPath } from "@/lib/grant-id";
import type { GrantLookupResponse } from "@/lib/types";
import { Search, Loader2, ArrowLeft, Landmark } from "lucide-react";

function GrantsSearchContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") || "";

  const [query, setQuery] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
  const [response, setResponse] = useState<GrantLookupResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const performLookup = async (q: string) => {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/grants/lookup?q=${encodeURIComponent(q)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: GrantLookupResponse & { error?: string } = await res.json();
      if (data.error) throw new Error(data.error);
      // One unambiguous hit: go straight to it.
      if (data.matches.length === 1 && data.matches[0].exact) {
        router.push(grantPath(data.matches[0].funder, data.matches[0].key));
        return;
      }
      setResponse(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed");
      setResponse(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialQuery.length >= 3) performLookup(initialQuery);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q.length >= 3) {
      setSubmittedQuery(q);
      router.push(`/grants?q=${encodeURIComponent(q)}`, { scroll: false });
      performLookup(q);
    }
  };

  const exact = response?.matches.filter((m) => m.exact) ?? [];
  const related = response?.matches.filter((m) => !m.exact) ?? [];

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pb-8">
      <Link href="/" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-6">
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to search
      </Link>

      <form onSubmit={handleSubmit} className="mb-6">
        <div className="relative">
          {loading ? (
            <Loader2 className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 animate-spin" />
          ) : (
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
          )}
          <Input
            type="text"
            placeholder="Grant or award number, e.g. 5R25MH101072, AG066215, NSF-1907207 (press Enter)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-12 h-14 text-lg font-mono"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        {query.length > 0 && query.trim().length < 3 && (
          <p className="text-sm text-gray-500 mt-2">Type at least 3 characters</p>
        )}
      </form>

      {error && (
        <Card className="p-4 mb-6 border-red-200 bg-red-50">
          <p className="text-red-600">{error}</p>
        </Card>
      )}

      {response && !response.available && (
        <Card className="p-4 mb-6">
          <p className="text-gray-600">Grant lookup is not available on this server yet.</p>
        </Card>
      )}

      {response && response.available && !loading && (
        <div className="space-y-6">
          {response.matches.length === 0 && (
            <p className="text-gray-500">
              No grant found for &quot;{submittedQuery}&quot;
              {response.normalized && (
                <span className="text-sm">
                  {" "}
                  (looked up <span className="font-mono">{response.normalized.key}</span>
                  {response.normalized.serial && response.normalized.serial !== response.normalized.key && (
                    <>
                      {" "}and serial <span className="font-mono">{response.normalized.serial}</span>
                    </>
                  )}
                  )
                </span>
              )}
            </p>
          )}
          {exact.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                {exact.length === 1 ? "Match" : `${exact.length} matches across funders`}
              </h2>
              <div className="space-y-3">
                {exact.map((m) => (
                  <GrantCard key={`${m.funder}:${m.key}`} grant={m} />
                ))}
              </div>
            </div>
          )}
          {related.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                {exact.length > 0 ? "Same NIH project, other activity codes" : "Grants on this NIH serial number"}
              </h2>
              <div className="space-y-3">
                {related.map((m) => (
                  <GrantCard key={`${m.funder}:${m.key}`} grant={m} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {!submittedQuery && !loading && (
        <div className="text-center py-12 text-gray-500">
          <Landmark className="h-16 w-16 mx-auto mb-4 text-gray-300" />
          <p className="text-lg">Enter a grant number and press Enter</p>
          <p className="text-sm mt-2">NIH project numbers, NSF award ids, EU grant agreements, UKRI references and more</p>
        </div>
      )}
    </div>
  );
}

export default function GrantsSearchPage() {
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
      <GrantsSearchContent />
    </Suspense>
  );
}
