"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import { sanitizeInlineHtml } from "@/lib/sanitize";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PaperCitationsChart, CitationViewMode } from "@/components/PaperCitationsChart";
import { ListItemLink } from "@/components/ListItemLink";
import { PaperListCard } from "@/components/PaperListCard";
import type {
  PaperDetails,
  PaperCitation,
  MeshTerm,
  OpenaireRelatedPaper,
  OpenaireCitationsResponse,
  PaperOpenaireResponse,
  PaperItem,
} from "@/lib/types";
import { mergeSortedCitations } from "@/lib/merge-citations";
import { formatNumber } from "@/lib/utils";
import {
  OpenAccessBadges,
  OpenaireFundingSection,
  OpenaireLinkedProductsSection,
} from "@/components/OpenairePanels";
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  FlaskConical,
  Download,
  Copy,
  Check,
  FileText,
  Newspaper,
} from "lucide-react";
import { cleanDoi, formatDocType, formatPatentId, getLanguageName, getPatentUrl } from "@/lib/format";
import { EDGE_CAP } from "@/lib/constants";


// Escape special LaTeX characters in BibTeX fields
function escapeBibtex(text: string): string {
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/[&%$#_{}]/g, (match) => '\\' + match)
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

// Generate a citation key from author names and year
function generateCiteKey(authors: { display_name: string | null }[], year: number | null): string {
  if (authors.length === 0) return `unknown${year || ''}`;
  const firstAuthor = authors[0].display_name || 'unknown';
  // Get last name (last word of display name)
  const lastName = firstAuthor.split(/\s+/).pop()?.toLowerCase().replace(/[^a-z]/g, '') || 'unknown';
  return `${lastName}${year || ''}`;
}

// Sanitize HTML to only allow safe formatting tags (i, b, em, strong, sub, sup)
// DOMPurify is browser-only: it silently returns an empty string on the
// server, which blanked the <h1> during SSR. lib/sanitize.ts implements the
// same allowlist (i b em strong sub sup, no attributes) in a way that works in
// both environments.
function sanitizeHtml(html: string): string {
  return sanitizeInlineHtml(html);
}

/**
 * Interactive shell for the paper page.
 *
 * `initialData` arrives as a prop from the server component instead of a
 * useEffect fetch. With no loading gate this tree renders into the initial
 * HTML, so a crawler sees the title, authors, journal, references and the
 * first page of citing papers. The remaining panels (abstract, PubMed/patent
 * extras, retraction notice, OpenAIRE) stay client-fetched: each reads a
 * different multi-GB database and none is needed for indexing.
 */
export default function PaperDetailClient({
  data: initialData,
  paperid,
}: {
  data: PaperDetails;
  paperid: string;
}) {
  const data = initialData;
  const [showAllAuthors, setShowAllAuthors] = useState(false);
  const [showAllFields, setShowAllFields] = useState(false);
  const [showBibtex, setShowBibtex] = useState(false);
  const [copied, setCopied] = useState(false);
  const [biblioData, setBiblioData] = useState<{
    volume?: string;
    issue?: string;
    first_page?: string;
    last_page?: string;
  } | null>(null);
  const [biblioLoading, setBiblioLoading] = useState(false);
  const [citationViewMode, setCitationViewMode] = useState<CitationViewMode>("yearly");

  // Abstract state (lazy loaded)
  const [abstract, setAbstract] = useState<string | null>(null);
  const [abstractLanguage, setAbstractLanguage] = useState<string | null>(null);
  const [abstractLoading, setAbstractLoading] = useState(true);
  const [showFullAbstract, setShowFullAbstract] = useState(false);
  const [isAbstractClamped, setIsAbstractClamped] = useState(false);
  const abstractRef = useRef<HTMLParagraphElement>(null);

  // Extra paper data state (lazy loaded: newsfeed, PMID/PMCID, metadata, patents)
  const [newsfeed, setNewsfeed] = useState<Array<{ url: string; timestamp: string }>>([]);
  const [pubmed, setPubmed] = useState<{ pmid: number | null; pmcid: number | null } | null>(null);
  const [metadata, setMetadata] = useState<{
    publicationDate: string | null;
    docType: string | null;
    openalexCitedByCount: number | null;
    isRetracted: boolean;
    isParatext: boolean;
    language: string | null;
  } | null>(null);
  const [extraPatents, setExtraPatents] = useState<Array<{ patent: string; isUspto: boolean }>>([]);
  const [extraLoading, setExtraLoading] = useState(true);

  // Retraction Watch data state
  const [retractionData, setRetractionData] = useState<{
    recordId: number;
    retractionDate: string | null;
    retractionDoi: string | null;
    retractionNature: string;
    reasons: string[];
    notes: string | null;
  } | null>(null);
  const [retractionLoading, setRetractionLoading] = useState(true);

  // MeSH terms state (lazy loaded)
  const [meshTerms, setMeshTerms] = useState<MeshTerm[]>([]);
  const [meshLoading, setMeshLoading] = useState(true);
  const [showAllMesh, setShowAllMesh] = useState(false);

  // OpenAIRE enrichment state (OA status, funding, linked datasets/software)
  const [openaireData, setOpenaireData] = useState<PaperOpenaireResponse | null>(null);
  const [openaireLoading, setOpenaireLoading] = useState(true);
  // Citing papers known only to the OpenAIRE Graph. Disjoint from paper_citations
  // by construction, so they merge into "Cited By" without any dedupe.
  const [openaireCitations, setOpenaireCitations] = useState<OpenaireRelatedPaper[]>([]);
  const [openaireCitationsTotal, setOpenaireCitationsTotal] = useState(0);
  const [openaireCitationsLoading, setOpenaireCitationsLoading] = useState(false);
  const [hasMoreOpenaireCitations, setHasMoreOpenaireCitations] = useState(false);
  // Distinguishes "no OpenAIRE citations" from "page 1 hasn't landed yet".
  const [openaireCitationsFetched, setOpenaireCitationsFetched] = useState(false);

  // Infinite scroll state for citations
  const [displayedCitations, setDisplayedCitations] = useState<PaperCitation[]>([]);
  const [citationsLoading, setCitationsLoading] = useState(false);
  const [hasMoreCitations, setHasMoreCitations] = useState(false);
  const [citationsTotal, setCitationsTotal] = useState(0);
  const citationsEndRef = useRef<HTMLDivElement>(null);
  const citationsContainerRef = useRef<HTMLDivElement>(null);
  // `if (loading) return; setLoading(true)` is not a synchronous latch — under
  // StrictMode two calls in the same tick both pass it. These are.
  const citationsInFlight = useRef(false);
  const openaireCitationsInFlight = useRef(false);

  // Citations pagination is seeded from the server-rendered data.
  useEffect(() => {
    setDisplayedCitations(initialData.citations || []);
    const total = initialData.citationsTotal || initialData.citations?.length || 0;
    setCitationsTotal(total);
    setHasMoreCitations(
      (initialData.citations?.length || 0) < Math.min(total, EDGE_CAP)
    );
  }, [initialData]);

  // Lazy load abstract
  useEffect(() => {
    async function fetchAbstract() {
      try {
        const res = await fetch(`/api/papers/${paperid}/abstract`);
        if (res.ok) {
          const data = await res.json();
          setAbstract(data.abstract);
          setAbstractLanguage(data.language);
        }
      } catch (e) {
        console.error("Failed to fetch abstract:", e);
      } finally {
        setAbstractLoading(false);
      }
    }
    fetchAbstract();
  }, [paperid]);

  // Detect if abstract is actually clamped (text overflows)
  useEffect(() => {
    if (!abstractRef.current || showFullAbstract) return;
    const el = abstractRef.current;
    setIsAbstractClamped(el.scrollHeight > el.clientHeight);
  }, [abstract, showFullAbstract]);

  // Lazy load extra data (newsfeed, PMID/PMCID, metadata, patents)
  useEffect(() => {
    async function fetchExtra() {
      try {
        const res = await fetch(`/api/papers/${paperid}/extra`);
        if (res.ok) {
          const data = await res.json();
          setNewsfeed(data.newsfeed || []);
          setPubmed(data.pubmed);
          setMetadata(data.metadata);
          setExtraPatents(data.patents || []);
        }
      } catch (e) {
        console.error("Failed to fetch extra data:", e);
      } finally {
        setExtraLoading(false);
      }
    }
    fetchExtra();
  }, [paperid]);

  // Lazy load Retraction Watch data
  useEffect(() => {
    async function fetchRetraction() {
      try {
        const res = await fetch(`/api/papers/${paperid}/retraction`);
        if (res.ok) {
          const data = await res.json();
          setRetractionData(data.retraction);
        }
      } catch (e) {
        console.error("Failed to fetch retraction data:", e);
      } finally {
        setRetractionLoading(false);
      }
    }
    fetchRetraction();
  }, [paperid]);

  // Lazy load OpenAIRE enrichment (OA status, funding, linked products)
  useEffect(() => {
    async function fetchOpenaire() {
      try {
        const res = await fetch(`/api/papers/${paperid}/openaire`);
        if (res.ok) {
          setOpenaireData(await res.json());
        }
      } catch (e) {
        console.error("Failed to fetch OpenAIRE data:", e);
      } finally {
        setOpenaireLoading(false);
      }
    }
    fetchOpenaire();
  }, [paperid]);

  // Lazy load citing papers that exist only in the OpenAIRE Graph. They are
  // disjoint from paper_citations by construction, so they merge straight into
  // "Cited By" — see lib/merge-citations.ts.
  useEffect(() => {
    let cancelled = false;
    setOpenaireCitations([]);
    setOpenaireCitationsTotal(0);
    setHasMoreOpenaireCitations(false);
    setOpenaireCitationsFetched(false);

    async function fetchOpenaireCitations() {
      try {
        const res = await fetch(`/api/papers/${paperid}/openaire-citations`);
        if (res.ok) {
          const json: OpenaireCitationsResponse = await res.json();
          if (cancelled) return;
          const batch = json.citations ?? [];
          setOpenaireCitations(batch);
          setOpenaireCitationsTotal(json.total ?? 0);
          setHasMoreOpenaireCitations(
            batch.length > 0 &&
              Boolean(json.hasMore) &&
              batch.length < EDGE_CAP
          );
        }
      } catch (e) {
        console.error("Failed to fetch OpenAIRE citations:", e);
      } finally {
        // Always flip, even on failure: the merge waits on this before it will
        // emit anything, so a stuck flag would leave "Cited By" empty forever.
        if (!cancelled) setOpenaireCitationsFetched(true);
      }
    }
    fetchOpenaireCitations();
    return () => {
      cancelled = true;
    };
  }, [paperid]);

  // Lazy load MeSH terms (waits for extra data to get PMID if available)
  useEffect(() => {
    if (extraLoading) return;
    async function fetchMesh() {
      try {
        const pmid = pubmed?.pmid;
        const url = pmid
          ? `/api/papers/${paperid}/mesh?pmid=${pmid}`
          : `/api/papers/${paperid}/mesh`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          setMeshTerms(data.meshTerms || []);
        }
      } catch (e) {
        console.error("Failed to fetch MeSH terms:", e);
      } finally {
        setMeshLoading(false);
      }
    }
    fetchMesh();
  }, [paperid, extraLoading, pubmed]);

  // Load more SciSciNet citations. Offsets come from the raw buffer, never from
  // the merged list — that one is a slice of two streams.
  const loadMoreCitations = useCallback(async () => {
    if (citationsInFlight.current || !hasMoreCitations) return;
    citationsInFlight.current = true;
    setCitationsLoading(true);
    try {
      const offset = displayedCitations.length;
      const remaining = Math.min(EDGE_CAP, citationsTotal) - offset;
      if (remaining <= 0) {
        setHasMoreCitations(false);
        return;
      }
      const limit = Math.min(100, remaining);

      const res = await fetch(`/api/papers/${paperid}/citations?offset=${offset}&limit=${limit}`);
      if (res.ok) {
        const data = await res.json();
        const batch: PaperCitation[] = data.citations ?? [];
        setDisplayedCitations((prev) => [...prev, ...batch]);
        // A zero-row page that still claims hasMore would re-arm the observer
        // forever, so treat it as the end.
        setHasMoreCitations(
          batch.length > 0 &&
            Boolean(data.hasMore) &&
            offset + batch.length < EDGE_CAP
        );
      }
    } catch (e) {
      console.error('Failed to load more citations:', e);
    } finally {
      citationsInFlight.current = false;
      setCitationsLoading(false);
    }
  }, [paperid, displayedCitations.length, hasMoreCitations, citationsTotal]);

  const loadMoreOpenaireCitations = useCallback(async () => {
    if (openaireCitationsInFlight.current || !hasMoreOpenaireCitations) return;
    openaireCitationsInFlight.current = true;
    setOpenaireCitationsLoading(true);
    try {
      const offset = openaireCitations.length;
      const remaining = EDGE_CAP - offset;
      if (remaining <= 0) {
        setHasMoreOpenaireCitations(false);
        return;
      }
      const res = await fetch(
        `/api/papers/${paperid}/openaire-citations?offset=${offset}&limit=${Math.min(100, remaining)}`
      );
      if (res.ok) {
        const json: OpenaireCitationsResponse = await res.json();
        const batch = json.citations ?? [];
        setOpenaireCitations((prev) => [...prev, ...batch]);
        setHasMoreOpenaireCitations(
          batch.length > 0 &&
            Boolean(json.hasMore) &&
            offset + batch.length < EDGE_CAP
        );
      } else {
        setHasMoreOpenaireCitations(false);
      }
    } catch (e) {
      console.error("Failed to load more OpenAIRE citations:", e);
      setHasMoreOpenaireCitations(false);
    } finally {
      openaireCitationsInFlight.current = false;
      setOpenaireCitationsLoading(false);
    }
  }, [paperid, openaireCitations.length, hasMoreOpenaireCitations]);

  const sciCitationItems = useMemo<PaperItem[]>(
    () =>
      displayedCitations.map((cit) => ({
        paperid: cit.citing_paperid,
        title: cit.citing_title,
        year: cit.citing_year,
        cited_by_count: cit.citing_cited_by_count,
      })),
    [displayedCitations]
  );

  // The OpenAIRE stream is not "done" until its first page lands, so the merge
  // holds everything back until it can rank the two together. Painting the
  // SciSciNet rows early instead would let a top-ranked OpenAIRE page displace
  // rows the reader is already looking at.
  const mergedCitations = useMemo(
    () =>
      mergeSortedCitations(
        sciCitationItems,
        !hasMoreCitations,
        openaireCitations,
        openaireCitationsFetched && !hasMoreOpenaireCitations
      ),
    [
      sciCitationItems,
      hasMoreCitations,
      openaireCitations,
      openaireCitationsFetched,
      hasMoreOpenaireCitations,
    ]
  );

  // One sentinel drives both streams. Each loader self-guards on its own
  // hasMore/in-flight, so firing both is cheaper than deciding which is short.
  const loadMoreMergedCitations = useCallback(() => {
    void loadMoreCitations();
    void loadMoreOpenaireCitations();
  }, [loadMoreCitations, loadMoreOpenaireCitations]);

  // Intersection observer for infinite scroll. Re-subscribe when the loaders
  // change identity (that is what re-fires it while the sentinel stays in view)
  // and when the rendered list changes length — PaperListCard swaps between its
  // empty and populated branches, which remounts the sentinel we're observing.
  useEffect(() => {
    if (!citationsEndRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) loadMoreMergedCitations();
      },
      { threshold: 0.1, root: citationsContainerRef.current }
    );

    observer.observe(citationsEndRef.current);
    return () => observer.disconnect();
  }, [loadMoreMergedCitations, mergedCitations.length]);

  const { summary, authors, fields, references, citationHistory, trials, patents } = data;

  // Deduplicate authors by authorid (an author can have multiple affiliations)
  const uniqueAuthors = authors.filter(
    (author, index, self) =>
      index === self.findIndex((a) => a.authorid === author.authorid)
  );

  // Separate fields by level
  const broadFields = fields.filter((f) => f.level === 0);
  const subFields = fields.filter((f) => f.level === 1);

  // Clean the DOI
  const cleanedDoi = cleanDoi(summary.doi);

  // Generate BibTeX
  const generateBibtex = () => {
    const citeKey = generateCiteKey(uniqueAuthors, summary.year);
    const authorList = uniqueAuthors.map(a => escapeBibtex(a.display_name || 'Unknown')).join(' and ');

    let bibtex = `@article{${citeKey},\n`;
    if (summary.title) bibtex += `  title = {${escapeBibtex(summary.title)}},\n`;
    if (authorList) bibtex += `  author = {${authorList}},\n`;
    if (summary.year) bibtex += `  year = {${summary.year}},\n`;
    if (summary.source_name) bibtex += `  journal = {${escapeBibtex(summary.source_name)}},\n`;
    if (biblioData?.volume) bibtex += `  volume = {${biblioData.volume}},\n`;
    if (biblioData?.issue) bibtex += `  number = {${biblioData.issue}},\n`;
    if (biblioData?.first_page && biblioData?.last_page) {
      bibtex += `  pages = {${biblioData.first_page}--${biblioData.last_page}},\n`;
    } else if (biblioData?.first_page) {
      bibtex += `  pages = {${biblioData.first_page}},\n`;
    }
    if (cleanedDoi) bibtex += `  doi = {${cleanedDoi}},\n`;
    bibtex += `}`;

    return bibtex;
  };

  // Fetch biblio data from OpenAlex when showing BibTeX (with localStorage caching)
  const handleShowBibtex = async () => {
    if (!showBibtex && biblioData === null) {
      setBiblioLoading(true);
      try {
        // Check localStorage cache first
        const cacheKey = `biblio_${paperid}`;
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const { data: cachedData, timestamp } = JSON.parse(cached);
          // Cache valid for 30 days
          if (Date.now() - timestamp < 30 * 24 * 60 * 60 * 1000) {
            setBiblioData(cachedData);
            setBiblioLoading(false);
            setShowBibtex(true);
            return;
          }
        }

        const res = await fetch(`https://api.openalex.org/works/${paperid}`);
        if (res.ok) {
          const data = await res.json();
          const biblio = data.biblio || {};
          setBiblioData(biblio);
          // Cache the result
          localStorage.setItem(cacheKey, JSON.stringify({ data: biblio, timestamp: Date.now() }));
        } else {
          setBiblioData({});
        }
      } catch (e) {
        console.error('Failed to fetch biblio data:', e);
        setBiblioData({});
      } finally {
        setBiblioLoading(false);
      }
    }
    setShowBibtex(!showBibtex);
  };

  const handleCopyBibtex = async () => {
    const bibtex = generateBibtex();
    await navigator.clipboard.writeText(bibtex);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadBibtex = () => {
    const bibtex = generateBibtex();
    const citeKey = generateCiteKey(uniqueAuthors, summary.year);
    const blob = new Blob([bibtex], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${citeKey}.bib`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
      {/* Back link */}
      <Link
        href="/"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to search
      </Link>

      {/* Main layout: Infobox left, Citation summary right */}
      <div className="grid lg:grid-cols-[352px_1fr] gap-8 mb-8">
        {/* Left: Infobox */}
        <Card>
          <CardContent className="pt-6">
            {/* Title */}
            <h1
              className="text-lg font-bold mb-3 leading-tight"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(summary.title || "Untitled") }}
            />

            {/* Authors */}
            {uniqueAuthors.length > 0 && (
              <div className="mb-4">
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {(showAllAuthors ? uniqueAuthors : uniqueAuthors.slice(0, 5)).map((author, idx) => (
                    <span key={author.authorid}>
                      {idx > 0 && ", "}
                      <Link
                        href={`/persons/${author.authorid}`}
                        className="hover:text-blue-600 hover:underline"
                      >
                        {author.display_name || "Unknown"}
                      </Link>
                    </span>
                  ))}
                  {uniqueAuthors.length > 5 && !showAllAuthors && (
                    <button
                      onClick={() => setShowAllAuthors(true)}
                      className="text-blue-600 hover:text-blue-800 hover:underline ml-1"
                    >
                      ({uniqueAuthors.length} authors)
                    </button>
                  )}
                  {uniqueAuthors.length > 5 && showAllAuthors && (
                    <button
                      onClick={() => setShowAllAuthors(false)}
                      className="text-blue-600 hover:text-blue-800 hover:underline ml-1"
                    >
                      (show less)
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* DOI link */}
            {cleanedDoi && (
              <div className="mb-2">
                <a
                  href={`https://doi.org/${cleanedDoi}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                >
                  DOI: {cleanedDoi}
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}

            {/* Journal/Source */}
            {summary.source_name && summary.sourceid && (
              <div className="mb-2">
                <Link
                  href={`/journals/${summary.sourceid}`}
                  className="text-sm text-blue-600 hover:text-blue-800 hover:underline italic"
                >
                  {summary.source_name}
                </Link>
              </div>
            )}

            <p className="text-xs text-gray-400 mb-4">Data up to Jan 2025</p>

            {/* Retraction Watch detailed card - shown prominently at top */}
            {!retractionLoading && retractionData && (
              <div className={`border rounded-lg p-3 mb-4 ${
                retractionData.retractionNature === 'Retraction'
                  ? 'bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800'
                  : retractionData.retractionNature === 'Expression of concern'
                  ? 'bg-orange-50 border-orange-200 dark:bg-orange-950 dark:border-orange-800'
                  : retractionData.retractionNature === 'Correction'
                  ? 'bg-yellow-50 border-yellow-200 dark:bg-yellow-950 dark:border-yellow-800'
                  : 'bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800'
              }`}>
                <div className={`font-semibold text-sm mb-2 ${
                  retractionData.retractionNature === 'Retraction'
                    ? 'text-red-800 dark:text-red-200'
                    : retractionData.retractionNature === 'Expression of concern'
                    ? 'text-orange-800 dark:text-orange-200'
                    : retractionData.retractionNature === 'Correction'
                    ? 'text-yellow-800 dark:text-yellow-200'
                    : 'text-green-800 dark:text-green-200'
                }`}>
                  {retractionData.retractionNature === 'Retraction' && '⚠️ Retracted Paper'}
                  {retractionData.retractionNature === 'Expression of concern' && '⚠️ Expression of Concern'}
                  {retractionData.retractionNature === 'Correction' && 'Corrected Paper'}
                  {retractionData.retractionNature === 'Reinstatement' && '✓ Retracted and Reinstated'}
                </div>
                {retractionData.retractionDate && (
                  <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">
                    <span className="font-medium">Date:</span> {new Date(retractionData.retractionDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                  </div>
                )}
                {retractionData.reasons.length > 0 && (
                  <div className="text-xs text-gray-600 dark:text-gray-400 mb-1">
                    <span className="font-medium">Reason:</span> {retractionData.reasons.join('; ')}
                  </div>
                )}
                {retractionData.retractionDoi && (
                  <a
                    href={`https://doi.org/${retractionData.retractionDoi}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 inline-flex items-center gap-1"
                  >
                    View Retraction Notice <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            )}

            {/* Fallback badge from OpenAlex if no Retraction Watch data but marked retracted */}
            {!retractionLoading && !retractionData && !extraLoading && metadata?.isRetracted && (
              <div className="flex flex-wrap gap-2 mb-4">
                <span className="px-2 py-1 text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 rounded">
                  ⚠️ Retracted
                </span>
              </div>
            )}

            {/* Key stats */}
            <div className="space-y-3 mb-6">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Published</span>
                <span className="font-semibold">
                  {!extraLoading && metadata?.publicationDate
                    ? metadata.publicationDate
                    : summary.year || "—"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Citations</span>
                <span className="font-semibold">{formatNumber(summary.cited_by_count)}</span>
              </div>
              {/* OpenAlex citation count if different from our count */}
              {!extraLoading && metadata?.openalexCitedByCount != null &&
               metadata.openalexCitedByCount !== summary.cited_by_count && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Citations (OpenAlex)</span>
                  <span className="font-semibold">{formatNumber(metadata.openalexCitedByCount)}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">References</span>
                <span className="font-semibold">{references.length}</span>
              </div>
              {/* Document type */}
              {!extraLoading && metadata?.docType && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Type</span>
                  <span className="font-semibold">{formatDocType(metadata.docType)}</span>
                </div>
              )}
              {/* Language */}
              {!extraLoading && metadata?.language && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Language</span>
                  <span className="font-semibold">{getLanguageName(metadata.language)}</span>
                </div>
              )}
            </div>

            {/* Paratext + open-access badges */}
            {((!extraLoading && metadata?.isParatext) ||
              (!openaireLoading && openaireData?.openaire)) && (
              <div className="flex flex-wrap gap-2 mb-4">
                {!extraLoading && metadata?.isParatext && (
                  <span className="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 rounded">
                    Paratext
                  </span>
                )}
                {!openaireLoading && openaireData?.openaire && (
                  <OpenAccessBadges info={openaireData.openaire} />
                )}
              </div>
            )}

            {/* Fields */}
            {fields.length > 0 && (
              <div className="border-t pt-4 mb-4">
                <div className="text-sm font-medium mb-2">Fields</div>
                <div className="flex flex-wrap gap-2">
                  {broadFields.map((field) => (
                    <Link
                      key={field.fieldid}
                      href={`/fields/${field.fieldid}`}
                      className="px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
                    >
                      {field.field_name}
                    </Link>
                  ))}
                  {(showAllFields ? subFields : subFields.slice(0, 3)).map((field) => (
                    <Link
                      key={field.fieldid}
                      href={`/fields/${field.fieldid}`}
                      className="px-2 py-1 rounded-full text-xs bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 hover:bg-purple-200 dark:hover:bg-purple-800 transition-colors"
                    >
                      {field.field_name}
                    </Link>
                  ))}
                  {subFields.length > 3 && !showAllFields && (
                    <button
                      onClick={() => setShowAllFields(true)}
                      className="px-2 py-1 text-xs text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      +{subFields.length - 3} more
                    </button>
                  )}
                  {subFields.length > 3 && showAllFields && (
                    <button
                      onClick={() => setShowAllFields(false)}
                      className="px-2 py-1 text-xs text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      show less
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* MeSH Terms */}
            {!meshLoading && meshTerms.length > 0 && (() => {
              // Deduplicate by meshUi for display
              const uniqueMesh = meshTerms.filter(
                (term, idx, self) => idx === self.findIndex((t) => t.meshUi === term.meshUi)
              );
              const displayedMesh = showAllMesh ? uniqueMesh : uniqueMesh.slice(0, 8);
              return (
                <div className="border-t pt-4 mb-4">
                  <div className="text-sm font-medium mb-2">MeSH Terms</div>
                  <div className="flex flex-wrap gap-2">
                    {displayedMesh.map((term) => (
                      <Link
                        key={term.meshUi}
                        href={`/mesh/${term.meshUi}`}
                        className={`px-2 py-1 rounded-full text-xs transition-colors ${
                          term.isMajor
                            ? "bg-teal-100 text-teal-900 dark:bg-teal-900 dark:text-teal-200 hover:bg-teal-200 dark:hover:bg-teal-800 font-medium"
                            : "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
                        }`}
                      >
                        {term.meshName}
                      </Link>
                    ))}
                    {uniqueMesh.length > 8 && !showAllMesh && (
                      <button
                        onClick={() => setShowAllMesh(true)}
                        className="px-2 py-1 text-xs text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        +{uniqueMesh.length - 8} more
                      </button>
                    )}
                    {uniqueMesh.length > 8 && showAllMesh && (
                      <button
                        onClick={() => setShowAllMesh(false)}
                        className="px-2 py-1 text-xs text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        show less
                      </button>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Clinical Trials */}
            {trials && trials.length > 0 && (
              <div className="border-t pt-4">
                <div className="flex items-center gap-2 text-sm font-medium mb-2">
                  <FlaskConical className="h-4 w-4" />
                  Clinical Trials ({trials.length})
                </div>
                <div className="space-y-2">
                  {trials.map((trial) => (
                    <ListItemLink key={trial.nct_id} href={`/trials/${trial.nct_id}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-blue-600">
                          {trial.nct_id}
                        </span>
                        {trial.reference_type && (
                          <span className={`px-2 py-0.5 rounded text-xs ${
                            trial.reference_type === "RESULT"
                              ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                              : trial.reference_type === "DERIVED"
                              ? "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
                              : "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200"
                          }`}>
                            {trial.reference_type}
                          </span>
                        )}
                      </div>
                    </ListItemLink>
                  ))}
                </div>
              </div>
            )}

            {/* Funding (OpenAIRE projects/grants) */}
            {!openaireLoading && openaireData && (
              <OpenaireFundingSection projects={openaireData.projects} />
            )}

            {/* Linked datasets & software (OpenAIRE) */}
            {!openaireLoading && openaireData && (
              <OpenaireLinkedProductsSection products={openaireData.linkedProducts} />
            )}

            {/* Patents - merge from main API and extra API, dedupe by patent ID */}
            {(() => {
              // Combine patents from both sources, preferring main API
              const mainPatents = patents || [];
              const allPatentIds = new Set(mainPatents.map(p => p.patent));
              // Add extra patents that aren't already in main
              const combinedPatents = [
                ...mainPatents,
                ...extraPatents.filter(p => !allPatentIds.has(p.patent))
              ];

              if (combinedPatents.length === 0) return null;

              return (
                <div className="border-t pt-4">
                  <div className="flex items-center gap-2 text-sm font-medium mb-2">
                    <FileText className="h-4 w-4" />
                    Cited by Patents ({combinedPatents.length})
                  </div>
                  <div className="space-y-2 max-h-[200px] overflow-y-auto">
                    {combinedPatents.map((patent) => (
                      <ListItemLink key={patent.patent} href={getPatentUrl(patent.patent)} external>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-blue-600">
                            {formatPatentId(patent.patent)}
                          </span>
                          <ExternalLink className="h-3 w-3 text-gray-400" />
                        </div>
                      </ListItemLink>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* PubMed Links (lazy loaded) */}
            {!extraLoading && pubmed && (pubmed.pmid || pubmed.pmcid) && (
              <div className="border-t pt-4">
                <div className="text-sm font-medium mb-2">PubMed</div>
                <div className="flex flex-wrap gap-2">
                  {pubmed.pmid && (
                    <a
                      href={`https://pubmed.ncbi.nlm.nih.gov/${pubmed.pmid}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 rounded hover:bg-blue-200 dark:hover:bg-blue-800"
                    >
                      PMID: {pubmed.pmid}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {pubmed.pmcid && (
                    <a
                      href={`https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${pubmed.pmcid}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 rounded hover:bg-green-200 dark:hover:bg-green-800"
                    >
                      PMC{pubmed.pmcid}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Media Mentions (lazy loaded) */}
            {!extraLoading && newsfeed.length > 0 && (
              <div className="border-t pt-4">
                <div className="flex items-center gap-2 text-sm font-medium mb-2">
                  <Newspaper className="h-4 w-4" />
                  Media Mentions ({newsfeed.length})
                </div>
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  {newsfeed.map((item, idx) => {
                    // Extract domain from URL for display
                    let domain = "";
                    try {
                      domain = new URL(item.url).hostname.replace(/^www\./, "");
                    } catch {
                      domain = item.url.slice(0, 40);
                    }
                    return (
                      <ListItemLink key={idx} href={item.url} external>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm text-blue-600 truncate">
                            {domain}
                          </span>
                          <ExternalLink className="h-3 w-3 text-gray-400 flex-shrink-0" />
                        </div>
                        {item.timestamp && (
                          <div className="text-xs text-gray-500 mt-1">
                            {new Date(item.timestamp).toLocaleDateString()}
                          </div>
                        )}
                      </ListItemLink>
                    );
                  })}
                </div>
              </div>
            )}

            {/* BibTeX - always at bottom */}
            <div className="border-t pt-4 space-y-2">
              {/* BibTeX toggle button */}
              <button
                onClick={handleShowBibtex}
                disabled={biblioLoading}
                className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50"
              >
                {biblioLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Download className="h-3 w-3" />
                )}
                {biblioLoading ? 'Loading...' : showBibtex ? 'Hide BibTeX' : 'Show BibTeX'}
              </button>

              {/* BibTeX display */}
              {showBibtex && (
                <div className="mt-2">
                  <div className="flex gap-2 mb-2">
                    <button
                      onClick={handleCopyBibtex}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-gray-100 dark:bg-gray-800 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                    >
                      {copied ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3" />}
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                    <button
                      onClick={handleDownloadBibtex}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-gray-100 dark:bg-gray-800 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
                    >
                      <Download className="h-3 w-3" />
                      Download .bib
                    </button>
                  </div>
                  <pre className="text-xs bg-gray-50 dark:bg-gray-800 p-2 rounded overflow-x-auto whitespace-pre-wrap break-all">
                    {generateBibtex()}
                  </pre>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Right: Citation summary and chart */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Total Citations Per Year</CardTitle>
                <div className="flex rounded-md border border-gray-200 dark:border-gray-700 overflow-hidden text-sm">
                  <button
                    onClick={() => setCitationViewMode("yearly")}
                    className={`px-3 py-1 transition-colors ${
                      citationViewMode === "yearly"
                        ? "bg-blue-600 text-white"
                        : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                    }`}
                  >
                    Per Year
                  </button>
                  <button
                    onClick={() => setCitationViewMode("cumulative")}
                    className={`px-3 py-1 transition-colors ${
                      citationViewMode === "cumulative"
                        ? "bg-blue-600 text-white"
                        : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"
                    }`}
                  >
                    Cumulative
                  </button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <PaperCitationsChart data={citationHistory || []} viewMode={citationViewMode} />
            </CardContent>
          </Card>

          {/* Abstract Card */}
          {abstractLoading ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Abstract</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="animate-pulse">
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-full mb-2"></div>
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-full mb-2"></div>
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-5/6 mb-2"></div>
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-4/6"></div>
                </div>
              </CardContent>
            </Card>
          ) : abstract ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  Abstract
                  {abstractLanguage && abstractLanguage !== "en" && (
                    <span className="px-1.5 py-0.5 text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 rounded font-normal">
                      {abstractLanguage.toUpperCase()}
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p
                  ref={abstractRef}
                  className={`text-sm text-gray-700 dark:text-gray-300 ${showFullAbstract ? "" : "line-clamp-[15]"}`}
                >
                  {abstract}
                </p>
                {(isAbstractClamped || showFullAbstract) && (
                  <button
                    onClick={() => setShowFullAbstract(!showFullAbstract)}
                    className="text-blue-600 hover:text-blue-800 text-sm mt-2"
                  >
                    {showFullAbstract ? "Show less" : "Show more"}
                  </button>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      {/* References and Citations side by side on large screens */}
      <div className="grid md:grid-cols-2 gap-6">
        <PaperListCard
          type="references"
          papers={references.map((ref) => ({
            paperid: ref.ref_paperid,
            title: ref.ref_title,
            year: ref.ref_year,
            cited_by_count: ref.ref_cited_by_count,
          }))}
        />

        {/* One list, both corpora. OpenAIRE-only citing papers are interleaved
            by citation count and carry a badge; each item routes itself. */}
        <PaperListCard
          type="citations"
          papers={mergedCitations}
          totalCount={citationsTotal + openaireCitationsTotal}
          isLoading={
            citationsLoading || openaireCitationsLoading || !openaireCitationsFetched
          }
          hasMore={hasMoreCitations || hasMoreOpenaireCitations}
          containerRef={citationsContainerRef}
          sentinelRef={citationsEndRef}
          maxNote={
            displayedCitations.length >= EDGE_CAP ||
            openaireCitations.length >= EDGE_CAP
              ? `Capped at the ${formatNumber(EDGE_CAP)} most-cited citing papers per source`
              : undefined
          }
          footnote={
            openaireCitationsTotal > 0
              ? "Includes citing papers from the OpenAIRE Graph (CC-BY), whose citation counts come from BIP! rather than OpenAlex."
              : undefined
          }
        />
      </div>

    </div>
  );
}
