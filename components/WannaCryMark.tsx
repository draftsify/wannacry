/**
 * The WannaCry mark, redrawn as vector.
 *
 * The source was a 400×400 JPEG of orange line art on a flat grey field.
 * Keying that background out would have left soft edges and a fixed
 * resolution, so the shape is rebuilt as paths instead: transparent by
 * construction, crisp at any size, and it inherits `currentColor` so the same
 * component works on the light landing and the dark explorer.
 */
export function WannaCryMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 400 400"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label="WannaCry"
    >
      {/* Antenna */}
      <circle cx="200" cy="86" r="13" fill="currentColor" stroke="none" />
      <path d="M200 100 V120" strokeWidth="13" />

      {/* Ears */}
      <rect x="86" y="168" width="27" height="60" rx="13.5" strokeWidth="13" />
      <rect x="287" y="168" width="27" height="60" rx="13.5" strokeWidth="13" />

      {/* Head */}
      <rect x="110" y="118" width="180" height="172" rx="32" strokeWidth="15" />

      {/* Brows and eyes — the whole expression lives in these four shapes */}
      <path d="M137 150 L188 181" strokeWidth="16" />
      <path d="M263 150 L212 181" strokeWidth="16" />
      <path d="M142 175 L187 192 L146 197 Z" fill="currentColor" stroke="none" />
      <path d="M258 175 L213 192 L254 197 Z" fill="currentColor" stroke="none" />

      {/* Gritted teeth */}
      <rect x="142" y="227" width="118" height="53" rx="9" strokeWidth="13" />
      <path d="M172 227 V280 M201 227 V280 M231 227 V280" strokeWidth="11" />
      <path d="M142 253 H260" strokeWidth="11" />

      {/* Legs */}
      <path d="M157 290 V322 M243 290 V322" strokeWidth="13" />
    </svg>
  );
}
