"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

const buttonBase =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-xs font-medium transition-all h-9 px-3 border hover:scale-105 hover:shadow-md bg-transparent";
const buttonGray = `${buttonBase} border-gray-400 text-gray-600`;
const buttonBlue = `${buttonBase} border-blue-500 text-blue-700`;

export function Navbar() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <nav className="sticky top-0 left-0 right-0 z-50 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 border-b border-gray-200">
      <div className="max-w-5xl mx-auto px-6 py-3">
        <div className="flex items-center justify-between gap-4">
          <Link
            href="https://metascienceobservatory.org"
            aria-label="Go to homepage"
            className="flex items-center gap-3"
          >
            <Image src="/assets/globe.svg" alt="Globe" width={40} height={40} />
            <h1 className="font-clarendon font-bold text-lg sm:text-xl text-gray-900">
              The Metascience Observatory: Explorer
            </h1>
          </Link>

          <div className="hidden md:flex items-center gap-3 text-xs">
            <a
              href="https://metascienceobservatory.org/#about"
              className={buttonGray}
            >
              About
            </a>
            <a href="https://metascienceobservatory.org/docs" className={buttonGray}>
              Docs
            </a>
            <a
              href="https://metascienceobservatory.org/birds-eye-reviews"
              className={buttonGray}
            >
              Reviews
            </a>
            <a
              href="https://metascienceobservatory.org/replications-database"
              className={buttonGray}
            >
              Replications Database
            </a>
            <a
              href="https://metascienceobservatory.org/#donate"
              className={`${buttonBlue} ml-auto`}
            >
              Donate
            </a>
          </div>

          <button
            className="md:hidden p-2 text-gray-700 hover:text-gray-900 transition-colors"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            aria-label="Toggle mobile menu"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              {isMobileMenuOpen ? (
                <path d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>

        {isMobileMenuOpen && (
          <div className="md:hidden border-t border-gray-200 mt-3 pt-3 pb-3">
            <div className="flex flex-col gap-3">
              <a
                href="https://metascienceobservatory.org/#about"
                className={`${buttonGray} w-full`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                About
              </a>
              <a
                href="https://metascienceobservatory.org/docs"
                className={`${buttonGray} w-full`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Docs
              </a>
              <a
                href="https://metascienceobservatory.org/birds-eye-reviews"
                className={`${buttonGray} w-full`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Reviews
              </a>
              <a
                href="https://metascienceobservatory.org/replications-database"
                className={`${buttonGray} w-full`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Replications Database
              </a>
              <a
                href="https://metascienceobservatory.org/#donate"
                className={`${buttonBlue} w-full`}
                onClick={() => setIsMobileMenuOpen(false)}
              >
                Donate
              </a>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
}
