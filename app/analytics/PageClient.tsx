"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Users, Eye, Globe, Monitor, Smartphone, MapPin, Search } from "lucide-react";
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
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

interface RecentVisitor {
  ip: string;
  country: string;
  timezone: string;
  lastVisit: number;
  pages: string[];
}

interface VisitorStats {
  totalVisitors: number;
  totalPageViews: number;
  visitorsByLocation: { city: string; country: string; lat: number; lon: number; count: number }[];
  visitorsOverTime: { date: string; visitors: number; pageViews: number }[];
  osBreakdown: { os: string; count: number }[];
  deviceBreakdown: { device: string; count: number }[];
  browserBreakdown: { browser: string; count: number }[];
  topPages: { path: string; count: number }[];
  topCountries: { country: string; count: number }[];
  pendingGeoCount: number;
  recentVisitors: RecentVisitor[];
}

const DEVICE_COLORS = {
  mobile: "#f97316",
  desktop: "#3b82f6",
};

const OS_COLORS: Record<string, string> = {
  Windows: "#0078d4",
  macOS: "#555555",
  iOS: "#007aff",
  Android: "#3ddc84",
  Linux: "#fcc624",
  ChromeOS: "#4285f4",
  Other: "#9ca3af",
};

const BROWSER_COLORS: Record<string, string> = {
  Chrome: "#4285f4",
  Safari: "#007aff",
  Firefox: "#ff7139",
  Edge: "#0078d4",
  Opera: "#ff1b2d",
  IE: "#1ebbee",
  Other: "#9ca3af",
};

