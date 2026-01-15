"use client";

import { usePathname } from "next/navigation";

export function Footer() {
  const pathname = usePathname();

  // Hide footer on home page since it has its own about section
  if (pathname === "/") {
    return null;
  }

  return (
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
  );
}
