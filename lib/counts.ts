// Static counts for search components - update periodically.
// These appear immediately without waiting for API calls.
// Verified 2026-08-11 against the prod databases:
//   SELECT COUNT(*) FROM paper_summary / person_summary / journal_summary /
//                        affiliation_summary / funder_summary / ctg_studies  (journals.db)
//   SELECT COUNT(*) FROM openaire_papers                                     (openaire.db)
export const ENTITY_COUNTS = {
  papers: 249_803_279,        // SciSciNet paper_summary
  journals: 260_918,
  persons: 100_418_971,
  affiliations: 110_553,
  funders: 32_437,
  trials: 562_856,            // ctg_studies, the table /api/trials/search queries
  openairePapers: 33_509_044, // first-class papers from the OpenAIRE Graph v11.1.1
} as const;

// Paper search queries both sources and appends OpenAIRE results, so the
// user-facing "search through N papers" figure is the combined total.
export const SEARCHABLE_PAPERS =
  ENTITY_COUNTS.papers + ENTITY_COUNTS.openairePapers;
