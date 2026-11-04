import { GRANT_SOURCE_LABELS, type GrantSource } from "@/lib/grant-id";

const STYLES: Record<GrantSource, string> = {
  nih_exporter: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  nsf: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  pubmed: "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200",
  openaire: "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200",
};

const TITLES: Record<GrantSource, string> = {
  nih_exporter: "Reported by the funder: NIH RePORTER/ExPORTER publication link",
  nsf: "Reported by the funder: NSF award publication link",
  pubmed: "Acknowledged in the paper: PubMed grant field",
  openaire: "Acknowledged in the paper: OpenAIRE Graph project link",
};

/** Which of the four link sources vouch for a grant↔paper pair. Green = funder-reported, purple/blue = paper-acknowledged. */
export function GrantSourceBadges({ sources, size = "xs" }: { sources: GrantSource[]; size?: "xs" | "sm" }) {
  if (sources.length === 0) return null;
  const pad = size === "xs" ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-0.5 text-xs";
  return (
    <span className="inline-flex flex-wrap gap-1">
      {sources.map((s) => (
        <span key={s} className={`${pad} rounded-sm font-medium ${STYLES[s]}`} title={TITLES[s]}>
          {GRANT_SOURCE_LABELS[s]}
        </span>
      ))}
    </span>
  );
}
