import { redirect } from "next/navigation";
import { getDb, getOpenaireDb, isDatabaseAvailable } from "@/lib/db";

interface Props {
  params: Promise<{ doi: string[] }>;
}

export default async function DoiRedirectPage({ params }: Props) {
  const { doi } = await params;
  const doiPath = doi.join("/");

  // Try to find in database first
  if (isDatabaseAvailable()) {
    const db = getDb();
    const result = db.prepare(`
      SELECT paperid FROM paper_summary
      WHERE doi = ? OR doi = ?
      LIMIT 1
    `).get(`https://doi.org/${doiPath}`, doiPath) as { paperid: string } | undefined;

    if (result) {
      redirect(`/papers/${result.paperid}`);
    }
  }

  // Fallback: first-class OpenAIRE papers (bare lowercase DOI, indexed)
  const openaireDb = getOpenaireDb();
  if (openaireDb) {
    let oaId: string | null = null;
    try {
      const oa = openaireDb
        .prepare("SELECT id FROM openaire_papers WHERE doi = ? LIMIT 1")
        .get(doiPath.toLowerCase()) as { id: string } | undefined;
      oaId = oa?.id ?? null;
    } catch {
      // openaire tables may not exist yet - fall through
    }
    if (oaId) {
      redirect(`/papers/openaire/${oaId}`);
    }
  }

  // Not in database - redirect to doi.org
  redirect(`https://doi.org/${doiPath}`);
}
