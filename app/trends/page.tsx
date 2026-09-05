import type { Metadata } from "next";
import TrendsPageClient from "./PageClient";

export const metadata: Metadata = {
  title: "Metascience trends | Metascience Observatory Explorer",
  description:
    "Aggregate trends across the research workforce and literature: researcher mobility between countries and productivity by career age.",
};

export default function TrendsPage() {
  return <TrendsPageClient />;
}
