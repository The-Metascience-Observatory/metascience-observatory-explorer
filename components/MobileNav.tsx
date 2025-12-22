"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";

const navLinks = [
  { href: "/", label: "Search" },
  { href: "/fields", label: "Field Explorer" },
  { href: "/funders-map", label: "Funders Map" },
  { href: "https://metascienceobservatory.org", label: "Metascience Observatory", external: true },
];

export function MobileNav() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="md:hidden">
      {/* Hamburger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 -mr-2 text-gray-600 hover:text-gray-900"
        aria-label={isOpen ? "Close menu" : "Open menu"}
      >
        {isOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
      </button>

      {/* Mobile menu dropdown */}
      {isOpen && (
        <div className="absolute top-full left-0 right-0 bg-white border-b shadow-lg z-50">
          <nav className="flex flex-col py-2">
            {navLinks.map((link) =>
              link.external ? (
                <a
                  key={link.href}
                  href={link.href}
                  className="px-4 py-3 text-sm hover:bg-gray-50"
                  onClick={() => setIsOpen(false)}
                >
                  {link.label}
                </a>
              ) : (
                <Link
                  key={link.href}
                  href={link.href}
                  className="px-4 py-3 text-sm hover:bg-gray-50"
                  onClick={() => setIsOpen(false)}
                >
                  {link.label}
                </Link>
              )
            )}
          </nav>
        </div>
      )}
    </div>
  );
}
