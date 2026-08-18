/** Client-safe formatting. No imports from server modules. */

export function solFromLamports(lamports: string | bigint, dp = 3): string {
  const n = Number(BigInt(lamports)) / 1_000_000_000;
  return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function short(address: string, n = 4): string {
  return address.length <= n * 2 + 3 ? address : `${address.slice(0, n)}…${address.slice(-n)}`;
}

export function bps(value: number | null, dp = 1): string {
  return value === null ? "—" : `${(value / 100).toFixed(dp)}%`;
}

export function ago(iso: string | null): string {
  if (!iso) return "—";
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return `${Math.floor(seconds)}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/** Raw token units to a decimal string. Kept in BigInt space so large supplies
 *  do not lose precision on the way to the screen. */
export function tokenAmount(raw: string | bigint | null, decimals: number): string {
  if (raw === null) return "—";
  const value = BigInt(raw);
  if (decimals === 0) return value.toString();
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = (value % base).toString().padStart(decimals, "0").slice(0, 6).replace(/0+$/, "");
  return frac ? `${whole.toLocaleString()}.${frac}` : whole.toLocaleString();
}

/** A symbol comes from token metadata, which is attacker-controlled. React
 *  escapes it on render; this only keeps it from blowing out the layout. */
export function displaySymbol(symbol: string | null, mint: string): string {
  if (!symbol) return short(mint, 4);
  return symbol.slice(0, 12);
}
