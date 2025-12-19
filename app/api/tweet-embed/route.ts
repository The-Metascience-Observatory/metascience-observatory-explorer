import { NextRequest, NextResponse } from "next/server";
import { getCacheDb } from "@/lib/db";

interface TweetEmbedCache {
  tweet_url: string;
  html: string | null;
  author_name: string | null;
  cached_at: string;
}

// Ensure cache table exists
function ensureCacheTable(db: ReturnType<typeof getCacheDb>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tweet_embed_cache (
      tweet_url TEXT PRIMARY KEY,
      html TEXT,
      author_name TEXT,
      cached_at TEXT NOT NULL
    )
  `);
}

// Check cache (valid for 7 days - tweet content rarely changes)
function getCachedEmbed(db: ReturnType<typeof getCacheDb>, tweetUrl: string): TweetEmbedCache | null {
  try {
    ensureCacheTable(db);
    const row = db.prepare(`
      SELECT * FROM tweet_embed_cache
      WHERE tweet_url = ?
      AND datetime(cached_at) > datetime('now', '-7 days')
    `).get(tweetUrl) as TweetEmbedCache | undefined;
    return row || null;
  } catch {
    return null;
  }
}

// Save to cache
function saveToCache(db: ReturnType<typeof getCacheDb>, tweetUrl: string, html: string | null, authorName: string | null): void {
  try {
    ensureCacheTable(db);
    db.prepare(`
      INSERT OR REPLACE INTO tweet_embed_cache (tweet_url, html, author_name, cached_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(tweetUrl, html, authorName);
  } catch (error) {
    console.error("Failed to cache tweet embed:", error);
  }
}

// Convert various tweet URL formats to x.com format for oEmbed
function normalizeTwitterUrl(url: string): string {
  // Handle twitter:// protocol URLs
  const twitterProtocolMatch = url.match(/twitter:\/\/status\?id=(\d+)/);
  if (twitterProtocolMatch) {
    return `https://x.com/i/status/${twitterProtocolMatch[1]}`;
  }

  // Handle twitter.com/user/statuses/123 format
  const statusesMatch = url.match(/twitter\.com\/([^/]+)\/statuses\/(\d+)/);
  if (statusesMatch) {
    return `https://x.com/${statusesMatch[1]}/status/${statusesMatch[2]}`;
  }

  // Handle twitter.com/user/status/123 format
  const statusMatch = url.match(/twitter\.com\/([^/]+)\/status\/(\d+)/);
  if (statusMatch) {
    return `https://x.com/${statusMatch[1]}/status/${statusMatch[2]}`;
  }

  // Replace twitter.com with x.com
  return url.replace('http://', 'https://').replace('twitter.com', 'x.com');
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const url = searchParams.get("url");

  if (!url) {
    return NextResponse.json({ error: "URL parameter required" }, { status: 400 });
  }

  const normalizedUrl = normalizeTwitterUrl(url);
  const cacheDb = getCacheDb();

  // Check cache first
  const cached = getCachedEmbed(cacheDb, normalizedUrl);
  if (cached) {
    return NextResponse.json({
      html: cached.html,
      author_name: cached.author_name,
      fromCache: true,
    });
  }

  try {
    // Fetch from Twitter oEmbed API (no auth required)
    const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(normalizedUrl)}&omit_script=true&hide_thread=true`;

    const response = await fetch(oembedUrl, {
      headers: {
        "User-Agent": "SciSciNet-Dashboard/1.0",
      },
    });

    if (!response.ok) {
      // Tweet might be deleted or protected
      saveToCache(cacheDb, normalizedUrl, null, null);
      return NextResponse.json({
        html: null,
        author_name: null,
        error: "Tweet not available",
        fromCache: false,
      });
    }

    const data = await response.json();

    // Cache the result
    saveToCache(cacheDb, normalizedUrl, data.html || null, data.author_name || null);

    return NextResponse.json({
      html: data.html || null,
      author_name: data.author_name || null,
      fromCache: false,
    });
  } catch (error) {
    console.error("Tweet embed error:", error);
    return NextResponse.json(
      { error: "Failed to fetch tweet embed" },
      { status: 500 }
    );
  }
}

// Batch endpoint for multiple tweets
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { urls } = body as { urls: string[] };

    if (!urls || !Array.isArray(urls)) {
      return NextResponse.json({ error: "urls array required" }, { status: 400 });
    }

    // Limit to prevent abuse
    const limitedUrls = urls.slice(0, 10);
    const cacheDb = getCacheDb();

    const results: Array<{
      url: string;
      html: string | null;
      author_name: string | null;
      fromCache: boolean;
    }> = [];

    for (const url of limitedUrls) {
      const normalizedUrl = normalizeTwitterUrl(url);

      // Check cache first
      const cached = getCachedEmbed(cacheDb, normalizedUrl);
      if (cached) {
        results.push({
          url,
          html: cached.html,
          author_name: cached.author_name,
          fromCache: true,
        });
        continue;
      }

      try {
        const oembedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(normalizedUrl)}&omit_script=true&hide_thread=true`;
        const response = await fetch(oembedUrl, {
          headers: { "User-Agent": "SciSciNet-Dashboard/1.0" },
        });

        if (!response.ok) {
          saveToCache(cacheDb, normalizedUrl, null, null);
          results.push({ url, html: null, author_name: null, fromCache: false });
        } else {
          const data = await response.json();
          saveToCache(cacheDb, normalizedUrl, data.html || null, data.author_name || null);
          results.push({
            url,
            html: data.html || null,
            author_name: data.author_name || null,
            fromCache: false,
          });
        }

        // Small delay to be nice to Twitter's servers
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch {
        results.push({ url, html: null, author_name: null, fromCache: false });
      }
    }

    return NextResponse.json({ tweets: results });
  } catch (error) {
    console.error("Batch tweet embed error:", error);
    return NextResponse.json({ error: "Failed to fetch tweet embeds" }, { status: 500 });
  }
}
