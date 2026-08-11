"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OpenairePaperDetails, PaperOpenaireResponse } from "@/lib/types";
import {
  OpenAccessBadges,
  OpenaireFundingSection,
  OpenaireLinkedProductsSection,
} from "@/components/OpenairePanels";
import { ArrowLeft, ExternalLink, Loader2, Globe } from "lucide-react";

export default function OpenairePaperPage() {
  const params = useParams();
  const id = params.id as string;

  const [data, setData] = useState<OpenairePaperDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [abstract, setAbstract] = useState<string | null>(null);
  const [enrichment, setEnrichment] = useState<PaperOpenaireResponse | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/papers/openaire/${id}`);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        setData(await res.json());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load paper");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [id]);

  // Abstract (separate optional DB)
  useEffect(() => {
    async function fetchAbstract() {
      try {
        const res = await fetch(`/api/papers/openaire/${id}/abstract`);
        if (res.ok) {
          const json = await res.json();
          setAbstract(json.abstract);
        }
      } catch (e) {
        console.error("Failed to fetch abstract:", e);
      }
    }
    fetchAbstract();
  }, [id]);

  // Funding + linked products (shared enrichment route works on 'OA…' ids too)
  useEffect(() => {
    async function fetchEnrichment() {
      try {
        const res = await fetch(`/api/papers/${id}/openaire`);
        if (res.ok) {
          setEnrichment(await res.json());
        }
      } catch (e) {
        console.error("Failed to fetch enrichment:", e);
      }
    }
    fetchEnrichment();
  }, [id]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link href="/papers" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline mb-4">
          <ArrowLeft className="h-4 w-4" /> Back to papers
        </Link>
        <Card>
          <CardContent className="py-8 text-center text-gray-500">
            {error || "Paper not found"}
          </CardContent>
        </Card>
      </div>
    );
  }

  const { summary, authors, journalDisplayName } = data;
  const pages = [summary.startPage, summary.endPage].filter(Boolean).join("–");

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 space-y-4">
      <Link href="/papers" className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Back to papers
      </Link>

      {/* Source banner */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-sky-50 dark:bg-sky-950 text-sky-800 dark:text-sky-200 text-sm">
        <Globe className="h-4 w-4 shrink-0" />
        <span>
          This record comes from the{" "}
          <a
            href="https://graph.openaire.eu/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            OpenAIRE Graph
          </a>{" "}
          (CC-BY) and is not part of the SciSciNet core dataset.
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl leading-snug">
            {summary.title || "Untitled"}
            {summary.subtitle && (
              <span className="block text-base font-normal text-gray-600 dark:text-gray-400 mt-1">
                {summary.subtitle}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Badges */}
          <div className="flex flex-wrap gap-2">
            {summary.type && (
              <span className="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200 rounded capitalize">
                {summary.type}
              </span>
            )}
            <OpenAccessBadges
              info={{
                oaColor: summary.oaColor,
                bestAccessRight: summary.bestAccessRight,
                isGreen: summary.isGreen,
                isDiamond: summary.isDiamond,
                publiclyFunded: summary.publiclyFunded,
              }}
            />
          </div>

          {/* Authors */}
          {authors.length > 0 && (
            <div className="text-sm">
              <span className="text-gray-500">Authors: </span>
              {authors.map((a, i) => (
                <span key={`${a.rank}-${i}`}>
                  {i > 0 && ", "}
                  {a.matchedAuthorid ? (
                    <Link
                      href={`/persons/${a.matchedAuthorid}`}
                      className="text-blue-600 hover:underline"
                    >
                      {a.fullName || "Unknown"}
                    </Link>
                  ) : (
                    <span>{a.fullName || "Unknown"}</span>
                  )}
                  {a.orcid && (
                    <a
                      href={`https://orcid.org/${a.orcid}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-green-700 dark:text-green-400 text-xs align-super ml-0.5"
                      title={`ORCID: ${a.orcid}`}
                    >
                      iD
                    </a>
                  )}
                </span>
              ))}
              {summary.authorCount > authors.length && (
                <span className="text-gray-500">
                  {" "}
                  and {summary.authorCount - authors.length} more
                </span>
              )}
            </div>
          )}

          {/* Journal / venue */}
          {(journalDisplayName || summary.journalName) && (
            <div className="text-sm">
              <span className="text-gray-500">Published in: </span>
              {summary.matchedSourceid ? (
                <Link
                  href={`/journals/${summary.matchedSourceid}`}
                  className="text-blue-600 hover:underline"
                >
                  {journalDisplayName || summary.journalName}
                </Link>
              ) : (
                <span>{summary.journalName}</span>
              )}
              {summary.volume && <span> · Vol. {summary.volume}</span>}
              {summary.issue && <span> ({summary.issue})</span>}
              {pages && <span> · pp. {pages}</span>}
            </div>
          )}

          {/* Metadata rows */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm border-t pt-4">
            {summary.year && (
              <div>
                <div className="text-gray-500">Year</div>
                <div className="font-semibold">{summary.year}</div>
              </div>
            )}
            {summary.publisher && (
              <div className="col-span-2">
                <div className="text-gray-500">Publisher</div>
                <div className="font-semibold truncate" title={summary.publisher}>
                  {summary.publisher}
                </div>
              </div>
            )}
            {summary.language && (
              <div>
                <div className="text-gray-500">Language</div>
                <div className="font-semibold uppercase">{summary.language}</div>
              </div>
            )}
          </div>

          {/* External links */}
          <div className="flex flex-wrap gap-2 border-t pt-4">
            <a
              href={`https://doi.org/${summary.doi}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 rounded hover:bg-blue-200 dark:hover:bg-blue-800"
            >
              DOI: {summary.doi} <ExternalLink className="h-3 w-3" />
            </a>
            {summary.pmid && (
              <a
                href={`https://pubmed.ncbi.nlm.nih.gov/${summary.pmid}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 rounded hover:bg-green-200 dark:hover:bg-green-800"
              >
                PMID: {summary.pmid} <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>

          {/* Funding + linked products */}
          {enrichment && <OpenaireFundingSection projects={enrichment.projects} />}
          {enrichment && (
            <OpenaireLinkedProductsSection products={enrichment.linkedProducts} />
          )}
        </CardContent>
      </Card>

      {/* Abstract */}
      {abstract && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Abstract</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed whitespace-pre-line">{abstract}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
