# SEO runbook

Operational steps for the Explorer's search visibility. Everything here is
either a recurring task or a one-off you must do in an external dashboard —
the code-side work is already in the repo.

Public origin: **https://explore.metascienceobservatory.org**
(set via `SITE_URL` in `docker-compose.yml`; the apex `metascienceobservatory.org`
is a separate Vercel site and is not built from this repo.)

---

## 1. Regenerate the sitemaps

Run **on the host, outside the container**, after every database refresh:

```bash
nice -n 10 ionice -c3 node scripts/generate-sitemaps.mjs
```

- Takes ~50s cold, ~15s warm. Produces ~1.78M URLs across 41 gzipped shards
  (~8.4MB) in `data/sitemaps/`, plus `manifest.json`.
- `data/` is the bind mount, so a new set is live immediately — **no rebuild,
  no restart**.
- Writes to `data/sitemaps.tmp/` then renames atomically, so `/sitemap.xml`
  never serves a half-written set.
- Also rebuilds the `rank_papers` / `rank_persons` / `rank_affiliations` tables
  in `cache.db` (5,000 rows each), which back the "top N" hub pages.

Flags: `--skip-ranks` (sitemaps only), `--only=papers,journals` (partial run for
testing — deliberately **not** published, so it can't drop other entity types
from the index).

`lastmod` is content-hashed per shard and carried forward from the previous
`manifest.json` when nothing changed. Do not "fix" this to always stamp today:
restamping 1.78M URLs every run teaches Google the field is meaningless and it
gets ignored site-wide.

Verify:

```bash
zcat data/sitemaps/papers-1.xml.gz | xmllint --noout -   # valid XML
curl -sI https://explore.metascienceobservatory.org/sitemap.xml
```

## 2. Refresh the crawler allowlist

Monthly — the published ranges drift:

```bash
node scripts/update-crawler-allowlist.mjs
```

Writes `data/allowlist.json` (~613 ranges from Google and Bing). Hot-reloaded
within 30s.

This file does two jobs, both in `lib/blocklist.ts`:
- `middleware.ts` raises a verified crawler's rate limit to 3,000/min and
  exempts it from the per-subnet tier. Googlebot spans 32 adjacent /24s, so the
  subnet tier would otherwise throttle a normal crawl.
- Anything in these ranges is **unblockable**, so a broad CIDR rule aimed at
  scrapers can't silently de-index the site.

If the file is missing, crawlers just get the normal 1,000/min limit. It fails
closed, never open.

> **Blocklist footgun.** `data/blocklist.json` matches User-Agents as
> case-insensitive *substrings*. Patterns shorter than 5 characters, or that
> are a substring of a protected crawler token, are rejected at load time with
> a logged reason — `"bot"`, `"google"`, `"claude"` and `"spider"` are all
> refused. Check `docker logs` for `[blocklist] refusing UA pattern` after
> editing.

## 3. Cloudflare — one-off dashboard setup

The origin is a home server behind a tunnel. Without edge caching, every one of
1.78M crawler URL fetches reaches it.

1. **Cache Rule for HTML** (Rules → Cache Rules). This is the single biggest
   win; Cloudflare does not cache HTML by default.
   - Match: `http.host eq "explore.metascienceobservatory.org"` and
     `not starts_with(http.request.uri.path, "/api/")` and
     `not starts_with(http.request.uri.path, "/analytics")` and
     `not starts_with(http.request.uri.path, "/doi/")` and
     `http.request.uri.query eq ""`
   - Cache eligibility: **Eligible for cache**
   - Edge TTL: **Ignore cache-control header from origin — 1 day**
   - Browser TTL: 0–1 hour
   - Serve stale while revalidating: **on**

   The "ignore origin" part is required, not cosmetic: Next emits
   `private, no-cache, no-store` on dynamic routes and `s-maxage=31536000` on
   prerendered ones. Neither is what we want, and neither can be overridden
   from middleware (setting `Cache-Control` on `NextResponse.next()` is inert —
   Next replaces it).

   **Purge the cache after every deploy**, or a release can be masked at the
   edge for up to a day.

2. **Smart Tiered Cache** — on. Collapses origin fetches when many PoPs want
   the same URL, which is exactly Googlebot's multi-datacenter pattern.
3. **Always Online** — on. Turns a restart window into cache hits instead of
   5xx crawl errors; sustained 5xx costs index coverage fast.
4. **Check Bot Fight Mode is OFF** (Security → Bots). The free tier
   JS-challenges non-verified bots, cannot be excepted per-path, and is a
   recurring cause of blocking legitimate crawlers. On Pro, use Super Bot Fight
   Mode with "Allow verified bots".
5. **Crawler Hints** — on (Caching → Configuration). This is IndexNow; it
   replaces the sitemap ping endpoints Google and Bing both retired.
