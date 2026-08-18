import { NextResponse } from "next/server";

/** BigInt has no JSON representation, and lamport amounts must never be coerced
 *  through Number. Every response serializes them as decimal strings. */
export function json(data: unknown, init?: ResponseInit): NextResponse {
  const body = JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  return new NextResponse(body, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
}

/** Error responses carry a message but never a stack trace or internal detail. */
export function fail(message: string, status = 400): NextResponse {
  return json({ error: message }, { status });
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unexpected error.";
}

/** Shared secret guard for cron routes, so they cannot be triggered by anyone
 *  who happens to find the URL. */
export function assertCronAuth(req: Request): void {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new Error("CRON_SECRET is not configured.");
  const header = req.headers.get("authorization");
  if (header !== `Bearer ${secret}`) throw new Error("Unauthorized.");
}
