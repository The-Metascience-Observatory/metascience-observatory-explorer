"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Client-side beacon to log page visits
// Sends current path to server, which extracts real IP/country from headers
export function VisitorTracker() {
  const pathname = usePathname();

  useEffect(() => {
    // Don't track the analytics page itself
    if (pathname === "/analytics") return;

    // Send beacon to log this visit
    fetch("/api/analytics/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: pathname }),
      // Use keepalive to ensure request completes even if page unloads
      keepalive: true,
    }).catch(() => {
      // Silently ignore errors - analytics shouldn't break the site
    });
  }, [pathname]);

  return null; // This component renders nothing
}
