"use client";

import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import Link from "next/link";
import { ArrowLeft, ChevronRight } from "lucide-react";
import { formatCompactNumber } from "@/lib/utils";

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

interface FieldBubbleChartProps {
  fields: Field[];
}

interface BubbleNode {
  id: string;
  name: string;
  value: number;
  paperCount: number;
  isParent?: boolean;
  x?: number;
  y?: number;
  r?: number;
}

// Color palette for fields
const FIELD_COLORS: Record<string, string> = {
  "C142362112": "#E91E63", // Art - Pink
  "C86803240": "#4CAF50",  // Biology - Green
  "C144133560": "#FF9800", // Business - Orange
  "C185592680": "#9C27B0", // Chemistry - Purple
  "C41008148": "#2196F3",  // Computer science - Blue
  "C162324750": "#607D8B", // Economics - Blue Grey
  "C127413603": "#795548", // Engineering - Brown
  "C39432304": "#8BC34A",  // Environmental science - Light Green
  "C205649164": "#00BCD4", // Geography - Cyan
  "C127313418": "#FF5722", // Geology - Deep Orange
  "C95457728": "#9E9E9E",  // History - Grey
  "C192562407": "#673AB7", // Materials science - Deep Purple
  "C33923547": "#3F51B5",  // Mathematics - Indigo
  "C71924100": "#F44336",  // Medicine - Red
  "C138885662": "#FFC107", // Philosophy - Amber
  "C121332964": "#03A9F4", // Physics - Light Blue
  "C17744445": "#009688",  // Political science - Teal
  "C15744967": "#CDDC39",  // Psychology - Lime
  "C144024400": "#E040FB", // Sociology - Purple accent
};

