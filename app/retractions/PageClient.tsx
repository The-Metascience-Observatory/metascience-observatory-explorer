"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, AlertTriangle, TrendingUp, Building2, BookOpen, Search } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";

interface RetractionStats {
  totalRetractions: number;
  totalConcerns: number;
  totalCorrections: number;
  totalReinstatements: number;
  matchedToPapers: number;
  byYear: { year: number; count: number; nature: string }[];
  topReasons: { reason: string; count: number }[];
  topJournals: { journal: string; count: number }[];
  topPublishers: { publisher: string; count: number }[];
  paperMillByYear: { year: number; count: number }[];
  journalsByRate: {
    sourceid: string;
    journal: string;
    rate: number;
    retractions: number;
    papersSince2010: number;
  }[];
}

const COLORS = {
  Retraction: "#ef4444",
  "Expression of concern": "#f97316",
  Correction: "#eab308",
  Reinstatement: "#22c55e",
};

export default function RetractionsAnalyticsPage() {
  const [stats, setStats] = useState<RetractionStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [minPapers, setMinPapers] = useState(100); // Minimum papers threshold for rate filter
  const [startYear, setStartYear] = useState(2010);
  const [endYear, setEndYear] = useState(2025);
  const [rateLoading, setRateLoading] = useState(false);

  // Initial fetch
  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch("/api/retractions/stats");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setStats(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load stats");
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, []);

  // Refetch journals by rate when date range changes
  useEffect(() => {
    // Skip if no stats loaded yet, or if using default range
    if (!stats) return;
    if (startYear === 2010 && endYear === 2025) return;

    async function fetchRateData() {
      setRateLoading(true);
      try {
        const res = await fetch(`/api/retractions/stats?startYear=${startYear}&endYear=${endYear}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        // Only update the journalsByRate field
        setStats(prev => prev ? { ...prev, journalsByRate: data.journalsByRate } : null);
      } catch (e) {
        console.error("Failed to fetch rate data:", e);
      } finally {
        setRateLoading(false);
      }
    }
    fetchRateData();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startYear, endYear]);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          <span className="ml-3 text-gray-500">Loading analytics...</span>
        </div>
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center py-24">
          <p className="text-red-600 text-lg">{error || "Failed to load analytics"}</p>
        </div>
      </div>
    );
  }

  // Process data for charts
  const yearlyData = processYearlyData(stats.byYear);
  const natureDistribution = [
    { name: "Retractions", value: stats.totalRetractions, color: COLORS.Retraction },
    { name: "Expressions of Concern", value: stats.totalConcerns, color: COLORS["Expression of concern"] },
    { name: "Corrections", value: stats.totalCorrections, color: COLORS.Correction },
    { name: "Reinstatements", value: stats.totalReinstatements, color: COLORS.Reinstatement },
  ].filter(d => d.value > 0);

  const totalRecords = stats.totalRetractions + stats.totalConcerns + stats.totalCorrections + stats.totalReinstatements;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-8">
      {/* Header */}
      <div className="mb-8">
        {/* Heading lives in the server component (app/retractions/page.tsx) so
            the <h1> is in the initial HTML — this component returns a spinner
            until its client fetch resolves. */}
        <div className="flex items-center justify-end">
          <Link
            href="/retractions/search"
            className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-50 text-blue-700 dark:bg-blue-900 dark:text-blue-200 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-800 transition-colors"
          >
            <Search className="h-4 w-4" />
            Search Retractions
          </Link>
        </div>
        <p className="text-gray-500">
          Insights from {totalRecords.toLocaleString()} records in the{" "}
          <a
            href="https://retractionwatch.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            Retraction Watch
          </a>{" "}
          database
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardContent className="pt-6">
            <div className="text-3xl font-bold text-red-600">{stats.totalRetractions.toLocaleString()}</div>
            <div className="text-sm text-gray-500">Retractions</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-3xl font-bold text-orange-600">{stats.totalConcerns.toLocaleString()}</div>
            <div className="text-sm text-gray-500">Expressions of Concern</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-3xl font-bold text-yellow-600">{stats.totalCorrections.toLocaleString()}</div>
            <div className="text-sm text-gray-500">Corrections</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-3xl font-bold text-blue-600">
              {((stats.matchedToPapers / totalRecords) * 100).toFixed(1)}%
            </div>
            <div className="text-sm text-gray-500">Matched to Papers</div>
          </CardContent>
        </Card>
      </div>

      {/* Charts row 1 */}
      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        {/* Retractions over time */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Retractions Over Time
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={yearlyData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="year" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="Retraction"
                    stroke={COLORS.Retraction}
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="Expression of concern"
                    stroke={COLORS["Expression of concern"]}
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Distribution pie chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Distribution by Type</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={natureDistribution}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {natureDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Paper Mill trend */}
      {stats.paperMillByYear.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-red-500" />
              Paper Mill Retractions (2015-Present)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.paperMillByYear}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="year" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="count" fill="#dc2626" name="Paper Mill Retractions" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top reasons and journals */}
      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        {/* Top reasons */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Retraction Reasons</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.topReasons.slice(0, 10)} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="reason" width={120} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#6366f1" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Top publishers */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Top Publishers by Retraction Count
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.topPublishers.slice(0, 10)} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="publisher" width={100} tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#8b5cf6" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top journals list */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Journals with Most Retractions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-x-8">
            {stats.topJournals.slice(0, 20).map((journal, idx) => (
              <div
                key={journal.journal}
                className="flex items-center justify-between py-2 border-b dark:border-gray-800"
              >
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 text-sm w-6">{idx + 1}.</span>
                  <span className="truncate max-w-[250px]" title={journal.journal}>
                    {journal.journal}
                  </span>
                </div>
                <span className="text-red-600 font-semibold tabular-nums">
                  {journal.count.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Journals by retraction rate */}
      {stats.journalsByRate && stats.journalsByRate.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-red-500" />
              Journals by Retraction Rate
              {rateLoading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* Filters */}
            <div className="mb-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-4">
              {/* Date range slider */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium">
                    Retraction date range: {startYear} – {endYear}
                  </label>
                </div>
                <div className="flex items-center gap-4">
                  <input
                    type="range"
                    min="2010"
                    max="2025"
                    value={startYear}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (val <= endYear) setStartYear(val);
                    }}
                    className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                  />
                  <input
                    type="range"
                    min="2010"
                    max="2025"
                    value={endYear}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (val >= startYear) setEndYear(val);
                    }}
                    className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                  />
                </div>
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>2010</span>
                  <span>2015</span>
                  <span>2020</span>
                  <span>2025</span>
                </div>
              </div>

              {/* Minimum papers slider */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium">
                    Minimum papers since 2010: {minPapers.toLocaleString()}
                  </label>
                  <span className="text-xs text-gray-500">
                    {stats.journalsByRate.filter(j => j.papersSince2010 >= minPapers).length} journals shown
                  </span>
                </div>
                <input
                  type="range"
                  min="100"
                  max="10000"
                  step="100"
                  value={minPapers}
                  onChange={(e) => setMinPapers(Number(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
                />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>100</span>
                  <span>2,500</span>
                  <span>5,000</span>
                  <span>7,500</span>
                  <span>10,000</span>
                </div>
              </div>
            </div>

            {/* Journals list */}
            <div className="grid md:grid-cols-2 gap-x-8">
              {stats.journalsByRate
                .filter(j => j.papersSince2010 >= minPapers)
                .slice(0, 20)
                .map((journal, idx) => (
                  <div
                    key={journal.sourceid || journal.journal}
                    className="flex items-center justify-between py-2 border-b dark:border-gray-800"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="text-gray-400 text-sm w-6 flex-shrink-0">{idx + 1}.</span>
                      {journal.sourceid ? (
                        <Link
                          href={`/journals/${journal.sourceid}`}
                          className="truncate text-blue-600 hover:text-blue-800 hover:underline"
                          title={journal.journal}
                        >
                          {journal.journal}
                        </Link>
                      ) : (
                        <span className="truncate" title={journal.journal}>
                          {journal.journal}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0 ml-2">
                      <span className="text-xs text-gray-500">
                        {journal.retractions}/{journal.papersSince2010.toLocaleString()}
                      </span>
                      <span
                        className={`font-semibold tabular-nums ${
                          journal.rate >= 5
                            ? "text-red-600"
                            : journal.rate >= 1
                            ? "text-orange-600"
                            : "text-yellow-600"
                        }`}
                      >
                        {journal.rate.toFixed(2)}%
                      </span>
                    </div>
                  </div>
                ))}
            </div>

            <p className="text-xs text-gray-400 mt-4">
              Rate = retractions ({startYear}–{endYear}) ÷ papers published since 2010. Only journals with ≥{minPapers.toLocaleString()} papers shown.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Process yearly data into chart format
function processYearlyData(byYear: { year: number; count: number; nature: string }[]) {
  const yearMap = new Map<number, Record<string, number>>();

  for (const row of byYear) {
    if (!yearMap.has(row.year)) {
      yearMap.set(row.year, { year: row.year });
    }
    const entry = yearMap.get(row.year)!;
    entry[row.nature] = row.count;
  }

  return Array.from(yearMap.values()).sort((a, b) => a.year - b.year);
}
