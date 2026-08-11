// Types for journal data

export interface JournalSearchItem {
  sourceid: string;
  display_name: string;
  issn: string | null;
  publisher: string | null;
  is_oa: boolean | null;
  scopus_only?: boolean;  // True if this is a Scopus-only journal (no OpenAlex data)
}

export interface JournalSummary {
  sourceid: string;
  display_name: string;
  issn: string | null;
  publisher: string | null;
  homepage_url: string | null;
  is_oa: boolean | null;
  total_papers: number | null;
  total_citations: number | null;
  first_year: number | null;
  last_year: number | null;
  primary_field_l0_id: string | null;
  primary_field_l0_name: string | null;
  primary_field_l1_id: string | null;
  primary_field_l1_name: string | null;
}

export interface JournalYearlyStats {
  sourceid: string;
  year: number;
  paper_count: number;
  total_citations: number;
}

export interface JournalField {
  sourceid: string;
  fieldid: string;
  field_name: string;
  level: number;
  paper_count: number;
  score_sum: number;
}

export interface JournalImpactFactor {
  sourceid: string;
  year: number;
  citations_2yr: number;
  papers_2yr: number;
  impact_factor_2yr: number | null;
  citations_5yr: number;
  papers_5yr: number;
  impact_factor_5yr: number | null;
  citations_citescore: number;
  papers_citescore: number;
  citescore: number | null;
}

// Official metrics from external APIs (Scopus)
export interface JournalOfficialMetrics {
  scopus_citescore?: number;        // Official CiteScore from Scopus
  scopus_citescore_year?: number;   // Year of the CiteScore
  scopus_percentile?: number;       // Percentile ranking
  scopus_rank?: string;             // e.g., "15/300" in category
}

// Retraction statistics from Retraction Watch
export interface JournalRetractionStats {
  totalRetractions: number;
  totalConcerns: number;
  totalCorrections: number;
  totalReinstatements: number;
  retractionRate: number | null;      // retractions / papers since 2010 * 100
  papersSince2010: number | null;     // denominator for rate
  firstRetractionYear: number | null;
  lastRetractionYear: number | null;
}

// Hijacked journal information from Retraction Watch
export interface HijackedJournalInfo {
  hijacked_title: string;
  hijacked_url: string | null;
  hijacked_issn: string | null;
  original_title: string | null;
  original_issn: string | null;
  original_url: string | null;
}

// Journal enrichment data from Scopus and DOAJ
export interface JournalEnrichment {
  scopus_source_id: string | null;
  publisher_scopus: string | null;
  license_type: string | null;           // CC-BY, CC-BY-NC, etc.
  apc_amount: number | null;             // Article processing charge amount
  apc_currency: string | null;           // USD, EUR, etc.
  apc_year: number | null;               // Year of APC data (2025)
  languages: string[] | null;            // ISO language codes
  is_discontinued: boolean;
  discontinued_for_quality: boolean;
  asjc_codes: string[] | null;           // Scopus subject codes
  lcc_codes: string[] | null;            // Library of Congress codes
  subjects_doaj: string | null;          // DOAJ subject keywords
  data_source: 'scopus' | 'doaj' | 'both' | null;
  // New fields from Scopus
  eissn: string | null;                  // Electronic ISSN
  coverage: string | null;               // Coverage dates (e.g., "1959-2001")
  source_type: string | null;            // Journal, Book Series, Trade Journal, etc.
  is_medline: boolean;                   // From Medline database
  articles_in_press: boolean;            // Includes articles in press
  title_history: string | null;          // "Continued as" / "Formerly known as"
  related_titles: string[] | null;       // Related journal names
  top_level_categories: {                // Top-level subject categories
    life_sciences?: boolean;
    social_sciences?: boolean;
    physical_sciences?: boolean;
    health_sciences?: boolean;
  } | null;
}

// Predatory journal information from Beall's List
export interface PredatoryInfo {
  source: string;           // 'bealls_journal' or 'bealls_publisher'
  name: string;             // matched name from predatory list
  publisher: string | null; // publisher name (if publisher-level match)
  url: string | null;       // URL from predatory list
  confidence: string;       // 'exact' or 'publisher'
}

