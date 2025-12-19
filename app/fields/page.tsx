"use client";

import { useEffect, useState } from "react";
import { FieldBubbleChart } from "@/components/FieldBubbleChart";
import { Loader2 } from "lucide-react";

interface SubField {
  fieldid: string;
  display_name: string;
  paper_count: number | null;
  total_citations: number | null;
}

interface Field {
  fieldid: string;
  display_name: string;
  paper_count: number | null;
  total_citations: number | null;
  subfields: SubField[];
}

interface HierarchyResponse {
  fields?: Field[];
  error?: string;
}

export default function FieldExplorerPage() {
  const [fields, setFields] = useState<Field[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchHierarchy() {
      try {
        const res = await fetch("/api/fields/hierarchy");
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data: HierarchyResponse = await res.json();
        if (data.error) {
          throw new Error(data.error);
        }
        setFields(data.fields || []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load fields");
      } finally {
        setLoading(false);
      }
    }
    fetchHierarchy();
  }, []);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          <span className="ml-3 text-gray-500">Loading fields...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center py-24">
          <p className="text-red-600 text-lg">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold mb-2">Field Explorer</h1>
        <p className="text-gray-600 dark:text-gray-400">
          Explore 19 broad fields of science and their subfields. Bubble size represents number of papers.
        </p>
      </div>

      <FieldBubbleChart fields={fields} />
    </div>
  );
}
