"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  ComposableMap,
  Geographies,
  Geography,
  ZoomableGroup,
} from "react-simple-maps";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { formatNumber, getCountryName } from "@/lib/utils";

const GEO_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json";

// ISO 3166-1 numeric to alpha-2 mapping (world-atlas uses numeric IDs)
const numericToAlpha2: Record<string, string> = {
  "4": "AF", "8": "AL", "12": "DZ", "20": "AD", "24": "AO", "28": "AG", "32": "AR",
  "51": "AM", "36": "AU", "40": "AT", "31": "AZ", "44": "BS", "48": "BH", "50": "BD",
  "52": "BB", "112": "BY", "56": "BE", "84": "BZ", "204": "BJ", "64": "BT", "68": "BO",
  "70": "BA", "72": "BW", "76": "BR", "96": "BN", "100": "BG", "854": "BF", "108": "BI",
  "116": "KH", "120": "CM", "124": "CA", "132": "CV", "140": "CF", "148": "TD", "152": "CL",
  "156": "CN", "170": "CO", "174": "KM", "178": "CG", "180": "CD", "188": "CR", "384": "CI",
  "191": "HR", "192": "CU", "196": "CY", "203": "CZ", "208": "DK", "262": "DJ", "212": "DM",
  "214": "DO", "218": "EC", "818": "EG", "222": "SV", "226": "GQ", "232": "ER", "233": "EE",
  "231": "ET", "242": "FJ", "246": "FI", "250": "FR", "266": "GA", "270": "GM", "268": "GE",
  "276": "DE", "288": "GH", "300": "GR", "304": "GL", "308": "GD", "320": "GT", "324": "GN",
  "624": "GW", "328": "GY", "332": "HT", "340": "HN", "344": "HK", "348": "HU", "352": "IS",
  "356": "IN", "360": "ID", "364": "IR", "368": "IQ", "372": "IE", "376": "IL", "380": "IT",
  "388": "JM", "392": "JP", "400": "JO", "398": "KZ", "404": "KE", "296": "KI", "408": "KP",
  "410": "KR", "414": "KW", "417": "KG", "418": "LA", "428": "LV", "422": "LB", "426": "LS",
  "430": "LR", "434": "LY", "438": "LI", "440": "LT", "442": "LU", "446": "MO", "807": "MK",
  "450": "MG", "454": "MW", "458": "MY", "462": "MV", "466": "ML", "470": "MT", "584": "MH",
  "478": "MR", "480": "MU", "484": "MX", "583": "FM", "498": "MD", "492": "MC", "496": "MN",
  "499": "ME", "504": "MA", "508": "MZ", "104": "MM", "516": "NA", "520": "NR", "524": "NP",
  "528": "NL", "554": "NZ", "558": "NI", "562": "NE", "566": "NG", "578": "NO", "512": "OM",
  "586": "PK", "585": "PW", "275": "PS", "591": "PA", "598": "PG", "600": "PY", "604": "PE",
  "608": "PH", "616": "PL", "620": "PT", "630": "PR", "634": "QA", "642": "RO", "643": "RU",
  "646": "RW", "682": "SA", "686": "SN", "688": "RS", "690": "SC", "694": "SL", "702": "SG",
  "703": "SK", "705": "SI", "90": "SB", "706": "SO", "710": "ZA", "728": "SS", "724": "ES",
  "144": "LK", "729": "SD", "740": "SR", "748": "SZ", "752": "SE", "756": "CH", "760": "SY",
  "158": "TW", "762": "TJ", "834": "TZ", "764": "TH", "626": "TL", "768": "TG", "776": "TO",
  "780": "TT", "788": "TN", "792": "TR", "795": "TM", "798": "TV", "800": "UG", "804": "UA",
  "784": "AE", "826": "GB", "840": "US", "858": "UY", "860": "UZ", "548": "VU", "336": "VA",
  "862": "VE", "704": "VN", "887": "YE", "894": "ZM", "716": "ZW", "-99": "XK",
};

interface CountryData {
  country_code: string;
  funder_count: number;
  total_works: number;
}

