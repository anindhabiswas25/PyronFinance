import { LoadingRegion, Skeleton } from '../design/primitives';

export function PageSkeleton({ label = 'Loading the page' }: { label?: string }) {
  return (
    <LoadingRegion label={label} className="flex flex-col gap-4">
      <Skeleton width="38%" height={30} />
      <Skeleton width="62%" height={14} />
      <div className="grid gap-4 md:grid-cols-3 mt-4">
        <Skeleton height={96} className="rounded-card" />
        <Skeleton height={96} className="rounded-card" />
        <Skeleton height={96} className="rounded-card" />
      </div>
      <Skeleton height={260} className="rounded-card mt-2" />
    </LoadingRegion>
  );
}

/** Routes that load @otc/sdk/browser (and its WASM) show this while it downloads. */
export function VerifierSkeleton() {
  return <PageSkeleton label="Loading the verifier…" />;
}
