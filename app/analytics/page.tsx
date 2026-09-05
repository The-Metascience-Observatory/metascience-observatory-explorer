import type { Metadata } from "next";
import PageClient from "./PageClient";

export const metadata: Metadata = {
  title: "Analytics",
  description:
    "Internal visitor analytics dashboard.",
  alternates: { canonical: "/analytics" },
  openGraph: {
    title: "Analytics",
    description:
      "Internal visitor analytics dashboard.",
    url: "/analytics",
  },
  robots: { index: false, follow: false },
};

export default function Page() {
  return <PageClient />;
}
