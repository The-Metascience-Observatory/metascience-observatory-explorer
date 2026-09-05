"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { NetMobilityChart, TopFlowsChart } from "@/components/trends/MobilityChart";
import type { CountryTotal, Flow } from "@/components/trends/MobilityChart";
import { CareerAgeChart } from "@/components/trends/CareerAgeChart";
import type { CareerAgePoint } from "@/components/trends/CareerAgeChart";
import { StudyDesignChart } from "@/components/trends/StudyDesignChart";
import type { DesignYear } from "@/components/trends/StudyDesignChart";
import {
  StudyDesignLines,
  StudyDesignFacets,
  RctTrendChart,
} from "@/components/trends/StudyDesignVariants";

interface Coverage {
  source: string;
  note: string;
}

interface MobilityPayload {
  flows: Flow[];
  totals: CountryTotal[];
  totalMoves: number;
  coverage: Coverage;
}

interface CareerAgePayload {
  careerAge: CareerAgePoint[];
  totalAuthors: number;
  coverage: Coverage;
}

interface DesignPayload {
  series: DesignYear[];
  designs: string[];
  totalArticles: number;
  coverage: Coverage;
}

/** Coverage is stated next to every figure, never only in a footnote elsewhere. */
function CoverageNote({ coverage, n, unit }: { coverage: Coverage; n: number; unit: string }) {
  return (
    <p className="mt-3 border-t border-gray-100 pt-3 text-xs text-gray-500">
      <span className="font-medium text-gray-600">
        {n.toLocaleString()} {unit}
      </span>{" "}
      · {coverage.source}. {coverage.note}
    </p>
  );
}

/** Table view — the relief the palette validator requires for the low-contrast
 *  series, and an accessible alternative to reading the chart by colour. */
