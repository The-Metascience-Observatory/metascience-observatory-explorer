import { readFile } from "fs/promises";
import { join } from "path";

/**
 * The sitemap index, listing every shard.
 *
 * Files are produced offline by scripts/generate-sitemaps.mjs and live in
 * data/sitemaps/ — the bind-mounted volume — so a regenerated set is picked up
 * without an image rebuild or a restart.
 *
 * NOTE: a route handler, not `app/sitemap.ts`. Next allows only one of the two,
 * and the file-convention version would compute shards per request (see the
 * header comment in the generator for why that's untenable here).
 */

// Read from disk on every request so a newly generated set takes effect at once.
export const dynamic = "force-dynamic";

const INDEX_PATH = join(process.cwd(), "data", "sitemaps", "sitemap-index.xml");

export async function GET(): Promise<Response> {
  try {
    const xml = await readFile(INDEX_PATH, "utf8");
    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
      },
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // Not an error condition worth a 500: the set simply hasn't been built.
      console.warn(
        "[sitemap] data/sitemaps/sitemap-index.xml missing — run scripts/generate-sitemaps.mjs"
      );
      return new Response("Sitemap not generated", { status: 404 });
    }
    console.error("[sitemap] failed to read index:", error);
    return new Response("Sitemap unavailable", { status: 500 });
  }
}
