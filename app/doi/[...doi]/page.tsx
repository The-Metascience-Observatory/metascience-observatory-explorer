import { redirect } from "next/navigation";
import { getDb, isDatabaseAvailable } from "@/lib/db";

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

  // Not in database - redirect to doi.org
  redirect(`https://doi.org/${doiPath}`);
}
