"use client";

import { JournalSearch } from "@/components/JournalSearch";
import { PersonSearch } from "@/components/PersonSearch";
import { AffiliationSearch } from "@/components/AffiliationSearch";
import { FunderSearch } from "@/components/FunderSearch";
import { TrialSearch } from "@/components/TrialSearch";
import { PaperSearch } from "@/components/PaperSearch";
import { BookOpen, User, Building2, Banknote, FlaskConical, FileText } from "lucide-react";

export default function HomePage() {
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">

      {/* Five search sections - 2 rows */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 mb-8">
        {/* Journals */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
            <BookOpen className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Journals</h2>
          </div>
          <JournalSearch compact />
        </div>

        {/* Researchers */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
            <User className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Researchers</h2>
          </div>
          <PersonSearch compact />
        </div>

        {/* Institutions */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
            <Building2 className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Institutions</h2>
          </div>
          <AffiliationSearch compact />
        </div>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8 mb-12">
        {/* Papers */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
            <FileText className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Papers</h2>
          </div>
          <PaperSearch compact />
        </div>

        {/* Funders */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
            <Banknote className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Funders</h2>
          </div>
          <FunderSearch compact />
        </div>

        {/* Clinical Trials */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
            <FlaskConical className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Clinical Trials</h2>
          </div>
          <TrialSearch compact />
        </div>
      </div>

      {/* About section */}
      <div className="text-sm text-gray-600 dark:text-gray-400 max-w-3xl mx-auto">
        <p className="mb-3">
          This is a prototype dashboard for the{" "}
          <a href="https://northwestern-cssi.github.io/sciscinet/" className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">
            SciSciNet-V2 dataset
          </a>
          . If you find it useful, make sure to acknowledge and cite the{" "}
          <a href="https://www.nature.com/articles/s41597-023-02198-9" className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">
            SciSciNet paper
          </a>
          . Read more about this dataset on{" "}
          <a href="https://github.com/kellogg-cssi/SciSciNet?tab=readme-ov-file" className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">
            Github
          </a>
          . This dataset is licensed under an{" "}
          <a href="https://github.com/kellogg-cssi/SciSciNet/blob/main/LICENSE" className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">
            MIT License
          </a>
          .
        </p>
        <p className="mb-3">
          <strong>How to cite:</strong> Lin, Z., Yin, Y., Liu, L. et al. SciSciNet: A large-scale open data lake for the science of science research. <em>Sci Data</em> 10, 315 (2023).{" "}
          <a href="https://doi.org/10.1038/s41597-023-02198-9" className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">
            https://doi.org/10.1038/s41597-023-02198-9
          </a>
        </p>
        <p>
          <strong>What&apos;s not included?</strong> The paper embeddings are not used, and the field normalized citation scores are also not presented here. The Nobel Laureate dataset is not incorporated yet, and some of the papers in papers_raw may be orphaned because they cannot be linked to known persons.
        </p>
      </div>

    </div>
  );
}