export default function FundersMapPage() {
  const router = useRouter();
  const [countries, setCountries] = useState<CountryData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tooltipContent, setTooltipContent] = useState<{
    name: string;
    funders: number;
    works: number;
  } | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch("/api/funders/by-country");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setCountries(data.countries || []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  // Create lookup map from alpha-2 country code to data
  const countryDataMap = useMemo(() => {
    const map = new Map<string, CountryData>();
    for (const c of countries) {
      map.set(c.country_code, c);
    }
    return map;
  }, [countries]);

  // Calculate color scale
  const maxFunders = useMemo(() => {
    if (countries.length === 0) return 1;
    return Math.max(...countries.map((c) => c.funder_count));
  }, [countries]);

  const getAlpha2 = (geo: { id?: string }) => {
    const numericId = geo.id;
    if (!numericId) return undefined;
    // Strip leading zeros to match our mapping (e.g., "036" -> "36")
    const normalizedId = String(parseInt(numericId, 10));
    return numericToAlpha2[normalizedId];
  };

  const getColor = (alpha2: string | undefined) => {
    if (!alpha2) return "#f0f0f0";
    const data = countryDataMap.get(alpha2);
    if (!data) return "#f0f0f0";
    // Log scale for better visualization
    const intensity = Math.log(data.funder_count + 1) / Math.log(maxFunders + 1);
    // Blue gradient
    const r = Math.round(220 - intensity * 180);
    const g = Math.round(230 - intensity * 140);
    const b = Math.round(250 - intensity * 50);
    return `rgb(${r}, ${g}, ${b})`;
  };

  const handleMouseEnter = (
    geo: { properties: { name: string }; id?: string },
    evt: React.MouseEvent
  ) => {
    const alpha2 = getAlpha2(geo);
    const data = alpha2 ? countryDataMap.get(alpha2) : null;

    if (data) {
      setTooltipContent({
        name: getCountryName(alpha2),
        funders: data.funder_count,
        works: data.total_works,
      });
    } else {
      setTooltipContent({
        name: geo.properties.name || "Unknown",
        funders: 0,
        works: 0,
      });
    }
    setTooltipPos({ x: evt.clientX, y: evt.clientY });
  };

  const handleMouseMove = (evt: React.MouseEvent) => {
    setTooltipPos({ x: evt.clientX, y: evt.clientY });
  };

  const handleMouseLeave = () => {
    setTooltipContent(null);
  };

  const handleClick = (geo: { id?: string }) => {
    const alpha2 = getAlpha2(geo);
    if (alpha2 && countryDataMap.has(alpha2)) {
      router.push(`/funders-map/${alpha2}`);
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          <span className="ml-3 text-gray-500">Loading funders map...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center py-24">
          <p className="text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">Funders Map</h1>
        <p className="text-sm text-gray-500">
          Using funders data from{" "}
          <a href="https://northwestern-cssi.github.io/sciscinet/" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-700">SciSciNet-V2</a>
          , derived from{" "}
          <a href="https://openalex.org/" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-700">OpenAlex</a>
          {" "}data
        </p>
      </div>
      <Card className="mb-6">
        <CardContent className="p-0 relative flex justify-center">
          <ComposableMap
            projection="geoMercator"
            projectionConfig={{
              scale: 130,
              center: [0, 30],
            }}
            style={{ width: "80%", height: "auto" }}
          >
            <ZoomableGroup>
              <Geographies geography={GEO_URL}>
                {({ geographies }) =>
                  geographies.map((geo) => {
                    const alpha2 = getAlpha2(geo);
                    const hasData = alpha2 && countryDataMap.has(alpha2);

                    return (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        onMouseEnter={(evt) => handleMouseEnter(geo, evt)}
                        onMouseMove={handleMouseMove}
                        onMouseLeave={handleMouseLeave}
                        onClick={() => handleClick(geo)}
                        style={{
                          default: {
                            fill: getColor(alpha2),
                            stroke: "#fff",
                            strokeWidth: 0.5,
                            outline: "none",
                            cursor: hasData ? "pointer" : "default",
                          },
                          hover: {
                            fill: hasData ? "#3b82f6" : "#e5e7eb",
                            stroke: "#fff",
                            strokeWidth: 0.5,
                            outline: "none",
                            cursor: hasData ? "pointer" : "default",
                          },
                          pressed: {
                            fill: "#2563eb",
                            stroke: "#fff",
                            strokeWidth: 0.5,
                            outline: "none",
                          },
                        }}
                      />
                    );
                  })
                }
              </Geographies>
            </ZoomableGroup>
          </ComposableMap>

          {/* Tooltip */}
          {tooltipContent && (
            <div
              className="fixed z-50 pointer-events-none bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-sm"
              style={{
                left: tooltipPos.x + 10,
                top: tooltipPos.y + 10,
              }}
            >
              <div className="font-semibold">{tooltipContent.name}</div>
              {tooltipContent.funders > 0 ? (
                <>
                  <div className="text-gray-600">
                    {formatNumber(tooltipContent.funders)} funders
                  </div>
                  <div className="text-gray-500 text-xs">
                    {formatNumber(tooltipContent.works)} funded works
                  </div>
                </>
              ) : (
                <div className="text-gray-400">No funders</div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
