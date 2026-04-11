"use client";

import { usePathname } from "next/navigation";

export function Footer() {
  const pathname = usePathname();

  // Hide footer on home page (has its own about section) and funders map (has inline attribution)
  if (pathname === "/" || pathname.startsWith("/funders-map")) {
    return null;
  }

  return null;
}
