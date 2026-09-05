"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Search, Loader2, ArrowLeft, Building2, ExternalLink } from "lucide-react";

interface AffiliationSearchResult {
  institution_id: string;
  display_name: string;
  country_code: string | null;
  type: string | null;
  ror: string | null;
  homepage_url: string | null;
  h_index: number | null;
  productivity: number | null;
  total_citations: number | null;
  researcher_count: number | null;
  first_year: number | null;
  last_year: number | null;
}

interface SearchResponse {
  results: AffiliationSearchResult[];
  total?: number;
  message?: string;
  error?: string;
}

function AffiliationsSearchContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") || "";

  const [query, setQuery] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
  const [results, setResults] = useState<AffiliationSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);

  // Load total affiliation count on mount
  useEffect(() => {
    async function loadCount() {
      try {
        const res = await fetch("/api/affiliations/search");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await res.json();
      } catch (e) {
        console.error("Failed to load affiliation count:", e);
      } finally {
        setInitialLoading(false);
      }
    }
    loadCount();
  }, []);

  // Run initial search if query param exists
  useEffect(() => {
    if (initialQuery && initialQuery.length >= 2) {
      performSearch(initialQuery);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Perform search
  const performSearch = async (searchQuery: string) => {
    if (!searchQuery || searchQuery.length < 2) {
      setResults([]);
      return;
    }

    setLoading(true);

    try {
      const res = await fetch(
        `/api/affiliations/search?q=${encodeURIComponent(searchQuery)}`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: SearchResponse = await res.json();

      if (data.error) {
        throw new Error(data.error);
      }

      setResults(data.results || []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed");
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  // Handle form submission
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.length >= 2) {
      setSubmittedQuery(query);
      router.push(`/affiliations?q=${encodeURIComponent(query)}`, { scroll: false });
      performSearch(query);
    }
  };

  // Format institution type for display
  const formatType = (type: string | null) => {
    if (!type) return null;
    return type.charAt(0).toUpperCase() + type.slice(1).replace(/_/g, " ");
  };

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

      {/* Header lives in the server component (app/affiliations/page.tsx). */}

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
            placeholder="Search institutions by name, country code, or type... (press Enter)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-12 h-14 text-lg"
          />
        </div>
        {query.length > 0 && query.length < 2 && (
          <p className="text-sm text-gray-500 mt-2">
            Type at least 2 characters to search
          </p>
        )}
      </form>

      {/* Error */}
      {error && (
        <Card className="p-4 mb-6 border-red-200 bg-red-50">
          <p className="text-red-600">{error}</p>
        </Card>
      )}

      {/* Results count */}
      {submittedQuery && !loading && (
        <div className="mb-4">
          {results.length > 0 ? (
            <p className="text-gray-600">
              Found <span className="font-semibold">{results.length}</span> institutions
              matching &quot;{submittedQuery}&quot;
            </p>
          ) : (
            <p className="text-gray-500">
              No institutions found matching &quot;{submittedQuery}&quot;
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
          {results.map((affiliation) => (
            <Card key={affiliation.institution_id} className="p-4 hover:bg-gray-50 transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/affiliations/${affiliation.institution_id}`}
                    className="text-lg font-medium text-blue-600 hover:underline line-clamp-2"
                  >
                    {affiliation.display_name}
                  </Link>

                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                    {affiliation.country_code && (
                      <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                        {affiliation.country_code}
                      </span>
                    )}
                    {affiliation.type && (
                      <span>{formatType(affiliation.type)}</span>
                    )}
                    {affiliation.ror && (
                      <a
                        href={`https://ror.org/${affiliation.ror}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:underline"
                      >
                        ROR
                      </a>
                    )}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
                    {affiliation.h_index != null && (
                      <span>h-index: {affiliation.h_index}</span>
                    )}
                    {affiliation.researcher_count != null && (
                      <span>{affiliation.researcher_count.toLocaleString()} researchers</span>
                    )}
                    {affiliation.total_citations != null && (
                      <span>{affiliation.total_citations.toLocaleString()} citations</span>
                    )}
                    {affiliation.first_year && affiliation.last_year && (
                      <span>{affiliation.first_year}–{affiliation.last_year}</span>
                    )}
                  </div>
                </div>

                {affiliation.homepage_url && (
                  <a
                    href={affiliation.homepage_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 p-2 text-gray-400 hover:text-gray-600"
                    title="Visit institution website"
                  >
                    <ExternalLink className="h-5 w-5" />
                  </a>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Empty state (no search yet) */}
      {!submittedQuery && !loading && (
        <div className="text-center py-12 text-gray-500">
          <Building2 className="h-16 w-16 mx-auto mb-4 text-gray-300" />
          <p className="text-lg">Enter a search term and press Enter</p>
          <p className="text-sm mt-2">
            Search for institutions by name, country code (e.g., US, UK), or type (e.g., university)
          </p>
        </div>
      )}
    </div>
  );
}

export default function AffiliationsSearchPage() {
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
      <AffiliationsSearchContent />
    </Suspense>
  );
}
