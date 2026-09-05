import { sanitizeInlineHtml } from "@/lib/sanitize";

interface PaperTitleProps {
  title: string;
  className?: string;
}

/**
 * Renders a scholarly title, preserving the inline formatting tags that appear
 * in source metadata (species names in italics, chemical subscripts, ...).
 *
 * No "use client": this has no hooks or handlers, so it works in both server
 * and client trees. That matters because it is imported by the mesh, trials and
 * fields pages — keeping it shared lets those render titles server-side.
 * DOMPurify cannot be used here; it is browser-only and no-ops on the server.
 */
export function PaperTitle({ title, className }: PaperTitleProps) {
  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: sanitizeInlineHtml(title) }}
    />
  );
}
