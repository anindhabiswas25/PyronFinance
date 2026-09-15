// The page side of the test wallet: registers an InitialAPI under window.midnight that forwards every
// call to Node through Playwright's exposeFunction('__pyronWallet'). Same wire encoding as
// wallet-bridge.ts, so bigints and byte arrays arrive intact.

export const TEST_WALLET_RDNS = 'dev.pyron.test-wallet';
export const TEST_WALLET_NAME = 'Pyron test wallet';

const METHODS = [
  'getConfiguration',
  'getConnectionStatus',
  'hintUsage',
  'getUnshieldedAddress',
  'getShieldedAddresses',
  'getUnshieldedBalances',
  'getShieldedBalances',
  'getDustBalance',
  'getTxHistory',
  'balanceSealedTransaction',
  'balanceUnsealedTransaction',
  'submitTransaction',
  'makeIntent',
  'makeTransfer',
  'signData',
];

export function injectScript(networkId: string): string {
  return `(() => {
  const BIG = '$bigint', BYTES = '$bytes';
  const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  const enc = (v) => JSON.stringify(v, function (k, x) {
    const raw = k === '' ? x : this[k];
    if (typeof raw === 'bigint') return { [BIG]: raw.toString() };
    if (raw instanceof Uint8Array) return { [BYTES]: toHex(raw) };
    return x;
  });
  const dec = (t) => JSON.parse(t, (_k, x) => {
    if (x && typeof x === 'object' && !Array.isArray(x)) {
      const ks = Object.keys(x);
      if (ks.length === 1 && ks[0] === BIG) return BigInt(x[BIG]);
      if (ks.length === 1 && ks[0] === BYTES) {
        const h = x[BYTES]; const o = new Uint8Array(h.length / 2);
        for (let i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16);
        return o;
      }
    }
    return x;
  });
  const call = async (method, args) => {
    const out = dec(await window.__pyronWallet(method, enc(args)));
    if (!out.ok) throw new Error(out.error);
    return out.value;
  };
  const api = {};
  for (const m of ${JSON.stringify(METHODS)}) api[m] = (...a) => call(m, a);
  // The client passes its own KeyMaterialProvider; the Node side reads the same compiled keys from disk.
  api.getProvingProvider = async () => ({
    check: async (preimage, keyLocation) => (await call('proverCheck', [preimage, keyLocation])).map((v) => (v === null ? undefined : v)),
    prove: (preimage, keyLocation, overwrite) => call('proverProve', [preimage, keyLocation, overwrite]),
  });
  window.midnight = window.midnight || {};
  window.midnight.pyronTest = {
    rdns: ${JSON.stringify(TEST_WALLET_RDNS)},
    name: ${JSON.stringify(TEST_WALLET_NAME)},
    icon: '',
    apiVersion: '4.0.1',
    connect: async (networkId) => {
      if (networkId !== ${JSON.stringify(networkId)}) throw new Error('the test wallet is on ${networkId}');
      return api;
    },
  };
})();`;
}
