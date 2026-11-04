"use client";

import { apiFetch } from "@/lib/edge-challenge";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PaperCard } from "@/components/PaperCard";
import { GrantCard } from "@/components/GrantCard";
import { GrantSourceBadges } from "@/components/GrantSourceBadges";
import type { GrantLookupResponse, GrantMatch, GrantPaperItem, GrantPapersResponse, GrantSummary } from "@/lib/types";
import {
  describeNihActivity,
  funderLabel,
  grantExternalUrl,
  type GrantSourceFilter,
} from "@/lib/grant-id";
import { formatNumber } from "@/lib/utils";
import { BROWSE_PAGE_SIZE } from "@/lib/constants";
import { ArrowLeft, ExternalLink, FileText, Landmark, Loader2, Calendar, Banknote, Building2, User } from "lucide-react";

interface Props {
  summary: GrantSummary;
}

/** Shape of one entry in the existing POST /api/grants batch response. */
interface GrantDetailsFallback {
  title: string | null;
  amount: number | null;
  start_date: string | null;
  end_date: string | null;
  pi_name: string | null;
  organization: string | null;
  url: string | null;
}

const FALLBACK_FUNDER_NAMES: Record<string, string> = {
  NIH: "National Institutes of Health",
  NSF: "National Science Foundation",
};

function formatYears(start: string | null, end: string | null): string | null {
  const s = start?.slice(0, 4);
  const e = end?.slice(0, 4);
  if (s && e) return s === e ? s : `${s}–${e}`;
  return s || e || null;
}

