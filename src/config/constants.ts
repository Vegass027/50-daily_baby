import { PublicKey } from '@solana/web3.js';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';
export const PUMP_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
export const BONDING_CURVE_SEED = 'bonding-curve';
export const INITIAL_REAL_TOKEN_RESERVES = 793_100_000_000_000n;

export const STRATEGY_PRIORITY = {
  HIGH: 100,
  MEDIUM: 50,
  LOW: 30,
} as const;