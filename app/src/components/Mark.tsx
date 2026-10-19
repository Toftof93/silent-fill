/** The Silent Fill mark: the pool (ring), the fill (jade) and the one price line through it. */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <defs>
        <clipPath id="sf-mark">
          <circle cx="50" cy="50" r="34" />
        </clipPath>
      </defs>
      <circle cx="50" cy="50" r="40" fill="none" stroke="#e9e7e2" strokeWidth="5" />
      <rect x="0" y="58" width="100" height="42" fill="#8fd3b6" clipPath="url(#sf-mark)" />
      <line x1="1" y1="58" x2="99" y2="58" stroke="#8fd3b6" strokeWidth="4" />
    </svg>
  );
}
