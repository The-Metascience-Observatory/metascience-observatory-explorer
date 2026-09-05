import type { NextConfig } from "next";

const securityHeaders = [
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'X-XSS-Protection',
    value: '1; mode=block',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains',
  },
  {
    key: 'Content-Security-Policy',
    value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' https://upload.wikimedia.org https://commons.wikimedia.org data:; connect-src 'self'; frame-src https://platform.twitter.com;",
  },
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // Exclude data directory from build tracing (databases are mounted at runtime)
  outputFileTracingExcludes: {
    '*': ['./data/**/*'],
  },
  // lib/db-worker.js is loaded at runtime via path.join(process.cwd(), ...) and
  // is never statically imported, so Next's file tracer cannot see it. Without
  // this the worker pool breaks in a standalone build.
  outputFileTracingIncludes: {
    '*': ['./lib/db-worker.js'],
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "upload.wikimedia.org",
        pathname: "/**",
      },
      {
        protocol: "https",
        hostname: "commons.wikimedia.org",
        pathname: "/**",
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      // Keep these out of the index with a header rather than a robots.txt
      // Disallow: a disallowed URL can still be indexed from an external link,
      // because the crawler never fetches it to discover the noindex.
      {
        source: '/analytics',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
      {
        source: '/api/:path*',
        headers: [{ key: 'X-Robots-Tag', value: 'noindex' }],
      },
    ];
  },
};

// Runs middleware.ts in the Node.js runtime so it can read data/blocklist.json
// from disk (the Edge runtime has no filesystem access). Next 15.5 honours this
// flag at runtime but hasn't added it to ExperimentalConfig yet, hence the cast
// and the "Unrecognized key" warning at build time.
nextConfig.experimental = {
  nodeMiddleware: true,
  // lucide-react alone is imported in 42 files; barrel-optimising these keeps
  // unused icons and chart primitives out of the client bundles.
  optimizePackageImports: ["lucide-react", "recharts", "d3"],
} as NextConfig["experimental"];

export default nextConfig;
