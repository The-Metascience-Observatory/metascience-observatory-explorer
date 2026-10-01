"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Search, Loader2, ArrowLeft, BookOpen, ExternalLink } from "lucide-react";

interface JournalSearchResult {
  sourceid: string;
  display_name: string;
  issn: string | null;
  publisher: string | null;
  homepage_url: string | null;
  is_oa: boolean | null;
  total_papers: number | null;
  total_citations: number | null;
  first_year: number | null;
  last_year: number | null;
  primary_field_l0_name: string | null;
}

interface SearchResponse {
  results: JournalSearchResult[];
  total?: number;
  message?: string;
  error?: string;
}

function JournalsSearchContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") || "";

  const [query, setQuery] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
  const [results, setResults] = useState<JournalSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        `/api/journals/search?q=${encodeURIComponent(searchQuery)}`
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
      router.push(`/journals?q=${encodeURIComponent(query)}`, { scroll: false });
      performSearch(query);
    }
  };

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

      {/* Header lives in the server component (app/journals/page.tsx). */}

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
            placeholder="Search journals by name, ISSN, or publisher... (press Enter)"
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
              Found <span className="font-semibold">{results.length}</span> journals
              matching &quot;{submittedQuery}&quot;
            </p>
          ) : (
            <p className="text-gray-500">
              No journals found matching &quot;{submittedQuery}&quot;
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
          {results.map((journal) => (
            <Card key={journal.sourceid} className="p-4 hover:bg-gray-50 transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/journals/${journal.sourceid}`}
                    className="text-lg font-medium text-blue-600 hover:underline line-clamp-2"
                  >
                    {journal.display_name}
                  </Link>

                  <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
                    {journal.publisher && (
                      <span>{journal.publisher}</span>
                    )}
                    {journal.issn && (
                      <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">
                        ISSN: {journal.issn}
                      </span>
                    )}
                    {journal.is_oa && (
                      <span className="text-green-600 font-medium">Open Access</span>
                    )}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
                    {journal.total_papers != null && (
                      <span>{journal.total_papers.toLocaleString()} papers</span>
                    )}
                    {journal.total_citations != null && (
                      <span>{journal.total_citations.toLocaleString()} citations</span>
                    )}
                    {journal.first_year && journal.last_year && (
                      <span>{journal.first_year}–{journal.last_year}</span>
                    )}
                    {journal.primary_field_l0_name && (
                      <span className="text-gray-500">{journal.primary_field_l0_name}</span>
                    )}
                  </div>
                </div>

                {journal.homepage_url && (
                  <a
                    href={journal.homepage_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 p-2 text-gray-400 hover:text-gray-600"
                    title="Visit journal website"
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
          <BookOpen className="h-16 w-16 mx-auto mb-4 text-gray-300" />
          <p className="text-lg">Enter a search term and press Enter</p>
          <p className="text-sm mt-2">
            Search for journals by name, ISSN, or publisher
          </p>
          <Link
            href="/journals/top"
            className="inline-block mt-4 text-blue-600 hover:underline"
          >
            Or browse top journals by citation count
          </Link>
        </div>
      )}
    </div>
  );
}

export default function JournalsSearchPage() {
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
      <JournalsSearchContent />
    </Suspense>
  );
}
