import { useState, type ReactNode } from 'react';
import { Check, CircleHelp, Upload, X } from 'lucide-react';

/** A JSON text area with a file loader beside it. */
export function JsonInput({ id, label, value, onChange, placeholder, rows = 7 }: { id: string; label: string; value: string; onChange(v: string): void; placeholder: string; rows?: number }) {
  const [fileError, setFileError] = useState<string>();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="label">
          {label}
        </label>
        <label className="inline-flex items-center gap-1.5 text-13.5 text-mu hover:text-tx cursor-pointer">
          <Upload size={14} aria-hidden="true" />
          Load a file
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              try {
                onChange(await file.text());
                setFileError(undefined);
              } catch {
                setFileError('That file couldn’t be read.');
              }
            }}
          />
        </label>
      </div>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        spellCheck={false}
        placeholder={placeholder}
        className="rounded-input border border-line bg-bg px-3 py-2.5 font-mono text-12.5 outline-none focus:border-mu resize-y"
      />
      {fileError && <p className="text-12.5 text-bad">{fileError}</p>}
    </div>
  );
}

const ICON: Record<string, ReactNode> = {
  pass: <Check size={15} aria-hidden="true" className="text-ok" />,
  fail: <X size={15} aria-hidden="true" className="text-bad" />,
  unknown: <CircleHelp size={15} aria-hidden="true" className="text-mu" />,
};
const WORD: Record<string, string> = { pass: 'Passed', fail: 'Failed', unknown: 'Not checked' };

/** Every check on its own line, with its state in words as well as an icon. */
export function Checklist({ rows, label }: { rows: Array<{ id: string; label: string; state: string; detail?: string }>; label: string }) {
  return (
    <ul aria-label={label} className="flex flex-col divide-y divide-line2 rounded-input border border-line2">
      {rows.map((r) => (
        <li key={r.id} className="flex items-start gap-2.5 px-3.5 py-2.5 text-13.5">
          <span className="mt-0.5">{ICON[r.state]}</span>
          <span className="flex-1 min-w-0">
            <span className="block">
              <span className="sr-only">{WORD[r.state]}: </span>
              {r.label}
            </span>
            {r.detail && <span className="block text-12.5 text-mu mt-0.5 break-words">{r.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}
