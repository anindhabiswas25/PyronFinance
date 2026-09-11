import Link from "next/link";

/**
 * The hero's single call to action.
 *
 * Dark fill, pill radius, blue on hover, centred under the headline. It used to
 * point at /strategy, the app's entry point; with the app removed from this
 * repo there is nothing to launch, so it drops the visitor at the waitlist in
 * the footer instead — which is what this pill asked for originally.
 *
 * There is intentionally only one of these on the page. A second copy in the
 * header competed with the hero for the same click while the visitor was still
 * reading what Pyron is.
 */
export function LaunchApp() {
  return (
    <Link className="launch-cta hero-s" href="#waitlist">
      <span>Join the Waitlist</span>
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
