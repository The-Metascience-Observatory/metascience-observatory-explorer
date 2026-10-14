# Security Policy

## Reporting a vulnerability

Please report security issues **privately**, not as a public GitHub issue.

- Email **dan@metascienceobservatory.org** with "security" in the subject, or
- Use GitHub's **Report a vulnerability** button on the Security tab, if enabled.

Expect an acknowledgement within about a week. This is a single-maintainer
research project, not a staffed service — there is no bounty and no guaranteed
turnaround, but reports are genuinely welcome and will be read.

Please include enough to reproduce: the URL or endpoint, the request, and what
you observed. If a fix is straightforward, say so; it will usually be faster
than a long back-and-forth.

## Scope

The live deployment is <https://explore.metascienceobservatory.org>. In scope:

- Anything that lets an unauthenticated visitor read or alter data they should
  not, or escalate access
- Denial of service that a single visitor can trigger cheaply — a request that
  stalls the server, exhausts memory, or blocks other requests. The backend is
  read-only SQLite measured in terabytes, and the app is single-process, so a
  slow query is a whole-site outage. This is the most useful class of report.
- Injection of any kind: SQL, SQLite FTS5 `MATCH` expressions, SPARQL (the
  Wikidata lookup), HTML/XSS, or log injection
- Bypasses of the rate limiting, blocklist, or allowlist in `middleware.ts` and
  `lib/blocklist.ts`
- Anything that exposes visitor data from `analytics.db`, which is the only
  personal data here (IP addresses and request paths)

## Not in scope

- **`npm audit` output on its own.** Dev-only advisories with no upstream fix
  are tracked deliberately; see the dependency audit policy in `CLAUDE.md`.
  Production dependencies are gated in CI and expected to stay clean, so a
  finding *there* is in scope.
- **Anything requiring local access** to the SQLite files in `data/`. They are
  not in this repository and are not served.
- Missing hardening headers with no demonstrated impact, absent a concrete
  exploitation path.
- Findings against the upstream datasets (SciSciNet, OpenAIRE, PubMed, …) rather
  than this code. Report those to the dataset providers.

## What this code is

A public, read-only dashboard over published bibliometric data. There are no
user accounts and no login. The only authenticated surface is
`/api/analytics/stats`, which is gated by a bearer token and returns visitor
logs. Everything else is intentionally public.

Note that the repository is published for transparency and is **not** licensed
for reuse — see [LICENSE](LICENSE). That does not restrict security research
against the live site; please just report what you find rather than publishing
it first.
