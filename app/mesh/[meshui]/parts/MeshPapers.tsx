"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { ListItemLink } from "@/components/ListItemLink";
import { PaperTitle } from "@/components/PaperTitle";
import { formatNumber } from "@/lib/utils";

interface MeshPaper {
  paperId: string;
  title: string;
  year: number;
  citedByCount: number;
  sourceName: string;
}

/**
 * Scroll-paginated sample of papers indexed under this term.
 *
 * Stays a client island: it is an unbounded, randomised list, so there is no
 * fixed first page worth server-rendering, and the crawlable link graph for
 * this term is already carried by the top-journals list and the parent/child
 * term links in the server-rendered infobox.
 */
export function MeshPapers({ meshUi }: { meshUi: string }) {
  const [papers, setPapers] = useState<MeshPaper[]>([]);
  const [loading, setLoading] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [initialLoad, setInitialLoad] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/mesh/${meshUi}/papers?offset=${offset}&limit=10`);
      if (res.ok) {
        const data = await res.json();
        setPapers((prev) => [...prev, ...data.papers]);
        setOffset((prev) => prev + data.papers.length);
        setHasMore(data.hasMore);
      }
    } catch (e) {
      console.error("Failed to load papers:", e);
    } finally {
      setLoading(false);
      setInitialLoad(false);
    }
  }, [meshUi, offset, loading, hasMore]);

  useEffect(() => {
    if (initialLoad) loadMore();
  }, [initialLoad, loadMore]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (container.scrollHeight - container.scrollTop - container.clientHeight < 100) {
        loadMore();
      }
    };
    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [loadMore]);

  if (initialLoad && loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        <span className="ml-2 text-sm text-gray-500">Loading papers...</span>
      </div>
    );
  }

  if (papers.length === 0) {
    return <p className="text-sm text-gray-500">No papers found.</p>;
  }

  return (
    <div ref={containerRef} className="space-y-2 max-h-[400px] overflow-y-auto">
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
      {loading && (
        <div className="flex items-center justify-center py-2">
          <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
          <span className="ml-2 text-xs text-gray-500">Loading more...</span>
        </div>
      )}
      {!hasMore && (
        <p className="text-center text-xs text-gray-400 py-2">End of results</p>
      )}
    </div>
  );
}
