"use client";

import { JournalSearch } from "@/components/JournalSearch";
import { PersonSearch } from "@/components/PersonSearch";
import { AffiliationSearch } from "@/components/AffiliationSearch";
import { FunderSearch } from "@/components/FunderSearch";
import { TrialSearch } from "@/components/TrialSearch";
import { PaperSearch } from "@/components/PaperSearch";
import { BookOpen, User, Building2, Banknote, FlaskConical, FileText } from "lucide-react";
import Link from "next/link";

export default function HomePage() {
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">

      {/* Five search sections - 2 rows */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-x-1 gap-y-1 mb-1">
        {/* Journals */}
        <div className="max-w-[78%] mx-auto w-full space-y-2">
          <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
            <BookOpen className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Journals</h2>
          </div>
          <JournalSearch compact />
        </div>

        {/* Researchers */}
        <div className="max-w-[78%] mx-auto w-full space-y-2">
          <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
            <User className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Researchers</h2>
          </div>
          <PersonSearch compact />
        </div>

        {/* Institutions */}
        <div className="max-w-[78%] mx-auto w-full space-y-2">
          <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
            <Building2 className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Institutions</h2>
          </div>
          <AffiliationSearch compact />
        </div>
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-x-1 gap-y-1 mb-6">
        {/* Papers */}
        <div className="max-w-[78%] mx-auto w-full space-y-2">
          <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
            <FileText className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Papers</h2>
          </div>
          <PaperSearch compact />
        </div>

        {/* Funders */}
        <div className="max-w-[78%] mx-auto w-full space-y-2">
          <div className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
            <Banknote className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Funders</h2>
          </div>
          <FunderSearch compact />
        </div>

        {/* Clinical Trials */}
        <div className="max-w-[78%] mx-auto w-full space-y-2">
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
          The primary source of data for the Metascience Observatory Explorer is the 2025
          <a href="https://northwestern-cssi.github.io/sciscinet/" className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">
            SciSciNet-V2 dataset
          </a>
          . If you find this explorer useful for your work, make sure to acknowledge and cite the{" "}
          <a href="https://www.nature.com/articles/s41597-023-02198-9" className="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">
            SciSciNet paper</a>.{" "}
          <Link href="/about" className="text-blue-600 hover:underline">
            Read more about data sources here.
          </Link>
        </p>
      </div>

    </div>
  );
}
