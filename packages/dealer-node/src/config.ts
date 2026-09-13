// TOML config — DEALER-NODE.md §2. Parsed and validated ONCE, at startup: a node that discovers bad
// config at quote time has already committed to something. "Safe by default" means a misconfigured
// node quotes too little, never too much, so every limit is required and bounded here.
//
// Amounts are decimal strings in TOML and exact bigints in memory — never floats.
//
// Deviations from the §2 sample, each deliberate:
//   * [risk].challenge_response_secs is REJECTED: Class B was removed 2026-09-14.
//   * [network].proof_servers is a list: the proof server does not parallelise (ROADMAP 2.8), so
//     capacity scales by adding servers.
//   * [reserve] and [pool] are new: the UTXO reserve and warm-pool shape (DEALER-NODE.md §5).
//   * No secret material is accepted anywhere in this file.

import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'smol-toml';
import { PAIR_CODES, encodeTerms } from '../../sdk/src/terms.js';

/** Mirrors the contract's MAX_QUOTE_VALIDITY. */
export const MAX_QUOTE_VALIDITY_SECS = 900;
/** Offer File default life (offers.ts OFFER_FILE_EXPIRY_SECS). A refresh cadence at or above it can never keep a pool warm. */
export const OFFER_LIFETIME_SECS = 3600;

export type NetworkId = 'undeployed' | 'preprod' | 'preview' | 'mainnet';
export type MidSource = 'manual' | 'external' | 'script';

export interface QuotePolicy {
  pair: string;
  enabled: boolean;
  midSource: MidSource;
  /** Required when midSource = manual. 6-dp fixed point, as terms.ts encodes prices. */
  midPrice?: string;
  midUrl?: string;
  midCommand?: string;
  spreadBps: number;
  /** tNIGHT base units. */
  minSize: bigint;
  maxSize: bigint;
  /** Base units of the asset the dealer gives on a side; quoting that side stops below it. */
  inventoryFloor: bigint;
  validitySecs: number;
  refreshSecs: number;
  expiryMarginSecs: number;
  settlementMarginSecs: number;
  /** Ladder: sizes to keep pre-proved per side. */
  ladderSizes: bigint[];
}

export interface DealerConfig {
  file: string;
  identity: { secretKeyPath: string; walletSeedPath?: string };
  network: {
    network: NetworkId;
    indexer: string;
    indexerWs: string;
    rpc: string;
    proofServers: string[];
    contract: string;
  };
  relays: { endpoints: string[]; revealListen?: string; revealPublic?: string; useMailbox: boolean };
  bond: { minimumBalance: bigint; autoTopup: boolean; topupTarget: bigint };
  reserve: {
    /** Unshielded tNIGHT UTXOs offer construction may never select. */
    minUtxos: number;
    /** Each reserved UTXO's minimum value (base units). */
    minUtxoValue: bigint;
  };
  pool: {
    /** Refuse any half that fails time-to-dismiss, and require this fraction of headroom (e.g. 0.3). */
    dismissHeadroom: number;
    /** Merge small UTXOs when a wallet holds more than this many. */
    consolidateAbove: number;
  };
  policies: QuotePolicy[];
  risk: { maxLiveQuotes: number; maxTotalNotional: bigint; haltOnSlash: boolean };
  journalPath: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

type Table = Record<string, unknown>;

function table(parent: Table, key: string, where: string): Table {
  const v = parent[key];
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new ConfigError(`${where}: [${key}] table is required`);
  return v as Table;
}
function str(t: Table, key: string, where: string, opt = false): string {
  const v = t[key];
  if (v === undefined && opt) return undefined as never;
  if (typeof v !== 'string' || v.length === 0) throw new ConfigError(`${where}.${key} must be a non-empty string`);
  return v;
}
function bool(t: Table, key: string, where: string, dflt?: boolean): boolean {
  const v = t[key];
  if (v === undefined && dflt !== undefined) return dflt;
  if (typeof v !== 'boolean') throw new ConfigError(`${where}.${key} must be true or false`);
  return v;
}
function int(t: Table, key: string, where: string, min: number, max: number, dflt?: number): number {
  let v = t[key];
  if (v === undefined && dflt !== undefined) v = dflt;
  // smol-toml returns integers as number (or bigint beyond 2^53); floats are refused outright.
  const n = typeof v === 'bigint' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n)) throw new ConfigError(`${where}.${key} must be an integer`);
  if (n < min || n > max) throw new ConfigError(`${where}.${key} = ${n} is outside [${min}, ${max}]`);
  return n;
}
/** Decimal string, 6 dp max, to base units. A TOML number is refused: amounts are never floats. */
function amount(t: Table, key: string, where: string, dflt?: string): bigint {
  const v = t[key] ?? dflt;
  if (typeof v !== 'string') throw new ConfigError(`${where}.${key} must be a decimal STRING (e.g. "1000"), never a number`);
  if (!/^\d+(\.\d{1,6})?$/.test(v)) throw new ConfigError(`${where}.${key} = "${v}" is not a non-negative decimal with <= 6 dp`);
  const [whole, frac = ''] = v.split('.');
  return BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, '0'));
}
function urlList(v: unknown, where: string, schemes: RegExp): string[] {
  if (!Array.isArray(v) || v.length === 0) throw new ConfigError(`${where} must be a non-empty array`);
  return v.map((u, i) => {
    if (typeof u !== 'string' || !schemes.test(u)) throw new ConfigError(`${where}[${i}] = ${String(u)} has the wrong scheme`);
    return u;
  });
}

