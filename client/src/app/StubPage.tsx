import { Chip } from '../design/primitives';

/** Placeholder for a route whose page is built in a later step of the client plan. */
export function StubPage({ title, summary }: { title: string; summary: string }) {
  return (
    <section aria-labelledby="page-title" className="flex flex-col gap-3">
      <h1 id="page-title" className="font-display font-bold text-30">
        {title}
      </h1>
      <p className="text-mu max-w-[62ch]">{summary}</p>
      <div>
        <Chip tone="seal">Not built yet</Chip>
      </div>
    </section>
  );
}
