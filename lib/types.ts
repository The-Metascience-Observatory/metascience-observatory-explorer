// Types for journal data

export interface JournalSearchItem {
  sourceid: string;
  display_name: string;
  issn: string | null;
  publisher: string | null;
  is_oa: boolean | null;
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

export interface JournalDetails {
  summary: JournalSummary;
  yearlyStats: JournalYearlyStats[];
  fields: JournalField[];
  impactFactors?: JournalImpactFactor[];      // Computed metrics
  officialMetrics?: JournalOfficialMetrics;   // From Scopus API
  retractionStats?: JournalRetractionStats;   // From Retraction Watch
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
  cited_by_count: number;
  source_name: string | null;
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
