import Link from "next/link";

interface ListItemLinkProps {
  href: string;
  children: React.ReactNode;
  external?: boolean;
}

/**
 * Reusable list item component with consistent hover styling.
 * Used for clickable items in lists (trials, patents, media mentions, papers, etc.)
 */
export function ListItemLink({ href, children, external }: ListItemLinkProps) {
  const className = "block p-2 bg-gray-50 dark:bg-gray-800 rounded-sm hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors";

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