export interface JournalDetails {
  summary: JournalSummary;
  yearlyStats: JournalYearlyStats[];
  fields: JournalField[];
  impactFactors?: JournalImpactFactor[];      // Computed metrics
  officialMetrics?: JournalOfficialMetrics;   // From Scopus API
  retractionStats?: JournalRetractionStats;   // From Retraction Watch
  hijackedInfo?: HijackedJournalInfo;         // From Retraction Watch hijacked journal checker
  enrichment?: JournalEnrichment;             // From Scopus/DOAJ enrichment data
  predatoryInfo?: PredatoryInfo;              // From Beall's List
}

// Types for person/author data

export interface PersonSearchItem {
  authorid: string;
  display_name: string;
  orcid: string | null;
  h_index: number | null;
  productivity: number | null;
  last_known_institution: string | null;
}

export interface PersonSummary {
  authorid: string;
  display_name: string;
  display_name_alternatives: string | null;
  orcid: string | null;
  h_index: number | null;
  productivity: number | null;
  cited_by_count: number | null;
  works_count: number | null;
  last_known_institution: string | null;
  first_year: number | null;
  last_year: number | null;
  avg_c10: number | null;
}

export interface PersonYearlyStats {
  authorid: string;
  year: number;
  paper_count: number;
  total_citations: number;
}

export interface PersonAffiliation {
  authorid: string;
  institutionid: string;
  institution_name: string | null;
  country_code: string | null;
  paper_count: number;
  first_year: number | null;
  last_year: number | null;
}

export interface PersonFunding {
  authorid: string;
  funder_name: string;
  award_id: string;
  paper_count: number;
}

export interface PersonTwitter {
  authorid: string;
  tweet_count: number;
  first_tweet_date: string | null;
  last_tweet_date: string | null;
}

export interface PersonTweet {
  tweet_id: string;
  occurred_time: string | null;
  original_tweet_url: string;
  doi: string | null;
}

export interface PersonPublication {
  paperid: string;
  title: string | null;
  year: number | null;
  cited_by_count: number | null;
  author_position: string | null;
  sourceid: string | null;
  source_name: string | null;
}

// Retraction statistics for authors
export interface PersonRetractionStats {
  totalRetractions: number;
  totalConcerns: number;
  totalCorrections: number;
  totalReinstatements: number;
}

// Self-citation statistics for authors
export interface PersonSelfCitations {
  self_citation_count: number;
  total_citation_count: number;
  self_citation_rate: number | null;
}

export interface PersonDetails {
  summary: PersonSummary;
  yearlyStats: PersonYearlyStats[];
  affiliations: PersonAffiliation[];
  funding: PersonFunding[];
  twitter: PersonTwitter | null;
  tweets: PersonTweet[];
  recentPublications: PersonPublication[];
  trials?: PersonTrial[];
  retractionStats?: PersonRetractionStats;
  selfCitations?: PersonSelfCitations;
}

// Types for affiliation/institution data

export interface AffiliationSearchItem {
  institution_id: string;
  display_name: string;
  country_code: string | null;
  type: string | null;
  h_index: number | null;
  productivity: number | null;
}

export interface AffiliationSummary {
  institution_id: string;
  display_name: string;
  country_code: string | null;
  type: string | null;
  ror: string | null;
  homepage_url: string | null;
  h_index: number | null;
  productivity: number | null;
  total_citations: number | null;
  researcher_count: number | null;
  first_year: number | null;
  last_year: number | null;
}

export interface AffiliationYearlyStats {
  institution_id: string;
  year: number;
  paper_count: number;
  total_citations: number;
}

export interface AffiliationResearcher {
  authorid: string;
  display_name: string;
  h_index: number | null;
  paper_count: number;
  first_year: number | null;
  last_year: number | null;
}

export interface AffiliationCollaborator {
  institution_id: string;
  display_name: string;
  country_code: string | null;
  joint_papers: number;
}

export interface AffiliationChild {
  institution_id: string;
  display_name: string | null;
  country_code: string | null;
  type: string | null;
}

export interface AffiliationDetails {
  summary: AffiliationSummary;
  yearlyStats: AffiliationYearlyStats[];
  topResearchers: AffiliationResearcher[];
  topCollaborators: AffiliationCollaborator[];
  childInstitutions?: AffiliationChild[];
  parentInstitution?: AffiliationChild;
}

// Types for field/discipline data

export interface FieldItem {
  fieldid: string;
  display_name: string;
  level: number;
  paper_count: number | null;
  total_citations: number | null;
}

export interface FieldTopPaper {
  paperid: string;
  title: string | null;
  year: number | null;
  cited_by_count: number;
  source_name: string | null;
}

