import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// Cache the field list in memory
let fieldListCache: unknown[] | null = null;

export async function GET() {
  try {
    // Return cached data if available
    if (fieldListCache) {
      return NextResponse.json(fieldListCache);
    }

    // Load field list from JSON file
    const fieldListPath = path.join(process.cwd(), "data", "field_list.json");

    if (!fs.existsSync(fieldListPath)) {
      return NextResponse.json(
        {
          error: "Field list not found. Run the preprocessing script first.",
        },
        { status: 500 }
      );
    }

    const data = fs.readFileSync(fieldListPath, "utf-8");
    fieldListCache = JSON.parse(data);

    return NextResponse.json(fieldListCache);
  } catch (error) {
    console.error("Error loading field list:", error);
    return NextResponse.json(
      {
        error: "Failed to load field list",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
