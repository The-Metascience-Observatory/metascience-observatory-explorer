import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Image from "next/image";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
});

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
      <body className={`${inter.className} antialiased min-h-screen bg-white`}>
        <header className="border-b bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between py-3">
              <a href="/" className="flex items-center gap-3">
                <Image
                  src="/assets/globe.svg"
                  alt="Globe"
                  width={40}
                  height={40}
                />
                <span className="font-bold text-xl sm:text-2xl">
                  The Metascience Observatory: SciSciNet-V2 Explorer
                </span>
              </a>
              <nav className="hidden md:flex items-center gap-6 text-sm">
                <a href="/" className="hover:text-gray-600">
                  Search
                </a>
                <a href="/fields" className="hover:text-gray-600">
                  Field Explorer
                </a>
                <a href="/funders-map" className="hover:text-gray-600">
                  Funders Map
                </a>
                <a href="https://metascienceobservatory.org" className="hover:text-gray-600">
                  Metascience Observatory
                </a>
              </nav>
            </div>
          </div>
        </header>
        <main>{children}</main>
        <footer className="border-t mt-auto">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <p className="text-sm text-gray-500">
              Data from{" "}
              <a href="https://northwestern-cssi.github.io/sciscinet/" className="underline hover:text-gray-700" target="_blank" rel="noopener noreferrer">
                SciSciNet-V2
              </a>
              .
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
