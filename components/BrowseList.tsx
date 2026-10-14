import Link from "next/link";

/**
 * Server-rendered "browse" list used on the hub pages and the ranked-list
 * pages.
 *
 * The point is crawlability: before this existed, /papers, /persons and friends
 * were a search box and nothing else, so a crawler that reached them found zero
 * onward links. Every row here is a real <a href> in the server HTML.
 */
export interface BrowseItem {
  href: string;
  title: string;
  subtitle?: string | null;
  meta?: string | null;
}

export function BrowseList({
  items,
  startRank = 1,
}: {
  items: BrowseItem[];
  startRank?: number;
}) {
  if (items.length === 0) return null;

  return (
    <ol className="divide-y divide-gray-100 dark:divide-gray-800">
      {items.map((item, i) => (
        <li key={item.href}>
          <Link
            href={item.href}
            className="flex items-start gap-3 py-2.5 group"
          >
            <span className="text-xs text-gray-400 w-8 text-right shrink-0 pt-0.5 tabular-nums">
              {startRank + i}.
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-blue-700 group-hover:underline line-clamp-2">
                {item.title}
              </span>
              {item.subtitle && (
                <span className="block text-xs text-gray-500 truncate">
                  {item.subtitle}
                </span>
              )}
            </span>
            {item.meta && (
              <span className="text-xs text-gray-500 shrink-0 pt-0.5 tabular-nums">
                {item.meta}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ol>
  );
}

/**
 * Windowed numeric pagination as real links.
 *
 * Deliberately NOT canonicalising page 2..N back to page 1 — that is the common
 * mistake, and it de-indexes exactly the pages carrying the entity links you
 * want crawled. Each page self-canonicalises; pages past the crawlable cap are
 * marked noindex,follow by the route instead.
 */
export function Pagination({
  basePath,
  page,
  totalPages,
}: {
  basePath: string;
  page: number;
  totalPages: number;
}) {
  if (totalPages <= 1) return null;

  const href = (p: number) => (p === 1 ? basePath : `${basePath}?page=${p}`);
  const window = 3;
  const pages: number[] = [];
  for (let p = Math.max(1, page - window); p <= Math.min(totalPages, page + window); p++) {
    pages.push(p);
  }

  const link = "px-2.5 py-1 rounded-sm text-sm hover:bg-gray-100 dark:hover:bg-gray-800";

  return (
    <nav className="flex flex-wrap items-center gap-1 mt-6" aria-label="Pagination">
      {page > 1 && (
        <Link href={href(page - 1)} className={link} rel="prev">
          ← Previous
        </Link>
      )}
      {pages[0] > 1 && (
        <>
          <Link href={href(1)} className={link}>
            1
          </Link>
          {pages[0] > 2 && <span className="px-1 text-gray-400">…</span>}
        </>
      )}
      {pages.map((p) => (
        <Link
          key={p}
          href={href(p)}
          aria-current={p === page ? "page" : undefined}
          className={
            p === page
              ? "px-2.5 py-1 rounded-sm text-sm bg-blue-600 text-white"
              : link
          }
        >
          {p}
        </Link>
      ))}
      {pages[pages.length - 1] < totalPages && (
        <>
          {pages[pages.length - 1] < totalPages - 1 && (
            <span className="px-1 text-gray-400">…</span>
          )}
          <Link href={href(totalPages)} className={link}>
            {totalPages}
          </Link>
        </>
      )}
      {page < totalPages && (
        <Link href={href(page + 1)} className={link} rel="next">
          Next →
        </Link>
      )}
    </nav>
  );
}
