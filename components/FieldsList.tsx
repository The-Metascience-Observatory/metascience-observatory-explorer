"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

interface FieldListItem {
  fieldid: string;
  display_name: string;
  level: number;
}

export function FieldsList() {
  const [fields, setFields] = useState<FieldListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadFields() {
      try {
        const res = await fetch("/api/fields");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setFields(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load fields");
      } finally {
        setLoading(false);
      }
    }
    loadFields();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        <span className="ml-2 text-gray-500 text-sm">Loading fields...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-4">
        <p className="text-sm text-gray-500">{error}</p>
      </div>
    );
  }

  // Separate fields by level
  const level0Fields = fields.filter((f) => f.level === 0);
  const level1Fields = fields.filter((f) => f.level === 1);

  return (
    <div className="space-y-4">
      {/* Level 0 - Broad Fields */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-2">
          Broad Fields ({level0Fields.length})
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {level0Fields.map((field) => (
            <Link
              key={field.fieldid}
              href={`/fields/${field.fieldid}`}
              className="px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100 transition-colors"
            >
              {field.display_name}
            </Link>
          ))}
        </div>
      </div>

      {/* Level 1 - Subfields */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-2">
          Subfields ({level1Fields.length})
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {level1Fields.map((field) => (
            <Link
              key={field.fieldid}
              href={`/fields/${field.fieldid}`}
              className="px-2 py-0.5 text-xs bg-purple-50 text-purple-700 rounded hover:bg-purple-100 transition-colors"
            >
              {field.display_name}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
