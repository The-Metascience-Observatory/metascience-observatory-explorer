import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { MobileNav } from "@/components/MobileNav";
import { Footer } from "@/components/Footer";
import { VisitorTracker } from "@/components/VisitorTracker";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Metascience Observatory: SciSciNet-V2 Explorer",
  description: "Explore academic journals with publication and citation metrics",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="font-sans antialiased min-h-screen bg-white">
        <header className="border-b bg-white relative">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between py-3">
              <Link href="/" className="flex items-center gap-2 sm:gap-3 min-w-0">
                <Image
                  src="/assets/globe.svg"
                  alt="Globe"
                  width={32}
                  height={32}
                  className="flex-shrink-0 sm:w-10 sm:h-10"
                />
                <span className="font-bold text-sm sm:text-xl md:text-2xl truncate">
                  <span className="sm:hidden">SciSciNet Explorer</span>
                  <span className="hidden sm:inline">The Metascience Observatory: SciSciNet-V2 Explorer</span>
                </span>
              </Link>
              <nav className="hidden md:flex items-center gap-6 text-sm">
                <Link href="/" className="hover:text-gray-600">
                  Search
                </Link>
                <Link href="/fields" className="hover:text-gray-600">
                  Field Explorer
                </Link>
                <Link href="/funders-map" className="hover:text-gray-600">
                  Funders Map
                </Link>
                <a href="https://metascienceobservatory.org" className="hover:text-gray-600">
                  Metascience Observatory
                </a>
              </nav>
              <MobileNav />
            </div>
          </div>
        </header>
        <main>{children}</main>
        <Footer />
        <VisitorTracker />
      </body>
    </html>
  );
}
