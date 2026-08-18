/**
 * Environment access. Every read goes through here so that a missing variable
 * fails loudly at the call site instead of producing `undefined` three layers
 * down inside a transaction builder.
 */

export function envStr(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

export function envInt(name: string, fallback?: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required environment variable: ${name}`);
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number, got "${raw}"`);
  return n;
}

export function envOptional(name: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === "" ? undefined : v;
}

/** Guard for modules that must never be bundled into the client. */
export function assertServer(where: string): void {
  if (typeof window !== "undefined") {
    throw new Error(`${where} was imported in the browser. It is server-only.`);
  }
}
