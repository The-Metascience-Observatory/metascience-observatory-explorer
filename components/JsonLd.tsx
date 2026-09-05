/**
 * Emit schema.org JSON-LD.
 *
 * Server component (no "use client"): the payload must be in the server HTML,
 * since a crawler that doesn't execute JS is the whole audience for it.
 *
 * The `<` escape is required, not decorative. Paper titles in this dataset
 * contain inline markup, and a title containing `</script>` would otherwise
 * terminate the block and inject markup into the page.
 */
export function JsonLd({ data }: { data: object | object[] }) {
  const payload = Array.isArray(data) ? data : [data];
  if (payload.length === 0) return null;

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(payload).replace(/</g, "\\u003c"),
      }}
    />
  );
}