function FlowTable({ flows }: { flows: Flow[] }) {
  if (flows.length === 0) return null;
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-700">
        View as table
      </summary>
      <div className="mt-2 max-h-64 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b text-left text-gray-500">
              <th className="py-1 font-medium">From</th>
              <th className="py-1 font-medium">To</th>
              <th className="py-1 text-right font-medium">Moves</th>
            </tr>
          </thead>
          <tbody>
            {flows.map((f, i) => (
              <tr key={i} className="border-b border-gray-100">
                <td className="py-1">{f.from_country}</td>
                <td className="py-1">{f.to_country}</td>
                <td className="py-1 text-right tabular-nums">{f.n.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export default function TrendsPageClient() {
  const [mobility, setMobility] = useState<MobilityPayload | null>(null);
  const [careerAge, setCareerAge] = useState<CareerAgePayload | null>(null);
  const [designs, setDesigns] = useState<DesignPayload | null>(null);
  const [loading, setLoading] = useState(true);

  // Fail-soft, like every other optional-data surface in the app: if identity.db
  // is absent both endpoints return empty and the sections simply don't render.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [mRes, cRes, dRes] = await Promise.all([
        fetch("/api/trends/mobility").catch(() => null),
        fetch("/api/trends/career-age").catch(() => null),
        fetch("/api/trends/study-designs").catch(() => null),
      ]);
      if (mRes?.ok) {
        try {
          const j = (await mRes.json()) as MobilityPayload;
          if (!cancelled && j.flows?.length) setMobility(j);
        } catch {
          /* optional enrichment */
        }
      }
      if (cRes?.ok) {
        try {
          const j = (await cRes.json()) as CareerAgePayload;
          if (!cancelled && j.careerAge?.length) setCareerAge(j);
        } catch {
          /* optional enrichment */
        }
      }
      if (dRes?.ok) {
        try {
          const j = (await dRes.json()) as DesignPayload;
          if (!cancelled && j.series?.length) setDesigns(j);
        } catch {
          /* optional enrichment */
        }
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const nothing = !loading && !mobility && !careerAge && !designs;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-1 text-2xl font-bold">Metascience trends</h1>
      <p className="mb-6 text-sm text-gray-600">
        Aggregate views of the research workforce and literature, computed across the
        full corpus rather than a single entity.
      </p>

      {loading && <div className="py-12 text-center text-gray-500">Loading trends…</div>}

      {nothing && (
        <div className="rounded border border-gray-200 bg-gray-50 p-6 text-sm text-gray-600">
          Trend data is not available on this deployment.
        </div>
      )}

      {designs && (
        <>
          <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <strong>Four ways of showing the same data</strong> — pick whichever reads
            best and the other three come out. They share one dataset and one set of
            caveats; only the visual form differs.
          </div>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle>A · Evidence tiers over time (stacked)</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-sm text-gray-600">
                Composition view: how the mix of study designs shifted. Good for
                &ldquo;what is the literature made of&rdquo;; harder for reading any one
                tier, since a band&apos;s thickness is easy to misread as its height.
              </p>
              <StudyDesignChart series={designs.series} />
              <CoverageNote
                coverage={designs.coverage}
                n={designs.totalArticles}
                unit="indexed articles"
              />
            </CardContent>
          </Card>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle>B · Evidence tiers over time (lines)</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-sm text-gray-600">
                Same four tiers, unstacked. Each trajectory is directly readable, at the
                cost of losing the &ldquo;adds up to the whole&rdquo; reading.
              </p>
              <StudyDesignLines series={designs.series} />
              <CoverageNote
                coverage={designs.coverage}
                n={designs.totalArticles}
                unit="indexed articles"
              />
            </CardContent>
          </Card>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle>C · Every design type, small multiples</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-sm text-gray-600">
                All eight publication types at full detail. One series per panel means no
                colour-separation limit applies, so nothing has to be grouped. Each panel
                has its own y-scale — shapes are comparable, heights are not, so every
                panel states its own peak.
              </p>
              <StudyDesignFacets series={designs.series} />
              <CoverageNote
                coverage={designs.coverage}
                n={designs.totalArticles}
                unit="indexed articles"
              />
            </CardContent>
          </Card>

          <Card className="mb-6">
            <CardHeader>
              <CardTitle>D · Randomised controlled trials alone</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-sm text-gray-600">
                One series, one claim: the share of indexed literature reporting a
                randomised trial. The clearest statement if RCT growth is the point;
                says nothing about the rest.
              </p>
              <RctTrendChart series={designs.series} />
              <CoverageNote
                coverage={designs.coverage}
                n={designs.totalArticles}
                unit="indexed articles"
              />
            </CardContent>
          </Card>
        </>
      )}

      {careerAge && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Cumulative output by career age</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-gray-600">
              Median <em>lifetime</em> publication count against years since the
              researcher&apos;s doctorate. This is cumulative output, not a per-year rate,
              so it rises by construction — the informative part is the slope and where
              it flattens. Career age is measurable only where a doctorate year is
              stated, which is why this covers a small, self-selected slice of authors.
            </p>
            <CareerAgeChart data={careerAge.careerAge} />
            <CoverageNote
              coverage={careerAge.coverage}
              n={careerAge.totalAuthors}
              unit="authors"
            />
          </CardContent>
        </Card>
      )}

      {mobility && (
        <>
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Net researcher mobility by country</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-sm text-gray-600">
                Moves between countries inferred from consecutive employment records.
                Blue is net inflow, amber net outflow.
              </p>
              <NetMobilityChart data={mobility.totals} />
              <CoverageNote
                coverage={mobility.coverage}
                n={mobility.totalMoves}
                unit="moves"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Most common country-to-country moves</CardTitle>
            </CardHeader>
            <CardContent>
              <TopFlowsChart data={mobility.flows} />
              <FlowTable flows={mobility.flows.slice(0, 20)} />
              <CoverageNote
                coverage={mobility.coverage}
                n={mobility.totalMoves}
                unit="moves"
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