export default function AnalyticsPage() {
  const [stats, setStats] = useState<VisitorStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [processingGeo, setProcessingGeo] = useState(false);

  const fetchStats = async (processGeo = false) => {
    try {
      if (processGeo) setProcessingGeo(true);
      const token = new URLSearchParams(window.location.search).get("token") || "";
      const url = `/api/analytics/stats?days=${days}${processGeo ? "&processGeo=true" : ""}`;
      const res = await fetch(url, {
        headers: token ? { "Authorization": `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        if (res.status === 401) throw new Error("Unauthorized - add ?token=YOUR_TOKEN to URL");
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setStats(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load stats");
    } finally {
      setLoading(false);
      setProcessingGeo(false);
    }
  };

  useEffect(() => {
    fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

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
          <p className="text-gray-500 mt-2">Make sure some visitors have been logged first.</p>
        </div>
      </div>
    );
  }

  const avgPagesPerVisitor =
    stats.totalVisitors > 0 ? (stats.totalPageViews / stats.totalVisitors).toFixed(1) : "0";
  const topCountry = stats.topCountries[0]?.country || "N/A";

  // Prepare device data for pie chart
  const deviceData = stats.deviceBreakdown.map((d) => ({
    name: d.device === "mobile" ? "Mobile" : "Desktop",
    value: d.count,
    color: DEVICE_COLORS[d.device as keyof typeof DEVICE_COLORS] || "#9ca3af",
  }));

  // Prepare OS data
  const osData = stats.osBreakdown.map((d) => ({
    ...d,
    color: OS_COLORS[d.os] || OS_COLORS.Other,
  }));

  // Prepare browser data
  const browserData = stats.browserBreakdown.map((d) => ({
    ...d,
    color: BROWSER_COLORS[d.browser] || BROWSER_COLORS.Other,
  }));

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 mb-2">
            <Users className="h-8 w-8 text-blue-600" />
            <h1 className="text-3xl font-bold">Visitor Analytics</h1>
          </div>
          <div className="flex items-center gap-4">
            {stats.pendingGeoCount > 0 && (
              <button
                onClick={() => fetchStats(true)}
                disabled={processingGeo}
                className="flex items-center gap-2 px-3 py-1.5 text-sm bg-green-50 text-green-700 dark:bg-green-900 dark:text-green-200 rounded-lg hover:bg-green-100 dark:hover:bg-green-800 transition-colors disabled:opacity-50"
              >
                {processingGeo ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MapPin className="h-4 w-4" />
                )}
                Lookup {stats.pendingGeoCount} IPs
              </button>
            )}
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="px-3 py-1.5 text-sm border rounded-lg dark:bg-gray-800 dark:border-gray-700"
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
              <option value={365}>Last year</option>
            </select>
          </div>
        </div>
        <p className="text-gray-500">Site traffic and visitor insights</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-4 w-4 text-blue-600" />
              <span className="text-sm text-gray-500">Unique Visitors</span>
            </div>
            <div className="text-3xl font-bold text-blue-600">
              {stats.totalVisitors.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-1">
              <Eye className="h-4 w-4 text-green-600" />
              <span className="text-sm text-gray-500">Page Views</span>
            </div>
            <div className="text-3xl font-bold text-green-600">
              {stats.totalPageViews.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-1">
              <Eye className="h-4 w-4 text-purple-600" />
              <span className="text-sm text-gray-500">Pages/Visitor</span>
            </div>
            <div className="text-3xl font-bold text-purple-600">{avgPagesPerVisitor}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 mb-1">
              <Globe className="h-4 w-4 text-orange-600" />
              <span className="text-sm text-gray-500">Top Country</span>
            </div>
            <div className="text-2xl font-bold text-orange-600 truncate" title={topCountry}>
              {topCountry}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Visitors (Last 24h) */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Users className="h-5 w-5" />
            Recent Visitors (Last 24h)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {stats.recentVisitors && stats.recentVisitors.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b dark:border-gray-700">
                    <th className="text-left py-2 pr-4 font-medium text-gray-500">IP</th>
                    <th className="text-left py-2 pr-4 font-medium text-gray-500">Country</th>
                    <th className="text-left py-2 pr-4 font-medium text-gray-500">Timezone</th>
                    <th className="text-left py-2 pr-4 font-medium text-gray-500">Last Visit</th>
                    <th className="text-left py-2 font-medium text-gray-500">Pages Visited</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recentVisitors.map((visitor) => (
                    <tr key={visitor.ip} className="border-b dark:border-gray-800">
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-1">
                          <span className="font-mono text-xs">{visitor.ip}</span>
                          <a
                            href={`https://who.is/whois-ip/ip-address/${visitor.ip}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-500 hover:text-blue-700"
                            title="WHOIS lookup"
                          >
                            <Search className="h-3 w-3" />
                          </a>
                        </div>
                      </td>
                      <td className="py-2 pr-4">{visitor.country || "Unknown"}</td>
                      <td className="py-2 pr-4 text-xs text-gray-500">{visitor.timezone || "—"}</td>
                      <td className="py-2 pr-4 text-xs text-gray-500">
                        {new Date(visitor.lastVisit).toLocaleString()}
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-1">
                          {visitor.pages.slice(0, 5).map((page, i) => (
                            <a
                              key={i}
                              href={page}
                              className="inline-block px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded-sm text-xs text-blue-600 hover:text-blue-800 hover:underline truncate max-w-[200px]"
                              title={page}
                            >
                              {page}
                            </a>
                          ))}
                          {visitor.pages.length > 5 && (
                            <span className="text-xs text-gray-400">
                              +{visitor.pages.length - 5} more
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-500 text-sm">No visitors in the last 24 hours.</p>
          )}
        </CardContent>
      </Card>

      {/* Visitors Over Time */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Visitors Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={stats.visitorsOverTime}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(d) => {
                    const date = new Date(d);
                    return `${date.getMonth() + 1}/${date.getDate()}`;
                  }}
                />
                <YAxis />
                <Tooltip
                  labelFormatter={(d) => new Date(d).toLocaleDateString()}
                  formatter={(value: number, name: string) => [
                    value.toLocaleString(),
                    name === "visitors" ? "Unique Visitors" : "Page Views",
                  ]}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="visitors"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dot={false}
                  name="Unique Visitors"
                />
                <Line
                  type="monotone"
                  dataKey="pageViews"
                  stroke="#22c55e"
                  strokeWidth={2}
                  dot={false}
                  name="Page Views"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Device and OS Charts */}
      <div className="grid lg:grid-cols-2 gap-6 mb-6">
        {/* Device Breakdown (Mobile vs Desktop) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Smartphone className="h-5 w-5" />
              Device Type
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={deviceData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {deviceData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: number) => value.toLocaleString()} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* OS Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Monitor className="h-5 w-5" />
              Operating System
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={osData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="os" width={80} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(value: number) => value.toLocaleString()} />
                  <Bar dataKey="count" name="Visitors">
                    {osData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Browser Breakdown */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Browser Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={browserData} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="browser" width={80} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value: number) => value.toLocaleString()} />
                <Bar dataKey="count" name="Visitors">
                  {browserData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Top Pages and Countries */}
      <div className="grid lg:grid-cols-2 gap-6">
        {/* Top Pages */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Pages</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {stats.topPages.slice(0, 10).map((page, idx) => (
                <div
                  key={page.path}
                  className="flex items-center justify-between py-2 border-b dark:border-gray-800"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-gray-400 text-sm w-6 shrink-0">{idx + 1}.</span>
                    <a
                      href={page.path}
                      className="truncate text-sm text-blue-600 hover:text-blue-800 hover:underline"
                      title={page.path}
                    >
                      {page.path}
                    </a>
                  </div>
                  <span className="text-blue-600 font-semibold tabular-nums ml-2">
                    {page.count.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Top Countries */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Top Countries
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {stats.topCountries.slice(0, 10).map((country, idx) => (
                <div
                  key={country.country}
                  className="flex items-center justify-between py-2 border-b dark:border-gray-800"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 text-sm w-6">{idx + 1}.</span>
                    <span>{country.country}</span>
                  </div>
                  <span className="text-orange-600 font-semibold tabular-nums">
                    {country.count.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
