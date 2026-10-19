import { X_HANDLE, X_URL } from "@/lib/social";

/** The X (Twitter) logo linking to the Silent Fill account. */
export function XLink({ label = false }: { label?: boolean }) {
  return (
    <a className="x-link" href={X_URL} target="_blank" rel="noreferrer" aria-label={`Silent Fill on X (@${X_HANDLE})`}>
      <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden>
        <path
          fill="currentColor"
          d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
        />
      </svg>
      {label && <span>@{X_HANDLE}</span>}
    </a>
  );
}
