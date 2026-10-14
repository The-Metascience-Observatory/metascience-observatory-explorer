"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Briefcase, GraduationCap, MapPin } from "lucide-react";
import type { AuthorCareer, AuthorAffiliationRecord } from "@/lib/types";

interface CareerTimelineProps {
  career: AuthorCareer;
}

function years(a: AuthorAffiliationRecord): string {
  if (a.startYear && a.endYear) return `${a.startYear} – ${a.endYear}`;
  if (a.startYear) return `${a.startYear} – present`;
  if (a.endYear) return `until ${a.endYear}`;
  return "date not stated";
}

function Row({
  a,
  badge,
}: {
  a: AuthorAffiliationRecord;
  badge?: string;
}) {
  return (
    <li className="relative pl-5 pb-4 last:pb-0">
      <span
        className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-blue-500"
        aria-hidden="true"
      />
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium text-gray-900">
          {a.orgName ?? "Unnamed organization"}
        </span>
        {a.country && (
          <span className="inline-flex items-center gap-0.5 text-xs text-gray-500">
            <MapPin className="h-3 w-3" aria-hidden="true" />
            {a.country}
          </span>
        )}
        {badge && (
          <span className="rounded-sm bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
            {badge}
          </span>
        )}
      </div>
      <div className="text-sm text-gray-600">{a.roleTitle}</div>
      <div className="text-xs text-gray-500">{years(a)}</div>
    </li>
  );
}

export function CareerTimeline({ career }: CareerTimelineProps) {
  const { identity, employment, education } = career;

  // Nothing self-reported for this author -> render nothing at all, rather than
  // an empty card implying the data is missing for a reason.
  if (!identity || (employment.length === 0 && education.length === 0)) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Briefcase className="h-5 w-5" aria-hidden="true" />
          Career history
        </CardTitle>
      </CardHeader>
      <CardContent>
        {(identity.phdYear || identity.nCountries > 1) && (
          <div className="mb-4 flex flex-wrap gap-4 text-sm">
            {identity.phdYear && (
              <div>
                <span className="text-gray-500">Doctorate</span>{" "}
                <span className="font-medium">{identity.phdYear}</span>
              </div>
            )}
            {identity.nOrgs > 0 && (
              <div>
                <span className="text-gray-500">Organizations</span>{" "}
                <span className="font-medium">{identity.nOrgs}</span>
              </div>
            )}
            {identity.nCountries > 1 && (
              <div>
                <span className="text-gray-500">Countries</span>{" "}
                <span className="font-medium">{identity.nCountries}</span>
              </div>
            )}
          </div>
        )}

        {employment.length > 0 && (
          <>
            <h3 className="mb-2 text-sm font-semibold text-gray-700">Employment</h3>
            <ul className="mb-4 border-l border-gray-200 pl-2">
              {employment.map((a, i) => (
                <Row key={`emp-${i}`} a={a} />
              ))}
            </ul>
          </>
        )}

        {education.length > 0 && (
          <>
            <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-700">
              <GraduationCap className="h-4 w-4" aria-hidden="true" />
              Education
            </h3>
            <ul className="border-l border-gray-200 pl-2">
              {education.map((a, i) => (
                <Row key={`edu-${i}`} a={a} badge={a.isDoctorate ? "Doctorate" : undefined} />
              ))}
            </ul>
          </>
        )}

        {/* This is self-reported data, and saying so is not optional: it is
            entered by the researcher, is often incomplete, and exists for only
            ~2M of 100M authors. Presenting it as authoritative would mislead. */}
        <p className="mt-4 border-t border-gray-100 pt-3 text-xs text-gray-500">
          Self-reported by the researcher on their{" "}
          <a
            href={`https://orcid.org/${identity.orcid}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            ORCID record
          </a>
          . May be incomplete — absence of an entry does not mean absence of a role.
        </p>
      </CardContent>
    </Card>
  );
}
