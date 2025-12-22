"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { formatNumber } from "@/lib/utils";
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  FileText,
  Newspaper,
  Info,
} from "lucide-react";

// Types for lite paper data
interface LitePaperData {
  paperid: string;
  title: string | null;
  doi: string | null;
  publicationDate: string | null;
  docType: string | null;
  language: string | null;
  citedByCount: number | null;
  isRetracted: boolean;
  authors: Array<{
    authorid: string;
    displayName: string | null;
    position: string | null;
    institutionid: string | null;
    affiliation: string | null;
  }>;
  fields: Array<{
    fieldid: string;
    name: string;
    score: number | null;
  }>;
  source: {
    sourceid: string | null;
    name: string | null;
    landingPageUrl: string | null;
    pdfUrl: string | null;
    isOa: boolean;
    version: string | null;
    license: string | null;
  } | null;
  isLite: boolean;
}

interface ExtraData {
  newsfeed: Array<{ url: string; timestamp: string }>;
  pubmed: { pmid: number | null; pmcid: number | null } | null;
  patents: Array<{ patent: string; isUspto: boolean }>;
}

// Helper to clean DOI - remove any existing https://doi.org/ prefix
function cleanDoi(doi: string | null): string | null {
  if (!doi) return null;
  return doi.replace(/^https?:\/\/doi\.org\//i, "");
}

// Convert patent ID to Google Patents URL
function getPatentUrl(patentId: string): string {
  const normalized = patentId.toUpperCase().replace(/-/g, "");
  return `https://patents.google.com/patent/${normalized}`;
}

// Format patent ID for display
function formatPatentId(patentId: string): string {
  const parts = patentId.split("-");
  if (parts.length >= 2) {
    const country = parts[0].toUpperCase();
    const number = parts[1];
    const kind = parts[2]?.toUpperCase() || "";
    const formattedNumber =
      country === "US" && /^\d+$/.test(number)
        ? parseInt(number, 10).toLocaleString()
        : number;
    return `${country} ${formattedNumber}${kind ? " " + kind : ""}`;
  }
  return patentId.toUpperCase();
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
};

function getLanguageName(code: string | null): string {
  if (!code) return "Unknown";
  return LANGUAGE_NAMES[code.toLowerCase()] || code.toUpperCase();
}

// Format document type for display
function formatDocType(docType: string | null): string {
  if (!docType) return "Unknown";
  return docType
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

interface LitePaperPageProps {
  paperid: string;
}

export default function LitePaperPage({ paperid }: LitePaperPageProps) {
  const [data, setData] = useState<LitePaperData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllAuthors, setShowAllAuthors] = useState(false);
  const [showAllFields, setShowAllFields] = useState(false);

  // Abstract state (lazy loaded)
  const [abstract, setAbstract] = useState<string | null>(null);
  const [abstractLanguage, setAbstractLanguage] = useState<string | null>(null);
  const [abstractLoading, setAbstractLoading] = useState(true);
  const [showFullAbstract, setShowFullAbstract] = useState(false);

  // Extra paper data (lazy loaded)
  const [extraData, setExtraData] = useState<ExtraData | null>(null);
  const [extraLoading, setExtraLoading] = useState(true);

  // Fetch lite paper data
  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/papers/${paperid}/lite`);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const json = await res.json();
        setData(json);
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

  // Lazy load extra data (newsfeed, PMID/PMCID, patents)
  useEffect(() => {
    async function fetchExtra() {
      try {
        const res = await fetch(`/api/papers/${paperid}/extra`);
        if (res.ok) {
          const data = await res.json();
          setExtraData(data);
        }
      } catch (e) {
        console.error("Failed to fetch extra data:", e);
      } finally {
        setExtraLoading(false);
      }
    }
    fetchExtra();
  }, [paperid]);

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
        </div>
      </div>
    );
  }

  const cleanedDoi = cleanDoi(data.doi);

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

      {/* Limited data banner */}
      <div className="mb-6 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg">
        <div className="flex items-start gap-2">
          <Info className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-amber-800 dark:text-amber-200 font-medium">
              Limited data available
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
              This paper has basic metadata but is not fully indexed. Citation
              graph, references, and detailed metrics are not available.
            </p>
          </div>
        </div>
      </div>

      {/* Main layout */}
      <div className="grid lg:grid-cols-[400px_1fr] gap-8">
        {/* Left: Infobox */}
        <Card>
          <CardContent className="pt-6">
            {/* Retracted warning */}
            {data.isRetracted && (
              <div className="mb-4 p-2 bg-red-100 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded">
                <span className="text-sm font-medium text-red-800 dark:text-red-200">
                  ⚠️ This paper has been retracted
                </span>
              </div>
            )}

            {/* Title */}
            <h1 className="text-lg font-bold mb-3 leading-tight">
              {data.title || "Untitled"}
            </h1>

            {/* Abstract (lazy loaded) */}
            {abstractLoading ? (
              <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-800 rounded">
                <div className="animate-pulse">
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-full mb-2"></div>
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-5/6 mb-2"></div>
                  <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-4/6"></div>
                </div>
              </div>
            ) : abstract ? (
              <div className="mb-4">
                <div className="text-sm text-gray-700 dark:text-gray-300 p-3 bg-gray-50 dark:bg-gray-800 rounded">
                  {abstractLanguage && abstractLanguage !== "en" && (
                    <span className="inline-block px-1.5 py-0.5 mb-2 text-xs bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 rounded">
                      {abstractLanguage.toUpperCase()}
                    </span>
                  )}
                  <p className={showFullAbstract ? "" : "line-clamp-4"}>
                    {abstract}
                  </p>
                  {abstract.length > 400 && (
                    <button
                      onClick={() => setShowFullAbstract(!showFullAbstract)}
                      className="text-blue-600 hover:text-blue-800 text-xs mt-1"
                    >
                      {showFullAbstract ? "Show less" : "Show more"}
                    </button>
                  )}
                </div>
              </div>
            ) : null}

            {/* Authors */}
            {data.authors.length > 0 && (
              <div className="mb-4">
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {(showAllAuthors ? data.authors : data.authors.slice(0, 5)).map(
                    (author, idx) => (
                      <span key={`${author.authorid}-${idx}`}>
                        {idx > 0 && ", "}
                        <Link
                          href={`/persons/${author.authorid}`}
                          className="hover:text-blue-600 hover:underline"
                        >
                          {author.displayName || "Unknown"}
                        </Link>
                      </span>
                    )
                  )}
                  {data.authors.length > 5 && !showAllAuthors && (
                    <button
                      onClick={() => setShowAllAuthors(true)}
                      className="text-blue-600 hover:text-blue-800 hover:underline ml-1"
                    >
                      ({data.authors.length} authors)
                    </button>
                  )}
                  {data.authors.length > 5 && showAllAuthors && (
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
            {data.source?.name && data.source?.sourceid && (
              <div className="mb-2">
                <Link
                  href={`/journals/${data.source.sourceid}`}
                  className="text-sm text-blue-600 hover:text-blue-800 hover:underline"
                >
                  {data.source.name}
                </Link>
                {data.source.isOa && (
                  <span className="ml-2 px-1.5 py-0.5 text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 rounded">
                    Open Access
                  </span>
                )}
              </div>
            )}

            {/* Key stats */}
            <div className="space-y-3 mt-4 mb-6">
              {data.publicationDate && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Published</span>
                  <span className="font-semibold">{data.publicationDate}</span>
                </div>
              )}
              {data.citedByCount != null && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">
                    Citations (OpenAlex)
                  </span>
                  <span className="font-semibold">
                    {formatNumber(data.citedByCount)}
                  </span>
                </div>
              )}
              {data.authors.length > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Authors</span>
                  <span className="font-semibold">{data.authors.length}</span>
                </div>
              )}
              {data.docType && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Type</span>
                  <span className="font-semibold">
                    {formatDocType(data.docType)}
                  </span>
                </div>
              )}
              {data.language && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Language</span>
                  <span className="font-semibold">
                    {getLanguageName(data.language)}
                  </span>
                </div>
              )}
            </div>

            {/* Fields */}
            {data.fields.length > 0 && (
              <div className="border-t pt-4 mb-4">
                <div className="text-sm font-medium mb-2">Fields</div>
                <div className="flex flex-wrap gap-2">
                  {(showAllFields ? data.fields : data.fields.slice(0, 5)).map(
                    (field) => (
                      <Link
                        key={field.fieldid}
                        href={`/fields/${field.fieldid}`}
                        className="px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
                      >
                        {field.name}
                      </Link>
                    )
                  )}
                  {data.fields.length > 5 && !showAllFields && (
                    <button
                      onClick={() => setShowAllFields(true)}
                      className="px-2 py-1 text-xs text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      +{data.fields.length - 5} more
                    </button>
                  )}
                  {data.fields.length > 5 && showAllFields && (
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

            {/* Patents (from extra data) */}
            {!extraLoading && extraData?.patents && extraData.patents.length > 0 && (
              <div className="border-t pt-4">
                <div className="flex items-center gap-2 text-sm font-medium mb-2">
                  <FileText className="h-4 w-4" />
                  Cited by Patents ({extraData.patents.length})
                </div>
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  {extraData.patents.map((patent) => (
                    <a
                      key={patent.patent}
                      href={getPatentUrl(patent.patent)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block p-2 bg-gray-50 dark:bg-gray-800 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-blue-600">
                          {formatPatentId(patent.patent)}
                        </span>
                        <ExternalLink className="h-3 w-3 text-gray-400" />
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* PubMed Links (from extra data) */}
            {!extraLoading &&
              extraData?.pubmed &&
              (extraData.pubmed.pmid || extraData.pubmed.pmcid) && (
                <div className="border-t pt-4">
                  <div className="text-sm font-medium mb-2">PubMed</div>
                  <div className="flex flex-wrap gap-2">
                    {extraData.pubmed.pmid && (
                      <a
                        href={`https://pubmed.ncbi.nlm.nih.gov/${extraData.pubmed.pmid}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 rounded hover:bg-blue-200 dark:hover:bg-blue-800"
                      >
                        PMID: {extraData.pubmed.pmid}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                    {extraData.pubmed.pmcid && (
                      <a
                        href={`https://www.ncbi.nlm.nih.gov/pmc/articles/PMC${extraData.pubmed.pmcid}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 rounded hover:bg-green-200 dark:hover:bg-green-800"
                      >
                        PMC{extraData.pubmed.pmcid}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              )}

            {/* Media Mentions (from extra data) */}
            {!extraLoading && extraData?.newsfeed && extraData.newsfeed.length > 0 && (
              <div className="border-t pt-4">
                <div className="flex items-center gap-2 text-sm font-medium mb-2">
                  <Newspaper className="h-4 w-4" />
                  Media Mentions ({extraData.newsfeed.length})
                </div>
                <div className="space-y-2 max-h-[200px] overflow-y-auto">
                  {extraData.newsfeed.map((item, idx) => {
                    let domain = "";
                    try {
                      domain = new URL(item.url).hostname.replace(/^www\./, "");
                    } catch {
                      domain = item.url.slice(0, 40);
                    }
                    return (
                      <a
                        key={idx}
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block p-2 bg-gray-50 dark:bg-gray-800 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      >
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
                      </a>
                    );
                  })}
                </div>
              </div>
            )}

            {/* DOI & Links */}
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
              {data.source?.landingPageUrl && (
                <div>
                  <a
                    href={data.source.landingPageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                  >
                    Publisher page
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
              {data.source?.pdfUrl && (
                <div>
                  <a
                    href={data.source.pdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-green-600 hover:text-green-800"
                  >
                    PDF
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Right: Placeholder for unavailable data */}
        <div className="space-y-6">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center py-12 text-gray-500">
                <p className="text-lg font-medium mb-2">Citation Data Unavailable</p>
                <p className="text-sm">
                  This paper is not in our full citation index. Citation history,
                  references, and citing papers cannot be displayed.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