// Top cited paper with field-normalized citation score
export interface FieldTopCitedPaper {
  fieldid: string;
  paperid: string;
  title: string | null;
  year: number | null;
  citation_count: number;
  normalized_citations: number;
  source_name: string | null;
}

export interface FieldTopAuthor {
  authorid: string;
  display_name: string;
  h_index: number | null;
  paper_count: number;
}

export interface FieldDetails {
  summary: FieldItem;
  topPapers: FieldTopPaper[];
  topAuthors: FieldTopAuthor[];
  topCitedPapers: FieldTopCitedPaper[];
}

// Types for paper/publication data

export interface PaperSearchItem {
  paperid: string;
  title: string;
  doi: string | null;
  year: number | null;
  cited_by_count: number | null; // null for OpenAIRE-sourced results
  source_name: string | null;
  openaire?: boolean; // true when the paper comes from the OpenAIRE Graph
}

export interface JournalPublication {
  paperid: string;
  sourceid: string;
  title: string | null;
  year: number | null;
  cited_by_count: number | null;
}

export interface JournalFieldPaper {
  paperid: string;
  sourceid: string;
  fieldid: string;
  title: string | null;
  year: number | null;
  cited_by_count: number | null;
  field_score: number | null;
}

export interface PaperSummary {
  paperid: string;
  title: string | null;
  doi: string | null;
  year: number | null;
  cited_by_count: number | null;
  sourceid: string | null;
  source_name: string | null;
}

export interface PaperAuthor {
  paperid: string;
  authorid: string;
  display_name: string | null;
  author_position: string | null;
  institutionid: string | null;
  institution_name: string | null;
}

export interface PaperField {
  paperid: string;
  fieldid: string;
  field_name: string;
  level: number;
  score_openalex: number | null;
}

export interface PaperReference {
  ref_paperid: string;
  ref_title: string | null;
  ref_year: number | null;
  ref_cited_by_count: number | null;
}

export interface PaperCitation {
  citing_paperid: string;
  citing_title: string | null;
  citing_year: number | null;
  citing_cited_by_count: number | null;
}

export interface PaperCitationHistory {
  year: number;
  citation_count: number;
}

export interface PaperPatent {
  paperid: string;
  patent: string;
  is_uspto: number;
}

export interface PaperDetails {
  summary: PaperSummary;
  authors: PaperAuthor[];
  fields: PaperField[];
  references: PaperReference[];
  citations: PaperCitation[];
  citationsTotal?: number;
  citationHistory?: PaperCitationHistory[];
  trials?: PaperTrial[];
  patents?: PaperPatent[];
}

// Types for funder data

export interface FunderSearchItem {
  funderid: string;
  display_name: string;
  country_code: string | null;
  works_count: number | null;
  cited_by_count: number | null;
  h_index: number | null;
}

export interface FunderSummary {
  funderid: string;
  display_name: string;
  country_code: string | null;
  description: string | null;
  homepage_url: string | null;
  grants_count: number | null;
  works_count: number | null;
  cited_by_count: number | null;
  h_index: number | null;
  i10_index: number | null;
  oa_percent: number | null;
}

export interface FunderYearlyStats {
  funderid: string;
  year: number;
  works_count: number;
  cited_by_count: number;
}

export interface FunderConcept {
  funderid: string;
  fieldid: string;
  field_name: string;
  level: number;
  score: number;
}

export interface FunderDetails {
  summary: FunderSummary;
  yearlyStats: FunderYearlyStats[];
  concepts: FunderConcept[];
}

// Types for clinical trial data

export interface TrialSummary {
  nct_id: string;
  // Paper linkage stats (from SciSciNet)
  paper_count: number;
  result_paper_count: number | null;
  derived_paper_count: number | null;
  background_paper_count: number | null;
  unknown_paper_count: number | null;
  // ClinicalTrials.gov metadata
  title: string | null;
  status: string | null;
  phase: string | null;
  study_type: string | null;
  conditions: string | null;
  interventions: string | null;
  sponsor: string | null;
  enrollment: number | null;
  start_date: string | null;
  completion_date: string | null;
  brief_summary: string | null;
}

export interface TrialSearchItem {
  nct_id: string;
  title: string | null;
  status: string | null;
  phase: string | null;
  sponsor: string | null;
  enrollment: number | null;
  paper_count: number | null;
}

export interface TrialPaper {
  nct_id: string;
  paperid: string;
  title: string | null;
  year: number | null;
  cited_by_count: number | null;
  reference_type: string | null;
}

