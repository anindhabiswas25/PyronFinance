import { useLocation } from 'react-router-dom';
import { SearchX } from 'lucide-react';
import { ButtonLink } from '../design/primitives';

export function NotFound() {
  const { pathname } = useLocation();
  return (
    <section aria-labelledby="page-title" className="flex flex-col items-center text-center gap-3 py-16 px-6">
      <span aria-hidden="true" className="grid place-items-center w-10 h-10 rounded-full bg-s2 text-mu">
        <SearchX size={18} strokeWidth={1.7} />
      </span>
      <h1 id="page-title" className="font-display font-bold text-26">
        No page at this address
      </h1>
      <p className="text-13.5 text-mu max-w-[52ch]">
        <span className="font-mono text-12.5 break-all">{pathname}</span> is not part of this app. Check the link, or start from one of these.
      </p>
      <div className="flex flex-wrap justify-center gap-2 mt-1">
        <ButtonLink to="/trade" variant="primary">
          Request quotes
        </ButtonLink>
        <ButtonLink to="/venue">Go to the venue</ButtonLink>
      </div>
    </section>
  );
}
