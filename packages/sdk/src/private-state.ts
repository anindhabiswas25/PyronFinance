// Private state shape for OTCProtocol. Follows the witness-provider pattern in
// compact-contracts SKILL.md §7 — witnesses are untrusted by the circuit and must be
// validated against ledger state (dealerCommitment lookup does this structurally).

export interface OTCPrivateState {
  /** Dealer's 32-byte secret key. Required only for dealer-role circuits (postBond, topUpBond,
   *  requestBondWithdrawal, withdrawBond, commitQuote, recordSettlement). Never disclosed. */
  dealerSecretKey: Uint8Array | null;
  /** 32-byte payout address of whoever submits a fraud proof (slashBond's prover-bounty path).
   *  Never disclosed. */
  takerAddress: Uint8Array | null;
}

export function emptyPrivateState(): OTCPrivateState {
  return { dealerSecretKey: null, takerAddress: null };
}
