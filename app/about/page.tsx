import Link from "next/link";

export const metadata = {
  title: "About | The Metascience Observatory Explorer",
  description:
    "About the data sources powering the Metascience Observatory Explorer.",
};

export default function AboutPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <h1 className="font-clarendon font-bold text-3xl sm:text-4xl mb-6 text-gray-900">
        About The Metascience Observatory Explorer 
      </h1>


      <h2 className="font-clarendon font-bold text-xl sm:text-2xl mt-10 mb-2 text-gray-900">
          SciSciNet-V2 data ingestion
      </h2>

      <div className="text-sm sm:text-base text-gray-700 dark:text-gray-300 leading-relaxed space-y-4">
        <p>
          The primary source of data for the Metascience Observatory Explorer
          is the 2025{" "}
          <a
            href="https://northwestern-cssi.github.io/sciscinet/"
            className="text-blue-600 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            SciSciNet-V2 dataset
          </a>
          . If you find this explorer useful for your work, make sure to
          acknowledge and cite the{" "}
          <a
            href="https://www.nature.com/articles/s41597-023-02198-9"
            className="text-blue-600 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            SciSciNet paper
          </a>
          . Read more about SciSciNet-V2 on{" "}
          <a
            href="https://github.com/kellogg-cssi/SciSciNet?tab=readme-ov-file"
            className="text-blue-600 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            Github
          </a>
          . SciSciNet-V2 is is licensed under an{" "}
          <a
            href="https://github.com/kellogg-cssi/SciSciNet/blob/main/LICENSE"
            className="text-blue-600 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            MIT License
          </a>
          .
        </p>

        <p>
          <strong>How to cite:</strong> Lin, Z., Yin, Y., Liu, L. et al.
          SciSciNet: A large-scale open data lake for the science of science
          research. <em>Sci Data</em> 10, 315 (2023).{" "}
          <a
            href="https://doi.org/10.1038/s41597-023-02198-9"
            className="text-blue-600 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            https://doi.org/10.1038/s41597-023-02198-9
          </a>
        </p>

        <p>
          <strong>What&apos;s parts of SciSciNet-V2 were not included?</strong> The paper embeddings are
          not used, and the field normalized citation scores are also not
          presented here. The Nobel Laureate dataset was also not incorporated yet,
          and some of the papers imported from <i>papers_raw</i> are orphaned because they
          are not linked to known persons.
        </p>

        <p>
          <strong>
            What data sources were used to construct SciSciNet-V2?
          </strong>{" "}
          SciSciNet-V2 integrates data from a range of upstream sources. The
          original SciSciNet (V1) was built on top of the Microsoft Academic
          Graph (MAG), which was sunset by Microsoft at the end of 2021.
          SciSciNet-V2 replaces MAG with{" "}
          <a
            href="https://openalex.org/"
            className="text-blue-600 hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            OpenAlex
          </a>{" "}
          as its core bibliographic graph. The major external datasets linked
          into SciSciNet are:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <a
              href="https://openalex.org/"
              className="text-blue-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              OpenAlex
            </a>{" "}
            — the open bibliographic graph (successor to Microsoft Academic
            Graph) providing papers, authors, institutions, journals,
            concepts, and citation links. This is the base catalog for
            SciSciNet-V2.
          </li>
          <li>
            <a
              href="https://pubmed.ncbi.nlm.nih.gov/"
              className="text-blue-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              PubMed
            </a>{" "}
            — biomedical publication records with PubMed IDs, used to link
            SciSciNet papers to NIH projects, clinical trials, and other
            biomedical entities.
          </li>
          <li>
            <a
              href="https://reporter.nih.gov/"
              className="text-blue-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              NIH RePORTER
            </a>{" "}
            — data on NIH-funded projects with linkages to publications,
            patents, and clinical studies.
          </li>
          <li>
            <a
              href="https://www.nsf.gov/awardsearch/"
              className="text-blue-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              NSF Awards
            </a>{" "}
            — data on NSF-funded projects with linkages to publications.
          </li>
          <li>
            <a
              href="https://clinicaltrials.gov/"
              className="text-blue-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              ClinicalTrials.gov
            </a>{" "}
            — clinical studies and their linkages to referenced papers
            worldwide.
          </li>
          <li>
            <a
              href="https://patentsview.org/"
              className="text-blue-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              PatentsView
            </a>{" "}
            and patent-to-science citations — USPTO and EPO patent records
            and citations extracted from the front pages and in-text of
            patents linking back to scientific papers.
          </li>
          <li>
            <a
              href="https://www.eventdata.crossref.org/guide/"
              className="text-blue-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Crossref Event Data
            </a>{" "}
            — online attention metadata used to track mentions of papers in
            news feeds and on Twitter/X.
          </li>
          <li>
            Nobel Laureate publication records — publication and prize-winning
            paper records for Nobel laureates, used to flag laureate-authored
            work. (Not yet surfaced in the Explorer.)
          </li>
        </ul>

        <h2 className="font-clarendon font-bold text-xl sm:text-2xl mt-10 mb-2 text-gray-900">
          Additional data sources
        </h2>
        <p>
          Beyond SciSciNet-V2, we have incorporated data from the following sources:
        </p>
        <ul className="list-disc pl-6 space-y-2">
          <li>
            <a
              href="https://graph.openaire.eu/"
              className="text-blue-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              OpenAIRE Graph
            </a>{" "}
            (v11.1.1, June 2026, CC-BY 4.0) — open-access status
            (gold/green/bronze/hybrid/diamond), links from papers to 3.9M
            funded projects (European Commission and ~40 national funders),
            linked research datasets and software, institutional project
            portfolios, and 33.5M additional DOI-bearing papers not present
            in SciSciNet. Manghi, P., Atzori, C., Bardi, A., et al.{" "}
            <em>OpenAIRE Graph Dataset</em>, Zenodo,{" "}
            <a
              href="https://doi.org/10.5281/zenodo.3516917"
              className="text-blue-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              doi:10.5281/zenodo.3516917
            </a>
            .
          </li>
          <li>
            <a
              href="https://www.scopus.com/sources"
              className="text-blue-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Scopus Source Title List
            </a>{" "}
            (November 2025) — journal metadata, ISSNs, publishers, coverage
            dates, open access status, and ASJC subject classifications. Used
            to enrich journal records and to add Scopus-indexed journals that
            are not present in OpenAlex.
          </li>
          <li>
            <a
              href="https://doaj.org/"
              className="text-blue-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Directory of Open Access Journals (DOAJ)
            </a>{" "}
            (December 2025) — open access licensing information, Article
            Processing Charges (APCs), Library of Congress Classification
            (LCC) codes, and language coverage for open access journals.
          </li>
          <li>
            <a
              href="https://retractionwatch.com/retraction-watch-database-user-guide/"
              className="text-blue-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Retraction Watch Database
            </a>{" "}
            — retracted paper records matched by DOI and PMID, including
            retraction dates and reasons.
          </li>
          <li>
            <a
              href="https://retractionwatch.com/the-retraction-watch-hijacked-journal-checker/"
              className="text-blue-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Retraction Watch Hijacked Journal Checker
            </a>{" "}
            — a registry of hijacked (counterfeit) journals, used to flag
            potentially fraudulent journal entries.
          </li>
          <li>
            <a
              href="https://github.com/stop-predatory-journals/stop-predatory-journals.github.io"
              className="text-blue-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Stop Predatory Journals
            </a>{" "}
            (based on{" "}
            <a
              href="https://beallslist.net/"
              className="text-blue-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Beall&apos;s List
            </a>
            ) — standalone predatory journals and predatory publishers used
            to flag journals of questionable quality.
          </li>
          <li>
            <a
              href="https://www.nlm.nih.gov/mesh/meshhome.html"
              className="text-blue-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              MeSH (Medical Subject Headings)
            </a>{" "}
            — the 2026 edition of the NLM biomedical controlled vocabulary,
            including descriptors, scope notes, and the full tree hierarchy.
          </li>
          <li>
            <a
              href="https://ftp.ncbi.nlm.nih.gov/pubmed/baseline/"
              className="text-blue-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              MEDLINE / PubMed Baseline
            </a>{" "}
            — used to extract MeSH term annotations for biomedical papers and
            link them back to the knowledge graph.
          </li>
          <li>
            A December 2025 snapshot of{" "}
            <a
              href="https://clinicaltrials.gov/"
              className="text-blue-600 hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              ClinicalTrials.gov
            </a>{" "}
            is also loaded directly to provide full trial registration details
            (titles, conditions, interventions, sponsors, phases, enrollment,
            and status) on top of the paper→trial links that come from
            SciSciNet-V2.
          </li>
        </ul>
      </div>

      <div className="mt-10">
        <Link href="/" className="text-blue-600 hover:underline text-sm">
          ← Back to Explorer
        </Link>
      </div>
    </div>
  );
}
