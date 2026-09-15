import { FlaskConical } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useDataSource } from './dataSource';

/** Persistent on every page in fixture mode, so nothing sample-sourced can pass for chain data. */
export function FixtureBanner() {
  const source = useDataSource();
  const { pathname } = useLocation();
  if (source !== 'fixture') return null;
  return (
    <div role="note" aria-label="Sample data" className="bg-warnbg text-warn border-b border-line2">
      <div className="max-w-content mx-auto px-4 md:px-gutter py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-13.5">
        <span className="inline-flex items-center gap-1.5 font-semibold">
          <FlaskConical size={15} strokeWidth={1.7} aria-hidden="true" />
          Sample data
        </span>
        <span className="text-tx">Every number here comes from a built-in scenario, not the chain. No wallet or relay is contacted.</span>
        <Link to={`${pathname}?data=live`} className="ml-auto underline underline-offset-2 hover:text-tx">
          Use live data
        </Link>
      </div>
    </div>
  );
}
