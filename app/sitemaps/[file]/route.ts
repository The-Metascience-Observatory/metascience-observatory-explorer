import { readFile } from "fs/promises";
import { join, basename } from "path";

/**
 * Serve one gzipped sitemap shard from data/sitemaps/.
 *
 * Served as `Content-Type: application/gzip` on a `.gz` URL rather than as
 * `Content-Encoding: gzip`. Both are legal per sitemaps.org and Google reads
 * either, but the latter invites Cloudflare to decompress and recompress the
 * body in the tunnel path.
 */

export const dynamic = "force-dynamic";

const SITEMAP_DIR = join(process.cwd(), "data", "sitemaps");

/** Exactly the shape the generator emits — no dots, slashes or traversal. */
const SHARD_NAME = /^[a-z0-9-]+\.xml\.gz$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> }
): Promise<Response> {
  const { file } = await params;

  // Validate the name itself, then take basename() as a second, independent
  // guard so nothing outside SITEMAP_DIR is reachable even if the pattern were
  // ever loosened.
  if (!SHARD_NAME.test(file) || basename(file) !== file) {
    return new Response("Not found", { status: 404 });
  }

  try {
    const body = await readFile(join(SITEMAP_DIR, file));
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": "application/gzip",
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new Response("Not found", { status: 404 });
    }
    console.error(`[sitemap] failed to read shard ${file}:`, error);
    return new Response("Sitemap unavailable", { status: 500 });
  }
}
