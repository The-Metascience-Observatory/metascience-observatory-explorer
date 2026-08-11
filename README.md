# SciSciNet Dashboard

A metascience dashboard for exploring research publications, authors, institutions, funding, and clinical trials.

## Data Sources

### Core Dataset: SciSciNet-V2

Built on the [SciSciNet](https://github.com/kellogg-cssi/SciSciNet) open data lake for science of science research.

| Component | Description | Scale |
|-----------|-------------|-------|
| Papers | Research publications with metadata, DOIs, citations | ~250M papers |
| Authors | Researcher profiles with H-index, productivity metrics | ~100M authors |
| Institutions | Universities and research organizations | ~110K institutions |
| Journals | Publication venues with impact factors | ~260K journals |
| Fields | Research discipline classifications (3 levels) | 303 fields |
| Citations | Paper-to-paper citation network | ~2.5B links |

### Integrated Datasets

| Dataset | Source | Description |
|---------|--------|-------------|
| [OpenAlex](https://openalex.org/) | OurResearch | Core bibliographic data - papers, authors, institutions, journals, fields, citations |
| [NIH ExPORTER](https://reporter.nih.gov/exporter) | NIH | Paper-to-NIH grant linkages |
| [NSF Awards](https://www.nsf.gov/awardsearch/) | NSF | Paper-to-NSF grant linkages |
| [USPTO Patents](https://www.uspto.gov/) | USPTO | Patents citing research papers |
| [ClinicalTrials.gov](https://clinicaltrials.gov/) | NIH/NLM | Clinical trials linked to papers (NCT IDs) |
| [PubMed](https://pubmed.ncbi.nlm.nih.gov/) | NCBI | PubMed IDs (PMID/PMCID) for biomedical papers |
| [Crossref Event Data](https://www.crossref.org/services/event-data/) | Crossref | News and media coverage of papers |
| [Twitter/X](https://twitter.com/) | Twitter | Social media mentions of papers |
| [Nobel Laureates Dataset](https://doi.org/10.6084/m9.figshare.c.6076908.v1) | SciSciNet | Publications of Nobel Prize winners (87K+ paper-laureate links) |
| [OpenAIRE Graph](https://graph.openaire.eu/) | OpenAIRE | Open-access status, EU/national grant links (3.9M projects), linked datasets/software, org project portfolios, plus 33.5M additional papers not in SciSciNet (CC-BY; v11.1.1 bulk dump) |

### Live APIs (Real-time Enrichment)

| API | Provider | Data Retrieved |
|-----|----------|----------------|
| [NIH Reporter API](https://api.reporter.nih.gov/) | NIH | Grant details, project abstracts, funding amounts |
| [NSF Awards API](https://www.research.gov/common/webapi/awardapisearch-v1.htm) | NSF | Grant details, award information |
| [ORCID API](https://info.orcid.org/documentation/api-tutorials/) | ORCID | Author education, employment history, works |
| [Wikidata API](https://www.wikidata.org/wiki/Wikidata:Data_access) | Wikimedia | Entity enrichment, external identifiers |
| [Scopus API](https://dev.elsevier.com/) | Elsevier | Journal CiteScore metrics |

### Potential Future Integrations

#### Grant Funding Amounts

| API | Provider | Data Available |
|-----|----------|----------------|
| [USAspending.gov API](https://api.usaspending.gov/) | U.S. Treasury | All federal grant awards with dollar amounts (2007+) |
| [DOE PAMS Award Search](https://pamspublic.science.energy.gov/) | Dept. of Energy | DOE Office of Science grants with amounts (1985+) |
| [Federal RePORTER](https://federalreporter.nih.gov/) | NIH | Cross-agency federal research awards |
| [Dimensions API](https://www.dimensions.ai/) | Digital Science | 100M+ publications, grants with funding amounts (free for research) |

#### Research Integrity & Fraud Detection

| API | Provider | Data Available |
|-----|----------|----------------|
| [Crossref Retraction Watch API](https://www.crossref.org/documentation/retrieve-metadata/retraction-watch/) | Crossref | 50K+ retractions with reasons, updated daily |
| [PubPeer API](https://pubpeer.com/) | PubPeer Foundation | Post-publication comments flagging issues (API key required - contact them) |
| [ORI Case Summaries](https://ori.hhs.gov/content/case_summary) | HHS | Official misconduct findings (no API - web scraping needed) |

#### Author Profile Enrichment

| API | Provider | Data Available |
|-----|----------|----------------|
| [Scopus Author API](https://dev.elsevier.com/guides/Scopus%20API%20Guide_V1_20230907.pdf) | Elsevier | Author profiles, affiliation history, h-index |
| [Web of Science Researcher API](https://developer.clarivate.com/apis/wos-researcher) | Clarivate | ResearcherID, disambiguated author records |
| [Semantic Scholar API](https://api.semanticscholar.org/) | AI2 | Author influence scores, highly influential citations |
| [Europe PMC Author Search](https://europepmc.org/RestfulWebService) | EBI | Biomedical author disambiguation, grant linkages |

## Tech Stack

- **Framework**: Next.js 15 (React 18)
- **Database**: SQLite (better-sqlite3) - 1.5TB+ research data
- **Styling**: Tailwind CSS
- **Visualization**: D3.js, Recharts

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the dashboard.

## References

- Lin, Z., Yin, Y., Liu, L., & Wang, D. (2023). SciSciNet: A large-scale open data lake for the science of science research. *Scientific Data*, 10, 315. https://doi.org/10.1038/s41597-023-02198-9
- Manghi, P., Atzori, C., Bardi, A., et al. OpenAIRE Graph Dataset (v11.1.1). *Zenodo*. https://doi.org/10.5281/zenodo.3516917 — used under CC-BY 4.0.
