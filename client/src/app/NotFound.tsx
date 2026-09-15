import { useLocation } from 'react-router-dom';
import { ButtonLink, EmptyState } from '../design/primitives';

export function NotFound() {
  const { pathname } = useLocation();
  return (
    <EmptyState
      title="No page at this address"
      actions={
        <>
          <ButtonLink to="/trade" variant="primary">
            Request quotes
          </ButtonLink>
          <ButtonLink to="/">Go to the venue</ButtonLink>
        </>
      }
    >
      <p>
        <span className="font-mono text-12.5">{pathname}</span> is not part of this app. Check the link, or start from one of these.
      </p>
    </EmptyState>
  );
}
