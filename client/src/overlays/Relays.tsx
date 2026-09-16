import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Banner, Button, Dialog } from '../design/primitives';
import { cx } from '../design/cx';
import { useData } from '../data/DataProvider';
import { useRelays } from '../data/useRelays';
import { useRelayList } from '../state/relays';
import { normalizeRelayUrl, relayUrlProblem, MIN_RELAYS } from '../data/relay-util';

export function RelaysDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const { network } = useData();
  const view = useRelays();
  const { add, remove, reset, lists } = useRelayList();
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState<string>();
  const customised = Boolean(lists[network.id]);

  function submit() {
    const p = relayUrlProblem(draft, view.urls);
    setProblem(p);
    if (p) return;
    add(network.id, normalizeRelayUrl(draft), network.defaultRelays);
    setDraft('');
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Relays"
      description={`Relays pass requests and seal references between you and dealers on ${network.label}. They never see a price.`}
      size="md"
      footer={
        customised ? (
          <Button size="sm" variant="ghost" onClick={() => reset(network.id)}>
            Reset to defaults
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        {view.count < MIN_RELAYS && (
          <Banner tone={view.count === 1 ? 'warn' : 'bad'} title={view.count === 1 ? 'Only one relay' : 'No relay available'}>
            Requests need at least {MIN_RELAYS}. With one relay, a single operator could hide dealers from you.
          </Banner>
        )}
        {view.urls.length === 0 ? (
          <p className="text-13.5 text-mu">No relays configured. Add at least two below.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line2 rounded-input border border-line2">
            {view.states.map((s) => {
              const ok = view.socketsOpen ? s.connected : s.health?.ok;
              const state = ok ? (view.socketsOpen ? 'Connected' : 'Reachable') : s.health ? (s.health.error ?? 'Unreachable') : 'Checking…';
              return (
                <li key={s.url} className="flex items-center gap-3 px-3.5 py-2.5">
                  <span aria-hidden="true" className={cx('w-[7px] h-[7px] rounded-full shrink-0', ok ? 'bg-ok' : s.health ? 'bg-bad' : 'bg-dim')} />
                  <span className="flex-1 min-w-0">
                    <span className="block font-mono text-12.5 break-all">{s.url}</span>
                    <span className="block text-12.5 text-mu">
                      {state}
                      {s.health?.peers !== undefined && ` · ${s.health.peers} peer${s.health.peers === 1 ? '' : 's'}`}
                    </span>
                  </span>
                  {s.health?.latencyMs !== undefined && <span className="text-12.5 text-mu tabular-nums">{s.health.latencyMs} ms</span>}
                  <button
                    type="button"
                    onClick={() => remove(network.id, s.url, network.defaultRelays)}
                    aria-label={`Remove ${s.url}`}
                    className="grid place-items-center w-8 h-8 rounded-btn-sm text-mu hover:text-bad hover:bg-s2"
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <form
          className="flex flex-col gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label htmlFor="relay-url" className="label">
            Add a relay
          </label>
          <div className="flex gap-2">
            <input
              id="relay-url"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setProblem(undefined);
              }}
              placeholder="wss://relay.example/gossip"
              spellCheck={false}
              aria-invalid={Boolean(problem)}
              aria-describedby={problem ? 'relay-url-problem' : undefined}
              className="flex-1 min-w-0 h-control-sm rounded-btn-sm border border-line bg-bg px-3 font-mono text-12.5 outline-none focus:border-mu"
            />
            <Button type="submit" size="sm">
              <Plus size={15} aria-hidden="true" />
              Add
            </Button>
          </div>
          {problem && (
            <p id="relay-url-problem" className="text-12.5 text-bad">
              {problem}
            </p>
          )}
        </form>
        <p className="text-12.5 text-mu">
          No public relays exist yet. Run your own with the relay-node package, and prefer relays run by unrelated operators. The list is saved in this browser.
        </p>
      </div>
    </Dialog>
  );
}
