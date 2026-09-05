import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { FIELD_SUBFIELD_MAP } from "@/lib/field-hierarchy";
import { errorResponse } from "@/lib/api-utils";



export async function GET() {
  try {
    const db = getDb();

    // Get all fields with paper counts
    const fields = db.prepare(`
      SELECT fieldid, display_name, level, paper_count, total_citations
      FROM field_summary
      ORDER BY paper_count DESC
    `).all() as Array<{
      fieldid: string;
      display_name: string;
      level: number;
      paper_count: number | null;
      total_citations: string | null;
    }>;

    // Separate into level 0 and level 1
    const level0Fields = fields.filter(f => f.level === 0);
    const level1Fields = fields.filter(f => f.level === 1);

    // Build the hierarchy response
    const hierarchy = level0Fields.map(field => {
      const subfieldsIds = FIELD_SUBFIELD_MAP[field.fieldid] || [];
      const subfields = subfieldsIds
        .map(id => level1Fields.find(sf => sf.fieldid === id))
        .filter((sf): sf is NonNullable<typeof sf> => sf !== undefined)
        .sort((a, b) => (b.paper_count || 0) - (a.paper_count || 0));

      return {
        fieldid: field.fieldid,
        display_name: field.display_name,
        paper_count: field.paper_count,
        total_citations: field.total_citations ? parseInt(field.total_citations, 10) : null,
        subfields: subfields.map(sf => ({
          fieldid: sf.fieldid,
          display_name: sf.display_name,
          paper_count: sf.paper_count,
          total_citations: sf.total_citations ? parseInt(sf.total_citations, 10) : null,
        })),
      };
    });

    return NextResponse.json({ fields: hierarchy });
  } catch (error) {
    return errorResponse(error, "fields/hierarchy");
  }
}