const FORBIDDEN_SECRET_KEYS = /seed|secret(?!_key_path)|private|mnemonic|password/i;

function rejectSecrets(v: unknown, where: string): void {
  if (typeof v !== 'object' || v === null) return;
  for (const [k, child] of Object.entries(v)) {
    if (FORBIDDEN_SECRET_KEYS.test(k) && !k.endsWith('_path')) {
      throw new ConfigError(`${where}.${k}: secrets must never be written into config — use a 0600 file path or an env var`);
    }
    rejectSecrets(child, `${where}.${k}`);
  }
}

export function parseConfig(text: string, file = '<inline>'): DealerConfig {
  let root: Table;
  try {
    root = parse(text) as Table;
  } catch (err) {
    throw new ConfigError(`${file}: invalid TOML: ${(err as Error).message}`);
  }
  rejectSecrets(root, 'config');
  const base = path.dirname(path.resolve(file));
  const rel = (p: string) => path.resolve(base, p);

  const id = table(root, 'identity', 'config');
  const net = table(root, 'network', 'config');
  const relays = table(root, 'relays', 'config');
  const bond = table(root, 'bond', 'config');
  const risk = table(root, 'risk', 'config');
  const reserve = (root.reserve as Table | undefined) ?? {};
  const pool = (root.pool as Table | undefined) ?? {};

  if ('challenge_response_secs' in risk) {
    throw new ConfigError(
      'risk.challenge_response_secs: Class B settlement challenges were removed from the protocol (2026-09-14); delete this key',
    );
  }

  const network = str(net, 'network', 'network') as NetworkId;
  if (!['undeployed', 'preprod', 'preview', 'mainnet'].includes(network)) throw new ConfigError(`network.network = ${network} is not a known network`);
  const contract = str(net, 'contract', 'network');
  if (!/^[0-9a-f]{64}$/.test(contract)) throw new ConfigError('network.contract must be the 64-hex OTCProtocol address');
  const proofServers = urlList(net.proof_servers ?? (net.proof_server ? [net.proof_server] : undefined), 'network.proof_servers', /^https?:\/\//);

  const endpoints = urlList(relays.endpoints, 'relays.endpoints', /^wss?:\/\//);
  if (endpoints.length < 2) {
    throw new ConfigError('relays.endpoints needs at least 2 relays — a single relay can censor every quote (RELAY.md §6)');
  }
  const useMailbox = bool(relays, 'use_mailbox', 'relays', false);
  const revealPublic = relays.reveal_public as string | undefined;
  if (!useMailbox && !revealPublic) throw new ConfigError('relays: set reveal_public, or use_mailbox = true');

  const rawPolicies = root.quote_policy;
  if (!Array.isArray(rawPolicies) || rawPolicies.length === 0) throw new ConfigError('at least one [[quote_policy]] is required');
  const policies = rawPolicies.map((p: Table, i): QuotePolicy => {
    const where = `quote_policy[${i}]`;
    const pair = str(p, 'pair', where);
    if (PAIR_CODES[pair] === undefined) throw new ConfigError(`${where}.pair = ${pair} is not a known pair code (terms.ts)`);
    if (network === 'mainnet' && pair === 'tNIGHT/TESTUSD') throw new ConfigError(`${where}: TESTUSD is testnet scaffolding and must never be quoted on mainnet`);
    const midSource = str(p, 'mid_source', where) as MidSource;
    if (!['manual', 'external', 'script'].includes(midSource)) throw new ConfigError(`${where}.mid_source must be manual | external | script`);
    const midPrice = p.mid_price as string | undefined;
    if (midSource === 'manual') {
      if (typeof midPrice !== 'string') throw new ConfigError(`${where}.mid_price (a decimal string) is required for mid_source = manual`);
      try {
        encodeTerms({ pair, side: 'buy', price: midPrice, size: '0' });
      } catch (err) {
        throw new ConfigError(`${where}.mid_price: ${(err as Error).message}`);
      }
    }
    const validitySecs = int(p, 'validity_secs', where, 60, MAX_QUOTE_VALIDITY_SECS);
    const settlementMarginSecs = int(p, 'settlement_margin_secs', where, 60, 1800, 300);
    const expiryMarginSecs = int(p, 'expiry_margin_secs', where, 0, OFFER_LIFETIME_SECS, 900);
    if (expiryMarginSecs < validitySecs + settlementMarginSecs) {
      throw new ConfigError(
        `${where}: expiry_margin_secs (${expiryMarginSecs}) must be >= validity_secs + settlement_margin_secs ` +
          `(${validitySecs + settlementMarginSecs}), or the pool keeps offers that cannot back a quote`,
      );
    }
    const refreshSecs = int(p, 'refresh_secs', where, 60, OFFER_LIFETIME_SECS - 1);
    if (refreshSecs > OFFER_LIFETIME_SECS - expiryMarginSecs) {
      throw new ConfigError(`${where}: refresh_secs ${refreshSecs} lets offers age past expiry_margin between ticks`);
    }
    const minSize = amount(p, 'min_size', where);
    const maxSize = amount(p, 'max_size', where);
    if (minSize <= 0n || maxSize < minSize) throw new ConfigError(`${where}: need 0 < min_size <= max_size`);
    const ladder = (p.ladder_sizes as unknown[] | undefined) ?? [p.max_size];
    const ladderSizes = ladder.map((s, j) => amount({ s }, 's', `${where}.ladder_sizes[${j}]`));
    for (const s of ladderSizes) if (s < minSize || s > maxSize) throw new ConfigError(`${where}.ladder_sizes: ${s} outside [min_size, max_size]`);
    return {
      pair,
      enabled: bool(p, 'enabled', where, true),
      midSource,
      midPrice,
      midUrl: p.mid_url as string | undefined,
      midCommand: p.mid_command as string | undefined,
      spreadBps: int(p, 'spread_bps', where, 1, 5000),
      minSize,
      maxSize,
      inventoryFloor: amount(p, 'inventory_floor', where),
      validitySecs,
      refreshSecs,
      expiryMarginSecs,
      settlementMarginSecs,
      ladderSizes,
    };
  });

  const cfg: DealerConfig = {
    file: path.resolve(file),
    identity: {
      secretKeyPath: rel(str(id, 'secret_key_path', 'identity')),
      walletSeedPath: id.wallet_seed_path ? rel(str(id, 'wallet_seed_path', 'identity')) : undefined,
    },
    network: {
      network,
      indexer: str(net, 'indexer', 'network'),
      indexerWs: str(net, 'indexer_ws', 'network'),
      rpc: str(net, 'rpc', 'network'),
      proofServers,
      contract,
    },
    relays: { endpoints, revealListen: relays.reveal_listen as string | undefined, revealPublic, useMailbox },
    bond: {
      minimumBalance: amount(bond, 'minimum_balance', 'bond'),
      autoTopup: bool(bond, 'auto_topup', 'bond', false),
      topupTarget: amount(bond, 'topup_target', 'bond', '0'),
    },
    reserve: {
      minUtxos: int(reserve, 'min_utxos', 'reserve', 1, 64, 2),
      minUtxoValue: amount(reserve, 'min_utxo_value', 'reserve', '1'),
    },
    pool: {
      dismissHeadroom: (() => {
        const h = pool.dismiss_headroom ?? 0.3;
        if (typeof h !== 'number' || h < 0 || h >= 1) throw new ConfigError('pool.dismiss_headroom must be a number in [0, 1)');
        return h;
      })(),
      consolidateAbove: int(pool, 'consolidate_above', 'pool', 2, 1000, 8),
    },
    policies,
    risk: {
      maxLiveQuotes: int(risk, 'max_live_quotes', 'risk', 1, 1000),
      maxTotalNotional: amount(risk, 'max_total_notional', 'risk'),
      haltOnSlash: bool(risk, 'halt_on_slash', 'risk', true),
    },
    journalPath: rel((root.journal_path as string | undefined) ?? './dealer-journal.log'),
  };
  if (cfg.bond.autoTopup && cfg.bond.topupTarget <= cfg.bond.minimumBalance) {
    throw new ConfigError('bond.topup_target must exceed bond.minimum_balance when auto_topup = true');
  }
  for (const p of policies) {
    if (p.maxSize > cfg.risk.maxTotalNotional) throw new ConfigError(`quote_policy ${p.pair}: max_size exceeds risk.max_total_notional`);
  }
  return cfg;
}

export function loadConfig(file: string): DealerConfig {
  return parseConfig(fs.readFileSync(file, 'utf-8'), file);
}
