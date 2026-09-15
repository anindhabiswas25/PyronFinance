import Link from "next/link";

/**
 * The hero's single call to action.
 *
 * Dark fill, pill radius, blue on hover, centred under the headline. The app
 * itself is not in this repo, so until it has a URL this still drops the
 * visitor at the waitlist in the footer — point APP_URL at the app to go live.
 *
 * There is intentionally only one of these on the page. A second copy in the
 * header competed with the hero for the same click while the visitor was still
 * reading what Pyron is.
 */
const APP_URL = "#waitlist";

export function LaunchApp() {
  return (
    <Link className="launch-cta hero-s" href={APP_URL}>
      <span>Launch App</span>
      <svg className="launch-cta-arrow" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M3 8h9.5M9 4.5 12.5 8 9 11.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Link>
  );
}
