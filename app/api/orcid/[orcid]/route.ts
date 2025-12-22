import { NextResponse } from "next/server";
import { getCachedOrcid, setCachedOrcid } from "@/lib/db";
import { fetchWithTimeout } from "@/lib/api-utils";
import { XMLParser } from "fast-xml-parser";
import type { OrcidEducation, OrcidEmployment, OrcidData } from "@/lib/types";

// Parse ORCID date structure
function parseOrcidYear(dateObj: unknown): number | null {
  if (!dateObj || typeof dateObj !== 'object') return null;
  const year = (dateObj as Record<string, unknown>)['year'];
  if (year && typeof year === 'object') {
    const value = (year as Record<string, unknown>)['value'];
    if (value) return parseInt(String(value), 10);
  }
  return null;
}

// Parse education entries from ORCID XML
function parseEducations(data: unknown): OrcidEducation[] {
  const results: OrcidEducation[] = [];

  try {
    const educations = data as Record<string, unknown>;
    const groups = educations['affiliation-group'];
    if (!groups) return results;

    const groupArray = Array.isArray(groups) ? groups : [groups];

    for (const group of groupArray) {
      const summaries = (group as Record<string, unknown>)['education-summary'];
      if (!summaries) continue;

      const summaryArray = Array.isArray(summaries) ? summaries : [summaries];

      for (const summary of summaryArray) {
        const s = summary as Record<string, unknown>;
        const org = s['organization'] as Record<string, unknown> | undefined;
        const address = org?.['address'] as Record<string, unknown> | undefined;

        if (!org?.['name']) continue;

        results.push({
          institution: String(org['name']),
          degree: s['role-title'] ? String(s['role-title']) : null,
          department: s['department-name'] ? String(s['department-name']) : null,
          startYear: parseOrcidYear(s['start-date']),
          endYear: parseOrcidYear(s['end-date']),
          city: address?.['city'] ? String(address['city']) : null,
          country: address?.['country'] ? String(address['country']) : null,
        });
      }
    }
  } catch (error) {
    console.error('Error parsing ORCID educations:', error);
  }

  return results;
}

// Parse employment entries from ORCID XML
function parseEmployments(data: unknown): OrcidEmployment[] {
  const results: OrcidEmployment[] = [];

  try {
    const employments = data as Record<string, unknown>;
    const groups = employments['affiliation-group'];
    if (!groups) return results;

    const groupArray = Array.isArray(groups) ? groups : [groups];

    for (const group of groupArray) {
      const summaries = (group as Record<string, unknown>)['employment-summary'];
      if (!summaries) continue;

      const summaryArray = Array.isArray(summaries) ? summaries : [summaries];

      for (const summary of summaryArray) {
        const s = summary as Record<string, unknown>;
        const org = s['organization'] as Record<string, unknown> | undefined;
        const address = org?.['address'] as Record<string, unknown> | undefined;

        if (!org?.['name']) continue;

        results.push({
          organization: String(org['name']),
          role: s['role-title'] ? String(s['role-title']) : null,
          department: s['department-name'] ? String(s['department-name']) : null,
          startYear: parseOrcidYear(s['start-date']),
          endYear: parseOrcidYear(s['end-date']),
          city: address?.['city'] ? String(address['city']) : null,
          country: address?.['country'] ? String(address['country']) : null,
        });
      }
    }
  } catch (error) {
    console.error('Error parsing ORCID employments:', error);
  }

  return results;
}

// Sort by start year (most recent first), with ongoing positions first
function sortByDate<T extends { startYear: number | null; endYear: number | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    // Ongoing positions (no end year) come first
    if (a.endYear === null && b.endYear !== null) return -1;
    if (a.endYear !== null && b.endYear === null) return 1;

    // Then sort by end year (most recent first)
    if (a.endYear !== null && b.endYear !== null && a.endYear !== b.endYear) {
      return b.endYear - a.endYear;
    }

    // Then by start year
    const aStart = a.startYear ?? 0;
    const bStart = b.startYear ?? 0;
    return bStart - aStart;
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orcid: string }> }
) {
  const { orcid } = await params;

  // Validate ORCID format (0000-0000-0000-0000)
  if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(orcid)) {
    return NextResponse.json(
      { error: "Invalid ORCID format" },
      { status: 400 }
    );
  }

  // Check cache first
  const cached = getCachedOrcid(orcid);
  if (cached) {
    const data = cached.data as OrcidData;
    return NextResponse.json({ ...data, cachedAt: cached.cached_at });
  }

  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      removeNSPrefix: true,
      processEntities: false,  // Prevent XXE attacks
    });

    // Fetch education and employment in parallel with timeout
    const [educationRes, employmentRes] = await Promise.all([
      fetchWithTimeout(`https://pub.orcid.org/v3.0/${orcid}/educations`, {
        headers: { 'Accept': 'application/xml' },
      }, 10000),
      fetchWithTimeout(`https://pub.orcid.org/v3.0/${orcid}/employments`, {
        headers: { 'Accept': 'application/xml' },
      }, 10000),
    ]);

    if (!educationRes.ok && !employmentRes.ok) {
      // Both failed - ORCID not found or API issue
      if (educationRes.status === 404 || employmentRes.status === 404) {
        return NextResponse.json(
          { error: "ORCID not found" },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: "Failed to fetch ORCID data" },
        { status: 500 }
      );
    }

    let education: OrcidEducation[] = [];
    let employment: OrcidEmployment[] = [];

    if (educationRes.ok) {
      const educationXml = await educationRes.text();
      const educationData = parser.parse(educationXml);
      education = parseEducations(educationData['educations']);
    }

    if (employmentRes.ok) {
      const employmentXml = await employmentRes.text();
      const employmentData = parser.parse(employmentXml);
      employment = parseEmployments(employmentData['employments']);
    }

    // Sort by date
    education = sortByDate(education);
    employment = sortByDate(employment);

    // Only cache if we have meaningful data
    const hasData = education.length > 0 || employment.length > 0;

    const result: OrcidData = {
      orcid,
      education,
      employment,
    };

    if (hasData) {
      setCachedOrcid(orcid, result);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching ORCID data:', error);
    return NextResponse.json(
      { error: "Failed to fetch ORCID data" },
      { status: 500 }
    );
  }
}
