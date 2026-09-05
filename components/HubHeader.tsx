/**
 * Server-rendered page header for the entity hub pages.
 *
 * These pages wrap their body in <Suspense> (they read useSearchParams), so an
 * <h1> declared inside the client component never appears in the initial HTML —
 * a crawler sees only the fallback. Rendering the heading here, above the
 * client boundary, keeps exactly one <h1> per page in the server response.
 *
 * The count comes from lib/counts.ts rather than an API call so it paints
 * immediately and is present for crawlers.
 */
export function HubHeader({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-8">
      <div className="flex items-center gap-3 mb-2">
        <span className="text-gray-600" aria-hidden="true">
          {icon}
        </span>
        <h1 className="text-3xl font-bold">{title}</h1>
      </div>
      <p className="text-gray-500">{description}</p>
    </div>
  );
}
