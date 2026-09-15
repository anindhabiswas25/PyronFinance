import { useEffect, useState } from 'react';
import { ChevronRight, Wallet } from 'lucide-react';
import { Banner, Dialog } from '../design/primitives';
import { cx } from '../design/cx';
import { useData } from '../data/DataProvider';
import { useWallet } from '../data/useWallet';
import { lastWalletRdns } from '../state/wallet';
import type { WalletInfo } from '../data/ports';

/** Extensions inject asynchronously; look again for a few seconds after opening. */
function useDiscoveredWallets(open: boolean): { wallets: WalletInfo[]; searching: boolean } {
  const { wallet } = useData();
  const [wallets, setWallets] = useState<WalletInfo[]>(() => wallet.discover());
  const [searching, setSearching] = useState(true);
  useEffect(() => {
    if (!open) return;
    setSearching(true);
    const started = Date.now();
    setWallets(wallet.discover());
    const id = setInterval(() => {
      const found = wallet.discover();
      setWallets(found);
      if (found.length > 0 || Date.now() - started > 3000) {
        setSearching(false);
        clearInterval(id);
      }
    }, 300);
    return () => clearInterval(id);
  }, [open, wallet]);
  return { wallets, searching };
}

export function ConnectWalletDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const { network, source } = useData();
  const { connect, status, info, error } = useWallet();
  const { wallets, searching } = useDiscoveredWallets(open);
  const last = lastWalletRdns();
  const sorted = [...wallets].sort((a, b) => Number(b.rdns === last) - Number(a.rdns === last));

  return (
    <Dialog open={open} onClose={onClose} title="Connect a wallet" description={`Connects on ${network.label}. Nothing is signed until you approve it in the wallet.`} size="sm">
      <div className="flex flex-col gap-2.5">
        {error && (
          <Banner tone="bad" title="Not connected" urgent>
            {error}
          </Banner>
        )}
        {sorted.map((w) => {
          const busy = status === 'connecting' && info?.rdns === w.rdns;
          return (
            <button
              key={w.rdns}
              type="button"
              disabled={!w.supported || status === 'connecting'}
              onClick={async () => {
                if (await connect(w.rdns)) onClose();
              }}
              aria-busy={busy || undefined}
              className={cx(
                'flex items-center gap-3 rounded-input border px-3.5 py-3 text-left transition-colors duration-hover',
                w.rdns === last ? 'border-tx' : 'border-line hover:border-mu',
                !w.supported && 'opacity-70 cursor-not-allowed hover:border-line',
              )}
            >
              <span aria-hidden="true" className="grid place-items-center w-[34px] h-[34px] rounded-btn bg-s2 shrink-0 overflow-hidden">
                {w.icon ? <img src={w.icon} alt="" width={22} height={22} /> : <Wallet size={17} strokeWidth={1.7} />}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block font-semibold">{w.name}</span>
                <span className="block text-12.5 text-mu">
                  {busy
                    ? 'Approve in the wallet…'
                    : source === 'fixture'
                      ? 'Part of the sample data, not a browser extension'
                      : w.supported
                        ? `DApp Connector ${w.apiVersion}${w.rdns === last ? ' · used last time' : ''}`
                        : w.unsupportedReason}
                </span>
              </span>
              <ChevronRight size={15} className="text-mu" aria-hidden="true" />
            </button>
          );
        })}
        {sorted.length === 0 && (
          <p className="text-13.5 text-mu py-2" role="status">
            {searching ? 'Looking for wallet extensions…' : 'No Midnight wallet found in this browser. Install or enable a DApp Connector wallet (Lace or 1AM), then reload.'}
          </p>
        )}
        <p className="text-12.5 text-mu">You can browse Activity, Dealers and Verify without connecting.</p>
      </div>
    </Dialog>
  );
}