export interface PaperTrial {
  paperid: string;
  nct_id: string;
  reference_type: string | null;
}

export interface PersonTrial {
  authorid: string;
  nct_id: string;
  paper_count: number;
  // From ctg_studies join
  title: string | null;
  sponsor: string | null;
  status: string | null;
}

export interface TrialYearlyStats {
  nct_id: string;
  year: number;
  paper_count: number;
  total_citations: number;
}

export interface TrialDetails {
  summary: TrialSummary;
  papers: TrialPaper[];
  yearlyStats: TrialYearlyStats[];
}

// Types for ORCID data

export interface OrcidEducation {
  institution: string;
  degree: string | null;
  department: string | null;
  startYear: number | null;
  endYear: number | null;
  city: string | null;
  country: string | null;
}

export interface OrcidEmployment {
  organization: string;
  role: string | null;
  department: string | null;
  startYear: number | null;
  endYear: number | null;
  city: string | null;
  country: string | null;
}

export interface OrcidData {
  orcid: string;
  education: OrcidEducation[];
  employment: OrcidEmployment[];
  cachedAt?: number;
}

// Types for MeSH data

export interface MeshTerm {
  meshUi: string;
  meshName: string;
  isMajor: boolean;
  qualifierName: string | null;
}

export interface MeshSummary {
  meshUi: string;
  meshName: string;
  totalPapers: number;
  totalCitations: number;
  scopeNote: string | null;
}

export interface MeshRelatedTerm {
  meshUi: string;
  meshName: string;
}

export interface MeshYearlyStats {
  year: number;
  paper_count: number;
}

export interface MeshTopJournal {
  sourceid: string;
  sourceName: string;
  paperCount: number;
}

export interface MeshDetails {
  summary: MeshSummary;
  treeNumbers: string[];
  parentTerms: MeshRelatedTerm[];
  childTerms: MeshRelatedTerm[];
  yearlyStats: MeshYearlyStats[];
  topJournals: MeshTopJournal[];
}

// ── OpenAIRE Graph enrichment (data/openaire.db) ──────────────────────────────

export interface OpenairePaperInfo {
  oaColor: string | null; // 'gold' | 'green' | 'bronze' | 'hybrid'
  bestAccessRight: string | null; // 'OPEN' | 'CLOSED' | 'EMBARGO' | 'RESTRICTED'
  isGreen: boolean | null;
  isDiamond: boolean | null;
  publiclyFunded: boolean | null;
}

export interface OpenaireProject {
  openaireProjectId: string;
  code: string | null;
  acronym: string | null;
  title: string | null;
  funderShortname: string | null;
  fundingStream: string | null;
  startDate?: string | null;
  endDate?: string | null;
  fundedAmount?: number | null;
  currency?: string | null;
}

export interface OpenaireLinkedProduct {
  productType: string; // 'dataset' | 'software' | 'other'
  title: string | null;
  doi: string | null;
  relation: string | null;
  year: number | null;
}

export interface OpenaireOrgInfo {
  openaireOrgId: string;
  legalName: string | null;
  countryCode: string | null;
  projectCount: number;
  projects: OpenaireProject[];
}

export interface PaperOpenaireResponse {
  openaire: OpenairePaperInfo | null;
  projects: OpenaireProject[];
  linkedProducts: OpenaireLinkedProduct[];
}

// ── First-class OpenAIRE papers (openaire_papers in data/openaire.db) ─────────

export interface OpenairePaperSummary {
  id: string; // 'OA' + 32-hex
  doi: string;
  pmid: string | null;
  title: string | null;
  subtitle: string | null;
  publicationDate: string | null;
  year: number | null;
  type: string | null;
  language: string | null;
  publisher: string | null;
  journalName: string | null;
  issnPrinted: string | null;
  issnOnline: string | null;
  matchedSourceid: string | null;
  volume: string | null;
  issue: string | null;
  startPage: string | null;
  endPage: string | null;
  bestAccessRight: string | null;
  oaColor: string | null;
  isGreen: boolean | null;
  isDiamond: boolean | null;
  publiclyFunded: boolean | null;
  authorCount: number;
  hasAbstract: boolean;
}

export interface OpenairePaperAuthor {
  rank: number;
  fullName: string | null;
  orcid: string | null;
  matchedAuthorid: string | null;
}

export interface OpenairePaperDetails {
  summary: OpenairePaperSummary;
  authors: OpenairePaperAuthor[];
  journalDisplayName: string | null;
}
