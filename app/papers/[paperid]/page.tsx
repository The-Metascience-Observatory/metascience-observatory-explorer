"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import DOMPurify from "dompurify";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PaperCitationsChart, CitationViewMode } from "@/components/PaperCitationsChart";
import { ListItemLink } from "@/components/ListItemLink";
import { PaperListCard } from "@/components/PaperListCard";
import type { PaperDetails, PaperCitation } from "@/lib/types";
import { formatNumber } from "@/lib/utils";
import LitePaperPage from "./LitePaperPage";
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

// Helper to clean DOI - remove any existing https://doi.org/ prefix
function cleanDoi(doi: string | null): string | null {
  if (!doi) return null;
  // Remove any existing URL prefix
  return doi.replace(/^https?:\/\/doi\.org\//i, '');
}

// Convert patent ID to Google Patents URL
// Patent IDs are like "us-11426570-b2" -> "US11426570B2"
function getPatentUrl(patentId: string): string {
  // Convert from "us-11426570-b2" format to "US11426570B2"
  const normalized = patentId.toUpperCase().replace(/-/g, '');
  return `https://patents.google.com/patent/${normalized}`;
}

// Format patent ID for display (e.g., "us-11426570-b2" -> "US 11,426,570 B2")
function formatPatentId(patentId: string): string {
  const parts = patentId.split('-');
  if (parts.length >= 2) {
    const country = parts[0].toUpperCase();
    const number = parts[1];
    const kind = parts[2]?.toUpperCase() || '';
    // Format number with commas for US patents
    const formattedNumber = country === 'US' && /^\d+$/.test(number)
      ? parseInt(number, 10).toLocaleString()
      : number;
    return `${country} ${formattedNumber}${kind ? ' ' + kind : ''}`;
  }
  return patentId.toUpperCase();
}

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
function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['i', 'b', 'em', 'strong', 'sub', 'sup'],
    ALLOWED_ATTR: [], // No attributes allowed
  });
}

// Language code to human-readable name mapping
const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  zh: "Chinese",
  es: "Spanish",
  de: "German",
  fr: "French",
  ja: "Japanese",
  pt: "Portuguese",
  ru: "Russian",
  ko: "Korean",
  it: "Italian",
  nl: "Dutch",
  pl: "Polish",
  tr: "Turkish",
  ar: "Arabic",
  cs: "Czech",
  sv: "Swedish",
  da: "Danish",
  fi: "Finnish",
  no: "Norwegian",
  hu: "Hungarian",
  el: "Greek",
  he: "Hebrew",
  th: "Thai",
  vi: "Vietnamese",
  uk: "Ukrainian",
  id: "Indonesian",
  ms: "Malay",
  ro: "Romanian",
  sk: "Slovak",
  bg: "Bulgarian",
  hr: "Croatian",
  sr: "Serbian",
  sl: "Slovenian",
  et: "Estonian",
  lv: "Latvian",
  lt: "Lithuanian",
  fa: "Persian",
  hi: "Hindi",
  bn: "Bengali",
  ta: "Tamil",
  te: "Telugu",
  mr: "Marathi",
  gu: "Gujarati",
  kn: "Kannada",
  ml: "Malayalam",
  pa: "Punjabi",
  ur: "Urdu",
  ca: "Catalan",
  eu: "Basque",
  gl: "Galician",
  af: "Afrikaans",
  sw: "Swahili",
  la: "Latin",
};

function getLanguageName(code: string | null): string {
  if (!code) return "Unknown";
  return LANGUAGE_NAMES[code.toLowerCase()] || code.toUpperCase();
}

