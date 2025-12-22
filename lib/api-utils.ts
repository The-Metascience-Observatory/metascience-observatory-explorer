import { NextResponse } from "next/server";
import { isSqliteBusyError } from "./db";

/**
 * Create a sanitized error response that doesn't expose internal details.
 * Logs the full error server-side for debugging.
 */
export function errorResponse(
  error: unknown,
  context: string,
  status: number = 500
): NextResponse {
  const errorMessage = error instanceof Error ? error.message : "Unknown error";
  const stackTrace = error instanceof Error ? error.stack : String(error);

  // Log full error details server-side
  console.error(`[API Error] ${context}:`, errorMessage);
  if (stackTrace) {
    console.error(stackTrace);
  }

  // Check for SQLite busy error (special case with user-friendly message)
  if (isSqliteBusyError(error)) {
    return NextResponse.json(
      {
        error: "Database is temporarily busy",
        message: "Please try again in a few moments.",
      },
      { status: 503 }
    );
  }

  // Return generic error to client (don't expose internals)
  return NextResponse.json(
    {
      error: getGenericErrorMessage(status),
    },
    { status }
  );
}

/**
 * Get a user-friendly error message based on status code.
 */
function getGenericErrorMessage(status: number): string {
  switch (status) {
    case 400:
      return "Invalid request";
    case 404:
      return "Not found";
    case 429:
      return "Too many requests";
    case 500:
      return "An error occurred. Please try again.";
    case 503:
      return "Service temporarily unavailable";
    default:
      return "An error occurred";
  }
}

/**
 * Validate and sanitize pagination parameters.
 * Returns safe values with bounds checking.
 */
export function parsePagination(
  searchParams: URLSearchParams,
  defaults: { limit?: number; maxLimit?: number } = {}
): { offset: number; limit: number } {
  const { limit: defaultLimit = 50, maxLimit = 100 } = defaults;

  const offset = Math.max(0, parseInt(searchParams.get("offset") || "0", 10) || 0);
  const limit = Math.min(
    maxLimit,
    Math.max(1, parseInt(searchParams.get("limit") || String(defaultLimit), 10) || defaultLimit)
  );

  return { offset, limit };
}

/**
 * Validate search query length.
 * Returns null if valid, or an error response if too long.
 */
export function validateQueryLength(
  query: string | null,
  maxLength: number = 200
): NextResponse | null {
  if (query && query.length > maxLength) {
    return NextResponse.json({
      results: [],
      message: `Query too long (max ${maxLength} characters)`,
    });
  }
  return null;
}

/**
 * Create a fetch request with timeout.
 * Prevents hanging requests to external APIs.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 10000
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}