function formatAmount(amount: number | null, currency: string | null): string | null {
  if (!amount) return null;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${formatNumber(Math.round(amount))} ${currency || ""}`.trim();
  }
}

export default function GrantDetailClient({ summary }: Props) {
  const [source, setSource] = useState<GrantSourceFilter>("all");
  const [results, setResults] = useState<GrantPaperItem[]>([]);
  const [total, setTotal] = useState(summary.paper_count);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [related, setRelated] = useState<GrantMatch[]>([]);
  const [fallback, setFallback] = useState<GrantDetailsFallback | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const counts: Record<GrantSourceFilter, number> = {
    all: summary.paper_count,
    reported: summary.reported_count,
    acknowledged: summary.acknowledged_count,
  };

  const fetchPage = useCallback(
    async (src: GrantSourceFilter, from: number, append: boolean, markLoading = true) => {
      // markLoading=false on mount: `loading` already starts true, and setting
      // state synchronously inside an effect would re-render for nothing.
      if (append) setLoadingMore(true);
      else if (markLoading) setLoading(true);
      try {
        const params = new URLSearchParams({
          funder: summary.funder,
          key: summary.key,
          source: src,
          offset: String(from),
          limit: String(BROWSE_PAGE_SIZE),
        });
        const res = await apiFetch(`/api/grants/papers?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: GrantPapersResponse & { error?: string } = await res.json();
        if (data.error) throw new Error(data.error);
        setResults((prev) => (append ? [...prev, ...data.results] : data.results));
        setTotal(data.total);
        setHasMore(data.hasMore);
        setOffset(from + data.results.length);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load papers");
        if (!append) setResults([]);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [summary.funder, summary.key]
  );

  // First page on mount; the filter buttons fetch their own pages.
  useEffect(() => {
    fetchPage("all", 0, false, false);
  }, [fetchPage]);

  const changeSource = (src: GrantSourceFilter) => {
    if (src === source) return;
    setSource(src);
    fetchPage(src, 0, false);
  };

  // Sibling grants on the same NIH serial (other activity codes / serial-only rows).
  useEffect(() => {
    const q = summary.serial ?? (summary.funder === "NIH" ? null : summary.key);
    if (!q) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch(`/api/grants/lookup?q=${encodeURIComponent(q)}`);
        if (!res.ok) return;
        const data: GrantLookupResponse = await res.json();
        if (cancelled) return;
        setRelated(data.matches.filter((m) => !(m.funder === summary.funder && m.key === summary.key)));
      } catch {
        // related list is a nicety
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [summary.funder, summary.key, summary.serial]);

  // No local title: ask the funder's API through the cached batch endpoint.
  useEffect(() => {
    const funderName = FALLBACK_FUNDER_NAMES[summary.funder];
    if (summary.title || !funderName) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/grants", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ grants: [{ award_id: summary.display, funder: funderName }] }),
        });
        if (!res.ok) return;
        const data: { grants?: GrantDetailsFallback[] } = await res.json();
        const first = data.grants?.[0];
        if (!cancelled && first && (first.title || first.pi_name || first.organization)) setFallback(first);
      } catch {
        // header simply stays without a title
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [summary.funder, summary.display, summary.title]);

  const loadMore = useCallback(() => {
    if (loadingMore || loading || !hasMore) return;
    fetchPage(source, offset, true);
  }, [loadingMore, loading, hasMore, fetchPage, source, offset]);

  useEffect(() => {
    if (loading) return;
    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) loadMore();
      },
      { threshold: 0.1 }
    );
    if (loadMoreRef.current) observerRef.current.observe(loadMoreRef.current);
    return () => observerRef.current?.disconnect();
  }, [loading, hasMore, loadingMore, loadMore]);

  const title = summary.title
    ? summary.acronym
      ? `${summary.acronym}: ${summary.title}`
      : summary.title
    : fallback?.title || null;
  const years = formatYears(summary.start_date, summary.end_date) || formatYears(fallback?.start_date ?? null, fallback?.end_date ?? null);
  const amount = formatAmount(summary.funded_amount, summary.currency) || formatAmount(fallback?.amount ?? null, "USD");
  const external = grantExternalUrl(summary.funder, summary.key, summary.display) || fallback?.url || null;
  const activity = summary.funder === "NIH" ? describeNihActivity(summary.activity) : null;
  const otherSpellings = summary.raw_ids.filter((r) => r.toUpperCase() !== summary.display.toUpperCase()).slice(0, 4);

  const filters: Array<{ value: GrantSourceFilter; label: string; hint: string }> = [
    { value: "all", label: "All linked papers", hint: "Every paper any source links to this grant" },
    { value: "reported", label: "Reported by the funder", hint: "NIH RePORTER / NSF publication links (via SciSciNet)" },
    { value: "acknowledged", label: "Acknowledged in the paper", hint: "PubMed grant field and OpenAIRE Graph project links" },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
      <Link href="/grants" className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to grant search
      </Link>

      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="p-2 bg-gray-100 dark:bg-gray-800 rounded-sm">
              <Landmark className="h-6 w-6 text-gray-600 dark:text-gray-400" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-2xl font-mono">{summary.display}</CardTitle>
                <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 rounded-sm">
                  {funderLabel(summary.funder)}
                </span>
                {activity && <span className="text-sm text-gray-500">{activity}</span>}
                {external && (
                  <a
                    href={external}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:text-blue-800 inline-flex items-center gap-1"
                  >
                    Funder record <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              {title && <p className="mt-2 text-lg text-gray-800 dark:text-gray-200">{title}</p>}
              <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-sm text-gray-600 dark:text-gray-400">
                {years && (
                  <span className="inline-flex items-center gap-1">
                    <Calendar className="h-4 w-4" /> {years}
                  </span>
                )}
                {amount && (
                  <span className="inline-flex items-center gap-1" title="Funded amount; NIH budget years are summed">
                    <Banknote className="h-4 w-4" /> {amount}
                  </span>
                )}
                {fallback?.pi_name && (
                  <span className="inline-flex items-center gap-1">
                    <User className="h-4 w-4" /> {fallback.pi_name}
                  </span>
                )}
                {fallback?.organization && (
                  <span className="inline-flex items-center gap-1">
                    <Building2 className="h-4 w-4" /> {fallback.organization}
                  </span>
                )}
                {summary.funding_stream && <span>{summary.funding_stream}</span>}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-sm text-gray-600 dark:text-gray-400">
                <span className="inline-flex items-center gap-1">
                  <FileText className="h-4 w-4" /> {formatNumber(summary.paper_count)} linked papers
                </span>
                {summary.first_year && summary.last_year && (
                  <span>
                    published {summary.first_year}
                    {summary.last_year !== summary.first_year ? `–${summary.last_year}` : ""}
                  </span>
                )}
                <GrantSourceBadges sources={summary.sources} size="sm" />
              </div>
              {otherSpellings.length > 0 && (
                <p className="mt-2 text-xs text-gray-400">
                  Also written as {otherSpellings.map((r) => <span key={r} className="font-mono mr-2">{r}</span>)}
                </p>
              )}
            </div>
          </div>
        </CardHeader>
      </Card>

      {related.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            {summary.funder === "NIH" ? "Same NIH project, other activity codes" : "Same number under other funders"}
          </h2>
          <div className="grid gap-2 md:grid-cols-2">
            {related.map((m) => (
              <GrantCard key={`${m.funder}:${m.key}`} grant={m} compact />
            ))}
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Linked papers</CardTitle>
          <div className="flex flex-wrap gap-2 mt-2" role="tablist" aria-label="Link source">
            {filters.map((f) => {
              const active = source === f.value;
              return (
                <button
                  key={f.value}
                  role="tab"
                  aria-selected={active}
                  title={f.hint}
                  onClick={() => changeSource(f.value)}
                  className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                    active
                      ? "bg-gray-900 text-white border-gray-900 dark:bg-gray-100 dark:text-gray-900 dark:border-gray-100"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50 dark:bg-gray-900 dark:text-gray-300 dark:border-gray-700"
                  }`}
                >
                  {f.label}
                  <span className="ml-1.5 tabular-nums opacity-70">{formatNumber(counts[f.value])}</span>
                </button>
              );
            })}
          </div>
        </CardHeader>
        <CardContent>
          {error && (
            <Card className="p-4 mb-4 border-red-200 bg-red-50">
              <p className="text-red-600">{error}</p>
            </Card>
          )}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              <span className="ml-2 text-gray-500">Loading papers...</span>
            </div>
          ) : results.length === 0 ? (
            <p className="text-gray-500 py-6 text-center">No papers from this source.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-500">
                {formatNumber(total)} paper{total === 1 ? "" : "s"}, most cited first
              </p>
              {results.map((p) => (
                <div key={p.paperid}>
                  <PaperCard paper={p} />
                  <div className="mt-1 pl-1">
                    <GrantSourceBadges sources={p.sources} />
                  </div>
                </div>
              ))}
              <div ref={loadMoreRef} className="py-4">
                {loadingMore && (
                  <div className="flex items-center justify-center">
                    <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                    <span className="ml-2 text-sm text-gray-500">Loading more...</span>
                  </div>
                )}
                {!hasMore && results.length > 0 && (
                  <p className="text-center text-sm text-gray-500">Showing all {formatNumber(results.length)} papers</p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
