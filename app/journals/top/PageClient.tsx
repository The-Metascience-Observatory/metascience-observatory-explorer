"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatNumber } from "@/lib/utils";
import { ArrowLeft, Loader2, ChevronUp, ChevronDown } from "lucide-react";
import type { TopJournalsResponse } from "@/app/api/journals/top/route";

type SortField = 'impact_factor_2yr' | 'impact_factor_5yr' | 'citescore' | 'total_papers' | 'total_citations';

const SORT_LABELS: Record<SortField, string> = {
  impact_factor_2yr: '2-Year IF',
  impact_factor_5yr: '5-Year IF',
  citescore: 'CiteScore',
  total_papers: 'Papers',
  total_citations: 'Citations',
};

export default function TopJournalsClient({
  initialData,
  page,
}: {
  initialData: TopJournalsResponse;
  page: number;
}) {
  // Seeded from the server render, so the table is in the initial HTML.
  const [data, setData] = useState<TopJournalsResponse | null>(initialData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sorting and filtering stay client-side; `page` is owned by the URL so the
  // ranked list is crawlable and linkable.
  const [sortField, setSortField] = useState<SortField>('impact_factor_2yr');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [selectedField, setSelectedField] = useState<string>('');
  const [dirty, setDirty] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        sort: sortField,
        order: sortOrder,
        page: page.toString(),
        limit: '50',
      });
      if (selectedField) {
        params.set('field', selectedField);
      }

      const res = await fetch(`/api/journals/top?${params}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load journals");
    } finally {
      setLoading(false);
    }
  }, [sortField, sortOrder, selectedField, page]);

  useEffect(() => {
    if (dirty) fetchData();
  }, [dirty, fetchData]);

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
    setDirty(true);
  };

  const handleFieldChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedField(e.target.value);
    setDirty(true);
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (field !== sortField) return null;
    return sortOrder === 'asc' ? (
      <ChevronUp className="h-4 w-4 inline ml-1" />
    ) : (
      <ChevronDown className="h-4 w-4 inline ml-1" />
    );
  };

  const formatMetric = (value: number | null, decimals: number = 2) => {
    if (value === null || value === undefined) return '—';
    return value.toFixed(decimals);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-4">
      {/* Back link */}
      <Link
        href="/"
        className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to search
      </Link>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-2xl">Journal Rankings</CardTitle>
          <p className="text-sm text-gray-500 mt-1">
            Ranked by impact metrics computed from OpenAlex citation data
            {data?.metricsYear && ` (${data.metricsYear})`}
          </p>
        </CardHeader>

        <CardContent>
          {/* Filters */}
          <div className="flex flex-wrap gap-4 mb-6">
            <div>
              <label htmlFor="field-filter" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Field
              </label>
              <select
                id="field-filter"
                value={selectedField}
                onChange={handleFieldChange}
                className="block w-48 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-xs focus:outline-hidden focus:ring-blue-500 focus:border-blue-500 text-sm"
              >
                <option value="">All Fields</option>
                {data?.fields.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Sort by
              </label>
              <select
                value={sortField}
                onChange={(e) => {
                  setSortField(e.target.value as SortField);
                  setDirty(true);
                }}
                className="block w-40 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md shadow-xs focus:outline-hidden focus:ring-blue-500 focus:border-blue-500 text-sm"
              >
                {Object.entries(SORT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
              <span className="ml-3 text-gray-500">Loading journals...</span>
            </div>
          )}

          {error && (
            <div className="text-center py-12">
              <p className="text-red-600 text-lg">{error}</p>
            </div>
          )}

          {!loading && !error && data && (
            <>
              {/* Results count */}
              <p className="text-sm text-gray-500 mb-4">
                Showing {((page - 1) * 50) + 1}–{Math.min(page * 50, data.total)} of {formatNumber(data.total)} journals
                {selectedField && ` in ${selectedField}`}
              </p>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-800">
                    <tr>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider w-12">
                        #
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                        Journal
                      </th>
                      <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden md:table-cell">
                        Field
                      </th>
                      <th
                        className="px-3 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-700 dark:hover:text-gray-200"
                        onClick={() => handleSort('impact_factor_2yr')}
                      >
                        2Y IF <SortIcon field="impact_factor_2yr" />
                      </th>
                      <th
                        className="px-3 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 hidden sm:table-cell"
                        onClick={() => handleSort('impact_factor_5yr')}
                      >
                        5Y IF <SortIcon field="impact_factor_5yr" />
                      </th>
                      <th
                        className="px-3 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 hidden sm:table-cell"
                        onClick={() => handleSort('citescore')}
                      >
                        CiteScore <SortIcon field="citescore" />
                      </th>
                      <th
                        className="px-3 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:text-gray-700 dark:hover:text-gray-200 hidden lg:table-cell"
                        onClick={() => handleSort('total_papers')}
                      >
                        Papers <SortIcon field="total_papers" />
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                    {data.journals.map((journal, idx) => (
                      <tr key={journal.sourceid} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                        <td className="px-3 py-3 text-sm text-gray-500 dark:text-gray-400">
                          {(page - 1) * 50 + idx + 1}
                        </td>
                        <td className="px-3 py-3">
                          <Link
                            href={`/journals/${journal.sourceid}`}
                            className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
                          >
                            {journal.display_name}
                          </Link>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            {journal.publisher}
                            {journal.is_oa && (
                              <span className="ml-2 text-green-600 dark:text-green-400">OA</span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-sm text-gray-500 dark:text-gray-400 hidden md:table-cell">
                          {journal.primary_field_l0_name || '—'}
                        </td>
                        <td className="px-3 py-3 text-sm text-right font-mono">
                          {formatMetric(journal.impact_factor_2yr)}
                        </td>
                        <td className="px-3 py-3 text-sm text-right font-mono hidden sm:table-cell">
                          {formatMetric(journal.impact_factor_5yr)}
                        </td>
                        <td className="px-3 py-3 text-sm text-right font-mono hidden sm:table-cell">
                          {formatMetric(journal.citescore)}
                        </td>
                        <td className="px-3 py-3 text-sm text-right font-mono hidden lg:table-cell">
                          {formatNumber(journal.total_papers)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination is rendered by the server component as real
                  <a href="?page=N"> links, so the ranking is crawlable and each
                  page has its own URL. */}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