// Format document type for display
function formatDocType(docType: string | null): string {
  if (!docType) return "Unknown";
  // Convert snake_case or kebab-case to Title Case
  return docType
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function PaperDetailPage() {
  const params = useParams();
  const paperid = params.paperid as string;

  const [data, setData] = useState<PaperDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showLitePage, setShowLitePage] = useState(false);
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

  // Infinite scroll state for citations
  const [displayedCitations, setDisplayedCitations] = useState<PaperCitation[]>([]);
  const [citationsLoading, setCitationsLoading] = useState(false);
  const [hasMoreCitations, setHasMoreCitations] = useState(false);
  const [citationsTotal, setCitationsTotal] = useState(0);
  const citationsEndRef = useRef<HTMLDivElement>(null);
  const citationsContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/papers/${paperid}`);
        if (!res.ok) {
          // If paper not found in main DB, try lite endpoint
          if (res.status === 404) {
            const liteRes = await fetch(`/api/papers/${paperid}/lite`);
            if (liteRes.ok) {
              // Paper exists in lite DB, show lite page
              setShowLitePage(true);
              setLoading(false);
              return;
            }
          }
          const err = await res.json();
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const json = await res.json();
        setData(json);
        // Initialize citations state from initial data
        setDisplayedCitations(json.citations || []);
        const total = json.citationsTotal || json.citations?.length || 0;
        setCitationsTotal(total);
        // Cap at 1000, check if more to load
        const hasMore = (json.citations?.length || 0) < Math.min(total, 1000);
        setHasMoreCitations(hasMore);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load paper");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [paperid]);

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

  // Load more citations function
  const loadMoreCitations = useCallback(async () => {
    if (citationsLoading || !hasMoreCitations) return;

    setCitationsLoading(true);
    try {
      const offset = displayedCitations.length;
      // Cap at 1000 total
      const remaining = Math.min(1000, citationsTotal) - offset;
      if (remaining <= 0) {
        setHasMoreCitations(false);
        return;
      }
      const limit = Math.min(100, remaining);

      const res = await fetch(`/api/papers/${paperid}/citations?offset=${offset}&limit=${limit}`);
      if (res.ok) {
        const data = await res.json();
        setDisplayedCitations(prev => [...prev, ...data.citations]);
        // Check if we've reached the cap or no more data
        const newTotal = offset + data.citations.length;
        setHasMoreCitations(data.hasMore && newTotal < 1000);
      }
    } catch (e) {
      console.error('Failed to load more citations:', e);
    } finally {
      setCitationsLoading(false);
    }
  }, [paperid, displayedCitations.length, citationsLoading, hasMoreCitations, citationsTotal]);

  // Intersection observer for infinite scroll
  useEffect(() => {
    if (!citationsEndRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMoreCitations && !citationsLoading) {
          loadMoreCitations();
        }
      },
      { threshold: 0.1, root: citationsContainerRef.current }
    );

    observer.observe(citationsEndRef.current);
    return () => observer.disconnect();
  }, [hasMoreCitations, citationsLoading, loadMoreCitations]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          <span className="ml-3 text-gray-500">Loading paper details...</span>
        </div>
      </div>
    );
  }

  // If paper not in main DB but exists in lite DB, render lite page
  if (showLitePage) {
    return <LitePaperPage paperid={paperid} />;
  }

  if (error || !data) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <Link
          href="/"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to search
        </Link>
        <div className="text-center py-24">
          <p className="text-red-600 text-lg">{error || "Paper not found"}</p>
          <p className="text-gray-500 mt-2">
            Make sure the preprocessing script has been run with paper data.
          </p>
        </div>
      </div>
    );
  }

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
                <span className="text-sm text-gray-500">Year</span>
                <span className="font-semibold">{summary.year || "—"}</span>
              </div>
              {/* Show full publication date if available */}
              {!extraLoading && metadata?.publicationDate && metadata.publicationDate !== String(summary.year) && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Published</span>
                  <span className="font-semibold">{metadata.publicationDate}</span>
                </div>
              )}
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
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Authors</span>
                <span className="font-semibold">{uniqueAuthors.length}</span>
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

            {/* Paratext badge */}
            {!extraLoading && metadata?.isParatext && (
              <div className="flex flex-wrap gap-2 mb-4">
                <span className="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 rounded">
                  Paratext
                </span>
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

            {/* DOI & BibTeX - always at bottom */}
            <div className="border-t pt-4 space-y-2">
              {cleanedDoi && (
                <a
                  href={`https://doi.org/${cleanedDoi}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                >
                  DOI: {cleanedDoi}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}

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
                <p className={`text-sm text-gray-700 dark:text-gray-300 ${showFullAbstract ? "" : "line-clamp-[15]"}`}>
                  {abstract}
                </p>
                {abstract.length > 1250 && (
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

        <PaperListCard
          type="citations"
          papers={displayedCitations.map((cit) => ({
            paperid: cit.citing_paperid,
            title: cit.citing_title,
            year: cit.citing_year,
            cited_by_count: cit.citing_cited_by_count,
          }))}
          totalCount={citationsTotal}
          isLoading={citationsLoading}
          hasMore={hasMoreCitations}
          containerRef={citationsContainerRef}
          sentinelRef={citationsEndRef}
          maxNote="Showing first 1,000 citations"
        />
      </div>
    </div>
  );
}