export function FieldBubbleChart({ fields }: FieldBubbleChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedField, setSelectedField] = useState<Field | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Update dimensions on resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDimensions({
          width: rect.width,
          height: Math.max(600, Math.min(rect.width * 0.85, 850)),
        });
      }
    };

    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, []);

  // Render bubbles
  useEffect(() => {
    if (!svgRef.current || fields.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const { width, height } = dimensions;
    const padding = 20;

    let nodes: BubbleNode[];

    if (selectedField) {
      // Show subfields for selected field
      nodes = selectedField.subfields.map((sf) => ({
        id: sf.fieldid,
        name: sf.display_name,
        value: sf.paper_count || 1,
        paperCount: sf.paper_count || 0,
      }));

      // Add parent field as center node
      nodes.unshift({
        id: selectedField.fieldid,
        name: selectedField.display_name,
        value: (selectedField.paper_count || 1) * 0.3, // Make it smaller
        paperCount: selectedField.paper_count || 0,
        isParent: true,
      });
    } else {
      // Show all level 0 fields
      nodes = fields.map((f) => ({
        id: f.fieldid,
        name: f.display_name,
        value: f.paper_count || 1,
        paperCount: f.paper_count || 0,
      }));
    }

    // Create bubble layout
    type HierarchyData = { name: string; value?: number; children?: BubbleNode[] } | BubbleNode;

    const pack = d3.pack<HierarchyData>()
      .size([width - padding * 2, height - padding * 2])
      .padding(selectedField ? 6 : 8);

    const hierarchyData: HierarchyData = { name: "root", children: nodes };
    const hierarchy = d3.hierarchy(hierarchyData)
      .sum((d) => (d as BubbleNode).value || 0);

    const root = pack(hierarchy);

    // Create a group for each bubble
    const bubbleGroups = svg
      .append("g")
      .attr("transform", `translate(${padding}, ${padding})`)
      .selectAll("g")
      .data(root.leaves())
      .join("g")
      .attr("transform", (d) => `translate(${d.x}, ${d.y})`)
      .style("cursor", "pointer");

    // Add circles
    bubbleGroups
      .append("circle")
      .attr("r", (d) => d.r!)
      .attr("fill", (d) => {
        const nodeData = d.data as unknown as BubbleNode;
        if (selectedField) {
          if (nodeData.isParent) {
            return FIELD_COLORS[selectedField.fieldid] || "#6366f1";
          }
          // Subfields get a lighter version
          const parentColor = FIELD_COLORS[selectedField.fieldid] || "#6366f1";
          return d3.color(parentColor)?.brighter(0.3)?.toString() || parentColor;
        }
        return FIELD_COLORS[nodeData.id] || "#6366f1";
      })
      .attr("fill-opacity", 0.85)
      .attr("stroke", (d) => {
        const nodeData = d.data as unknown as BubbleNode;
        if (selectedField) {
          return FIELD_COLORS[selectedField.fieldid] || "#6366f1";
        }
        return FIELD_COLORS[nodeData.id] || "#6366f1";
      })
      .attr("stroke-width", 2)
      .on("mouseenter", function () {
        d3.select(this)
          .transition()
          .duration(200)
          .attr("fill-opacity", 1)
          .attr("stroke-width", 3);
        // Show "Show subfields" text on the parent group
        const parentGroup = d3.select(this.parentNode as SVGGElement);
        parentGroup.select(".hover-text")
          .transition()
          .duration(200)
          .attr("opacity", 1);
      })
      .on("mouseleave", function () {
        d3.select(this)
          .transition()
          .duration(200)
          .attr("fill-opacity", 0.85)
          .attr("stroke-width", 2);
        // Hide "Show subfields" text
        const parentGroup = d3.select(this.parentNode as SVGGElement);
        parentGroup.select(".hover-text")
          .transition()
          .duration(200)
          .attr("opacity", 0);
      });

    // Add field names
    bubbleGroups
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", (d) => {
        const nodeData = d.data as unknown as BubbleNode;
        if (nodeData.isParent) return "-0.3em";
        // Always offset up to make room for paper count below
        return "-0.3em";
      })
      .attr("fill", "white")
      .attr("font-size", (d) => {
        const r = d.r!;
        if (r < 35) return "9px";
        if (r < 55) return "11px";
        if (r < 90) return "14px";
        return "16px";
      })
      .attr("font-weight", "600")
      .attr("pointer-events", "none")
      .text((d) => {
        const nodeData = d.data as unknown as BubbleNode;
        const name = nodeData.name;
        const r = d.r!;
        if (r < 30) return "";
        if (r < 45) return name.length > 10 ? name.slice(0, 8) + "..." : name;
        if (r < 70) return name.length > 16 ? name.slice(0, 14) + "..." : name;
        return name;
      });

    // Add paper count for all bubbles
    bubbleGroups
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "1em")
      .attr("fill", "rgba(255,255,255,0.9)")
      .attr("font-size", (d) => {
        const r = d.r!;
        if (r < 35) return "8px";
        if (r < 55) return "9px";
        if (r < 90) return "11px";
        return "13px";
      })
      .attr("pointer-events", "none")
      .text((d) => {
        const nodeData = d.data as unknown as BubbleNode;
        const r = d.r!;
        // Hide paper count only for very small bubbles
        if (r < 30) return "";
        return formatCompactNumber(nodeData.paperCount) + " papers";
      });

    // Add "Show subfields" text for level 0 fields (only visible on hover)
    if (!selectedField) {
      bubbleGroups
        .append("text")
        .attr("class", "hover-text")
        .attr("text-anchor", "middle")
        .attr("dy", "2.3em")
        .attr("fill", "rgba(255,255,255,0.95)")
        .attr("font-size", (d) => {
          const r = d.r!;
          if (r < 45) return "8px";
          if (r < 70) return "10px";
          return "12px";
        })
        .attr("font-weight", "500")
        .attr("pointer-events", "none")
        .attr("opacity", 0)
        .text((d) => d.r! < 30 ? "" : "Click to explore");
    }

    // Handle clicks
    bubbleGroups.on("click", (event, d) => {
      const nodeData = d.data as unknown as BubbleNode;

      if (selectedField) {
        // If we're viewing subfields, clicking goes to the field page
        if (!nodeData.isParent) {
          window.location.href = `/fields/${nodeData.id}`;
        }
      } else {
        // If we're viewing level 0 fields, clicking shows subfields
        const field = fields.find((f) => f.fieldid === nodeData.id);
        if (field && field.subfields.length > 0) {
          setSelectedField(field);
        } else if (field) {
          window.location.href = `/fields/${nodeData.id}`;
        }
      }
    });

  }, [fields, selectedField, dimensions]);

  return (
    <div className="w-full">
      {/* Header with back button */}
      <div className="flex items-center justify-between mb-4">
        {selectedField ? (
          <button
            onClick={() => setSelectedField(null)}
            className="inline-flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to all fields
          </button>
        ) : (
          <div className="text-sm text-gray-500">
            Click a bubble to explore subfields
          </div>
        )}
        {selectedField && (
          <Link
            href={`/fields/${selectedField.fieldid}`}
            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
          >
            View {selectedField.display_name} details
            <ChevronRight className="h-4 w-4" />
          </Link>
        )}
      </div>

      {/* SVG container */}
      <div
        ref={containerRef}
        className="w-full bg-gray-50 dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700"
      >
        <svg
          ref={svgRef}
          width={dimensions.width}
          height={dimensions.height}
          className="w-full"
        />
      </div>

      {/* Legend */}
      {selectedField && (
        <div className="mt-4 text-center text-sm text-gray-500">
          Showing {selectedField.subfields.length} subfields of{" "}
          <span className="font-semibold">{selectedField.display_name}</span>
        </div>
      )}
    </div>
  );
}