6. **Brotli** on, **HTTP/3** on.
7. **WAF custom rule: Managed Challenge for every unverified client**
   (Security → WAF → Custom rules). Added after the 2026-10-28 incident: a
   residential-proxy scraper at 65–100 req/s that never reused an IP, so
   nothing in `middleware.ts` keyed on the address could see it. The edge is
   the only place with a fingerprint that survives IP rotation.
   - Expression (the host match keeps it off the apex, which is the Vercel site):
     ```
     http.host eq "explore.metascienceobservatory.org"
     and not cf.client.bot
     and not starts_with(http.request.uri.path, "/_next/")
     and not starts_with(http.request.uri.path, "/sitemaps/")
     and not http.request.uri.path in {"/robots.txt" "/sitemap.xml" "/favicon.ico"}
     ```
   - Action: **Managed Challenge**.
   - `not cf.client.bot` exempts every Cloudflare verified bot — Googlebot,
     Bingbot, Applebot, DuckDuckBot, OAI-SearchBot, ClaudeBot, PerplexityBot,
     ExaSearchBot, and the social preview fetchers — so this is scoped where Bot
     Fight Mode (item 4) is not. `/robots.txt`, `/sitemap.xml` and
     `/sitemaps/*` stay open so an unverified crawler can still read the
     crawl policy; `/_next/` is static assets.
   - **The rule must cover the hub pages (`/`, `/papers`, `/persons`, …), not
     just the entity and `/api/` paths.** The first version listed only
     `starts_with(path, "/persons/")`-style prefixes plus `/api/`. The hubs
     have no trailing slash, so arriving at the homepage was not challenged
     while the page's own `fetch('/api/persons/search')` was. A challenge can
     only be rendered on a navigation; on a fetch Cloudflare answers
     **403 with `cf-mitigated: challenge`** and no usable body. Symptom:
     autocomplete silently empty, red `HTTP 403` on the results page, until the
     visitor happened to open a detail page and collect the `cf_clearance`
     cookie. Challenging every navigation means the cookie exists before the
     first fetch.
   - **Security → Settings → Challenge Passage: set to 1 day** (default is
     30 minutes). This is how long the clearance cookie lasts; a tab left open
     past it hits the fetch-403 case again.
   - For that expired-cookie case the client recovers itself:
     `lib/edge-challenge.ts` `apiFetch()` detects `cf-mitigated: challenge`,
     reloads the page once (the reload is a navigation, so it is challenged and
     re-issues the cookie), and refuses to reload again within 60 s so a failing
     challenge cannot loop. Every search box and hub `PageClient` uses it;
     detail pages are reached by a challenged navigation and use plain `fetch`.
   - If the scraper survives the challenge (full headless browsers), Bot Fight
     Mode is the next step despite its scoping problem.
   - **Leave `headerGate` in `data/blocklist.json` on `"log"`.** Measured
     2026-10-29: the gate trips on Applebot, OAI-SearchBot and Reflectionbot,
     which send browser-shaped UAs without `sec-fetch-*`. `"enforce"` would
     403 the crawlers this rule deliberately lets through. Making the gate safe
     needs the origin to know `cf.client.bot`, which Cloudflare does not
     forward; a Transform Rule adding a request header when it is true would be
     the way, and the gate would then exempt that header.

## 4. Search Console and Bing — one-off

1. **Google Search Console → add a Domain property for
   `metascienceobservatory.org`**, verified by DNS TXT in Cloudflare. A Domain
   property covers the apex *and* `explore.` in one place, which is what the
   subdomain split needs.
2. Add a **URL-prefix property** for `https://explore.metascienceobservatory.org/`
   as well — URL Inspection and some reports key off prefix properties.
3. Submit **`https://explore.metascienceobservatory.org/sitemap.xml`** (the
   index only; Google walks the shards itself).
4. **Bing Webmaster Tools** — import from GSC in one click.
5. Optionally paste the verification token into `verification` in
   `app/layout.tsx` as a backup to DNS.

## 5. Monitoring

**`analytics.db` will not see crawlers.** `components/VisitorTracker.tsx` is a
client `useEffect` POST; Googlebot generally avoids POSTs while rendering and
Bingbot and the AI crawlers won't run it at all. `/analytics` can look flat
while the box is being crawled hard. Use instead:

- **Cloudflare Analytics** — segments verified-bot traffic per hostname, free.
  Primary source of truth for crawl volume.
- **GSC → Settings → Crawl stats** — per-bot, per-response-code, host status.
  This is where a middleware regression would show up.
- **`docker logs`** — a throttled crawler is logged as `[RATE-LIMIT-CRAWLER]`,
  deliberately distinct from `[RATE-LIMIT]`. Grep for it; it should never
  appear. Crawler request logging is sampled 1-in-50 to keep the log small.
- **`[SHED]` / `[SHED-CRAWLER]`** — the origin is refusing requests with a 503
  because the event loop's worst lag sample in a 5 s window exceeded `LOAD_SHED_LAG_MS` (default
  250 ms, `0` disables). Sampled 1-in-50 for ordinary clients, every time for
  a verified crawler. A run of `SHED-CRAWLER` means the box was overloaded
  while Google was crawling; look for what else was hitting it.
- **`[HEADER-GATE]`** — a request whose User-Agent claims a modern browser
  but lacks the Fetch Metadata / client-hint headers a real one always sends
  (`lib/bot-signals.ts`). In `"log"` mode (the default, 1-in-20 sampled) it is
  observation only; set `"headerGate": "enforce"` in `data/blocklist.json`
  to 403 them — hot-reloaded, no restart. Verified crawlers are exempt.
- The tmux scrollback holds only ~500 lines — about six seconds during a
  flood. When not under Docker, start the server with
  `npm start 2>&1 | tee logs/server-$(date +%Y%m%d_%H%M%S).log`.

### What to expect

At 1.78M submitted URLs, "Discovered – currently not indexed" will dominate
Coverage for months. Google typically indexes 5–15% of a database site in year
one, and the fraction tracks almost entirely with whether pages have unique
**server-rendered** text. That is the argument for finishing the RSC conversion
(Phase 2 of the SEO plan) before adding more URLs — the detail routes are still
client-rendered shells today, so the sitemap currently points crawlers at pages
with no indexable content.
