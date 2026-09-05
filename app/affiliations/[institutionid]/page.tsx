import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  ExternalLink,
  Handshake,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { JsonLd } from "@/components/JsonLd";
import {
  getAffiliationDetails,
  getAffiliationSummary,
} from "@/lib/queries/affiliations";
import { breadcrumbLd, institutionSchemaType, organizationLd } from "@/lib/jsonld";
import { formatNumber, getCountryName } from "@/lib/utils";
import { ResearcherList } from "./parts/ResearcherList";
import { OpenaireProjects } from "./parts/OpenaireProjects";

/** ~110k institutions — bounded and fully indexable, so cache rather than force dynamic. */
export const revalidate = 86400;

const typeColors: Record<string, string> = {
  education: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  company: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  government: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  healthcare: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  nonprofit: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  facility: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200",
  archive: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  other: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

type Props = { params: Promise<{ institutionid: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { institutionid } = await params;
  const summary = await getAffiliationSummary(institutionid);

  if (!summary) {
    return { title: "Institution not found", robots: { index: false, follow: false } };
  }

  const country = summary.country_code ? getCountryName(summary.country_code) : null;
  const title = `${summary.display_name} — Research Output, Citations & Researchers`;
  const description =
    `${summary.display_name}${country ? ` (${country})` : ""}` +
    `${summary.type ? `, ${summary.type}` : ""}: ` +
    `${formatNumber(summary.productivity)} publications, ` +
    `${formatNumber(summary.total_citations)} citations, h-index ${summary.h_index ?? "n/a"}, ` +
    `${formatNumber(summary.researcher_count)} researchers indexed` +
    `${summary.first_year && summary.last_year ? `, ${summary.first_year}–${summary.last_year}` : ""}. ` +
    "Top researchers, collaborating institutions and funded projects.";
  const canonical = `/affiliations/${summary.institution_id}`;

  return {
    title,
    description,
    alternates: { canonical },
    openGraph: { title, description, url: canonical },
  };
}

export default async function AffiliationDetailPage({ params }: Props) {
  const { institutionid } = await params;
  const data = await getAffiliationDetails(institutionid);
  if (!data) notFound();

  const {
    summary,
    topResearchers,
    topCollaborators,
    childInstitutions,
    parentInstitution,
  } = data;
  const typeColor = summary.type
    ? typeColors[summary.type] || typeColors.other
    : typeColors.other;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
      <JsonLd
        data={[
          organizationLd({
            id: summary.institution_id,
            path: `/affiliations/${summary.institution_id}`,
            name: summary.display_name,
            type: institutionSchemaType(summary.type),
            countryCode: summary.country_code,
            homepageUrl: summary.homepage_url,
            ror: summary.ror,
          }),
          breadcrumbLd([
            ["Institutions", "/affiliations"],
            [summary.display_name, `/affiliations/${summary.institution_id}`],
          ]),
        ]}
      />

      <Link
        href="/affiliations"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        All institutions
      </Link>

      <Card className="mb-8 max-w-md">
        <CardContent className="pt-6">
          <h1 className="text-xl font-bold mb-2 text-center">{summary.display_name}</h1>

          {summary.type && (
            <div className="flex justify-center mb-2">
              <span className={`px-3 py-1 text-sm rounded-full ${typeColor}`}>
                {summary.type}
              </span>
            </div>
          )}

          {summary.country_code && (
            <p className="text-sm text-gray-500 text-center mb-2">
              {getCountryName(summary.country_code)}
            </p>
          )}

          {parentInstitution && parentInstitution.display_name && (
            <p className="text-sm text-gray-500 text-center mb-2">
              Part of{" "}
              <Link
                href={`/affiliations/${parentInstitution.institution_id}`}
                className="text-blue-600 hover:text-blue-800 hover:underline"
              >
                {parentInstitution.display_name}
              </Link>
            </p>
          )}

          <p className="text-xs text-gray-400 mb-4 text-center">Data up to Jan 2025</p>

          <div className="space-y-3 mb-6">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Publications</span>
              <span className="font-semibold">{formatNumber(summary.productivity)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Citations</span>
              <span className="font-semibold">{formatNumber(summary.total_citations)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">h-index</span>
              <span className="font-semibold">{summary.h_index || "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Researchers</span>
              <span className="font-semibold">{formatNumber(summary.researcher_count)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Years Active</span>
              <span className="font-semibold">
                {summary.first_year && summary.last_year
                  ? `${summary.first_year}–${summary.last_year}`
                  : "—"}
              </span>
            </div>
          </div>

          {(summary.ror || summary.homepage_url) && (
            <div className="border-t pt-4">
              <div className="flex flex-col gap-2">
                {summary.ror && (
                  <a
                    href={`https://ror.org/${summary.ror}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                  >
                    ROR Registry
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
                {summary.homepage_url && (
                  <a
                    href={summary.homepage_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
                  >
                    Institution Website
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {topResearchers.length > 0 && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Top Researchers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResearcherList researchers={topResearchers} />
          </CardContent>
        </Card>
      )}

      {childInstitutions && childInstitutions.length > 0 && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Subinstitutions ({childInstitutions.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 max-h-[400px] overflow-y-auto">
              {childInstitutions.map((child, idx) => {
                const childTypeColor = child.type
                  ? typeColors[child.type] || typeColors.other
                  : typeColors.other;
                return (
                  <Link
                    key={`${child.institution_id}-${idx}`}
                    href={`/affiliations/${child.institution_id}`}
                    className="block"
                  >
                    <div className="flex items-start justify-between gap-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                      <div>
                        <div className="font-medium">
                          {child.display_name || child.institution_id}
                        </div>
                        {child.country_code && (
                          <div className="text-sm text-gray-500">
                            {getCountryName(child.country_code)}
                          </div>
                        )}
                      </div>
                      {child.type && (
                        <span className={`px-2 py-0.5 text-xs rounded-full ${childTypeColor}`}>
                          {child.type}
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {topCollaborators.length > 0 && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Handshake className="h-5 w-5" />
              Top Collaborating Institutions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {topCollaborators.map((collaborator, idx) => (
                <Link
                  key={`${collaborator.institution_id}-${idx}`}
                  href={`/affiliations/${collaborator.institution_id}`}
                  className="block"
                >
                  <div className="flex items-start justify-between gap-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                    <div>
                      <div className="font-medium">
                        {collaborator.display_name || collaborator.institution_id}
                      </div>
                      {collaborator.country_code && (
                        <div className="text-sm text-gray-500">
                          {getCountryName(collaborator.country_code)}
                        </div>
                      )}
                    </div>
                    <div className="text-sm text-gray-500">
                      {formatNumber(collaborator.joint_papers)} joint papers
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <OpenaireProjects institutionId={summary.institution_id} />
    </div>
  );
}
