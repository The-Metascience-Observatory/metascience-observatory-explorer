import type { Metadata } from "next";
import { Roboto_Slab } from "next/font/google";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { VisitorTracker } from "@/components/VisitorTracker";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { ENTITY_COUNTS, SEARCHABLE_PAPERS } from "@/lib/counts";
import "./globals.css";

const robotoSlab = Roboto_Slab({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-roboto-slab",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — Science of Science Data`,
    template: "%s | Metascience Observatory Explorer",
  },
  description:
    "Free, open explorer for the science of science. Search " +
    `${SEARCHABLE_PAPERS.toLocaleString("en-US")} papers, ` +
    `${ENTITY_COUNTS.persons.toLocaleString("en-US")} researchers, ` +
    `${ENTITY_COUNTS.journals.toLocaleString("en-US")} journals, ` +
    `${ENTITY_COUNTS.affiliations.toLocaleString("en-US")} institutions, funders, ` +
    "research fields, MeSH terms, clinical trials and retractions.",
  applicationName: SITE_NAME,
  // Deliberately NO `alternates.canonical` here: child metadata merges over the
  // parent, so any page that forgot to set its own would inherit "/" as its
  // canonical and de-index itself. Every page sets its canonical explicitly.
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    url: SITE_URL,
    locale: "en_US",
  },
  twitter: { card: "summary_large_image" },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
      "max-video-preview": -1,
    },
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={robotoSlab.variable}>
      <body className="font-sans antialiased min-h-screen bg-white">
        <Navbar />
        <main>{children}</main>
        <Footer />
        <VisitorTracker />
      </body>
    </html>
  );
}
