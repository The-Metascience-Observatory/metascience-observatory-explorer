"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PublicationsChart } from "@/components/PublicationsChart";
import { ListItemLink } from "@/components/ListItemLink";
import { PaperTitle } from "@/components/PaperTitle";
import type { MeshDetails } from "@/lib/types";
import { formatNumber } from "@/lib/utils";
import { Loader2, ExternalLink, ChevronRight, ChevronDown } from "lucide-react";

interface MeshPaper {
  paperId: string;
  title: string;
  year: number;
  citedByCount: number;
  sourceName: string;
}

export default function MeshDetailPage() {
  const params = useParams();
  const meshui = params.meshui as string;

  const [data, setData] = useState<MeshDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Random papers state with infinite scroll
  const [papers, setPapers] = useState<MeshPaper[]>([]);
  const [papersLoading, setPapersLoading] = useState(false);
  const [papersOffset, setPapersOffset] = useState(0);
  const [hasMorePapers, setHasMorePapers] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);
  const papersContainerRef = useRef<HTMLDivElement>(null);

  // Show/hide narrower terms
  const [showChildTerms, setShowChildTerms] = useState(false);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/mesh/${meshui}`);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const json = await res.json();
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load MeSH term");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [meshui]);

  // Load papers with infinite scroll
  const loadMorePapers = useCallback(async () => {
    if (papersLoading || !hasMorePapers) return;
    setPapersLoading(true);
    try {
      const res = await fetch(`/api/mesh/${meshui}/papers?offset=${papersOffset}&limit=10`);
      if (res.ok) {
        const data = await res.json();
        setPapers((prev) => [...prev, ...data.papers]);
        setPapersOffset((prev) => prev + data.papers.length);
        setHasMorePapers(data.hasMore);
      }
    } catch (e) {
      console.error("Failed to load papers:", e);
    } finally {
      setPapersLoading(false);
      setInitialLoad(false);
    }
  }, [meshui, papersOffset, papersLoading, hasMorePapers]);

  // Initial papers load
  useEffect(() => {
    if (!loading && data && initialLoad) {
      loadMorePapers();
    }
  }, [loading, data, initialLoad, loadMorePapers]);

  // Infinite scroll handler for papers container
  useEffect(() => {
    const container = papersContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (
        container.scrollHeight - container.scrollTop - container.clientHeight < 100
      ) {
        loadMorePapers();
      }
    };
    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [loadMorePapers]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          <span className="ml-3 text-gray-500">Loading MeSH term...</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="text-center py-24">
          <p className="text-red-600 text-lg">{error || "MeSH term not found"}</p>
        </div>
      </div>
    );
  }

  const { summary, yearlyStats, topJournals, parentTerms, childTerms } = data;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
      {/* Top row: Infobox left, Chart right */}
      <div className="grid lg:grid-cols-[352px_1fr] gap-8 mb-8">
        {/* Left: Infobox */}
        <Card>
          <CardContent className="pt-6">
            {/* Parent terms breadcrumb */}
            {parentTerms.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 text-xs text-gray-500 mb-2">
                {parentTerms.map((parent, idx) => (
                  <span key={parent.meshUi} className="flex items-center">
                    <Link
                      href={`/mesh/${parent.meshUi}`}
                      className="hover:text-blue-600 hover:underline"
                    >
                      {parent.meshName}
                    </Link>
                    {idx < parentTerms.length - 1 && (
                      <ChevronRight className="h-3 w-3 mx-0.5 text-gray-400" />
                    )}
                  </span>
                ))}
                <ChevronRight className="h-3 w-3 mx-0.5 text-gray-400" />
              </div>
            )}

            <h1 className="text-lg font-bold mb-3 leading-tight">
              {summary.meshName}
            </h1>

            <p className="text-xs text-gray-400 mb-4">
              MeSH Descriptor: {summary.meshUi}
            </p>

            {/* Scope note / definition */}
            {summary.scopeNote && (
              <div className="mb-4">
                <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                  {summary.scopeNote}
                </p>
              </div>
            )}

            {/* Key stats */}
            <div className="space-y-3 mb-6">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Papers</span>
                <span className="font-semibold">{formatNumber(summary.totalPapers)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Total Citations</span>
                <span className="font-semibold">{formatNumber(summary.totalCitations)}</span>
              </div>
            </div>

            {/* Child/narrower terms */}
            {childTerms.length > 0 && (
              <div className="border-t pt-4 mb-4">
                <button
                  onClick={() => setShowChildTerms(!showChildTerms)}
                  className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 uppercase tracking-wide mb-2"
                >
                  <ChevronDown
                    className={`h-3 w-3 transition-transform ${showChildTerms ? "" : "-rotate-90"}`}
                  />
                  Narrower Terms / Child Terms ({childTerms.length})
                </button>
                {showChildTerms && (
                  <div className="flex flex-wrap gap-1.5">
                    {childTerms.slice(0, 10).map((child) => (
                      <Link
                        key={child.meshUi}
                        href={`/mesh/${child.meshUi}`}
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                      >
                        {child.meshName}
                      </Link>
                    ))}
                    {childTerms.length > 10 && (
                      <span className="inline-flex items-center px-2 py-0.5 text-xs text-gray-400">
                        +{childTerms.length - 10} more
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* External link to NLM MeSH Browser */}
            <div className="border-t pt-4">
              <a
                href={`https://meshb.nlm.nih.gov/record/ui?ui=${summary.meshUi}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
              >
                View in NLM MeSH Browser
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </CardContent>
        </Card>

        {/* Right: Publications per year chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Publications Per Year</CardTitle>
          </CardHeader>
          <CardContent>
            <PublicationsChart data={yearlyStats} />
          </CardContent>
        </Card>
      </div>

      {/* Bottom row: Top Journals left (same width as infobox), Random Papers right */}
      <div className="grid lg:grid-cols-[352px_1fr] gap-8">
        {/* Top Journals */}
        <Card className="flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Top Journals ({topJournals.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden">
            {topJournals.length > 0 ? (
              <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
                {topJournals.map((journal, idx) => (
                  <Link
                    key={journal.sourceid}
                    href={`/journals/${journal.sourceid}`}
                    className="flex items-center justify-between gap-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 rounded px-1 py-0.5 -mx-1"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs text-gray-400 w-5 text-right flex-shrink-0">
                        {idx + 1}.
                      </span>
                      <span className="truncate text-gray-700 dark:text-gray-300">
                        {journal.sourceName}
                      </span>
                    </div>
                    <span className="text-xs text-gray-400 flex-shrink-0">
                      {formatNumber(journal.paperCount)}
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No journals found.</p>
            )}
          </CardContent>
        </Card>

        {/* Random Papers */}
        <Card className="flex flex-col">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Random Papers</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden">
            {initialLoad && papersLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                <span className="ml-2 text-sm text-gray-500">Loading papers...</span>
              </div>
            ) : papers.length === 0 ? (
              <p className="text-sm text-gray-500">No papers found.</p>
            ) : (
              <div
                ref={papersContainerRef}
                className="space-y-2 max-h-[400px] overflow-y-auto"
              >
                {papers.map((paper) => (
                  <ListItemLink key={paper.paperId} href={`/papers/${paper.paperId}`}>
                    <div className="flex flex-col gap-0.5">
                      <PaperTitle title={paper.title} className="text-sm line-clamp-2" />
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span>{paper.year}</span>
                        <span>·</span>
                        <span className="truncate max-w-[200px]">{paper.sourceName}</span>
                        <span>·</span>
                        <span>{formatNumber(paper.citedByCount)} citations</span>
                      </div>
                    </div>
                  </ListItemLink>
                ))}
                {papersLoading && (
                  <div className="flex items-center justify-center py-2">
                    <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                    <span className="ml-2 text-xs text-gray-500">Loading more...</span>
                  </div>
                )}
                {!hasMorePapers && papers.length > 0 && (
                  <p className="text-center text-xs text-gray-400 py-2">
                    End of results
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
