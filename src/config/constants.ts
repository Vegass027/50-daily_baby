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

/**
 * Константы мониторинга цен (Phase 2)
 */
export const PRICE_MONITORING = {
  // Интервалы мониторинга (в миллисекундах)
  DEX_MONITORING_INTERVAL: parseInt(process.env.DEX_MONITORING_INTERVAL || '3000', 10), // 3 секунды
  BONDING_CURVE_MONITORING_INTERVAL: parseInt(process.env.BONDING_CURVE_MONITORING_INTERVAL || '2000', 10), // 2 секунды

  // TTL кэшей (в миллисекундах)
  PRICE_CACHE_TTL: parseInt(process.env.PRICE_CACHE_TTL || '5000', 10), // 5 секунд
  TOKEN_TYPE_CACHE_TTL: parseInt(process.env.TOKEN_TYPE_CACHE_TTL || '60000', 10), // 1 минута
  MIGRATION_CACHE_TTL: parseInt(process.env.MIGRATION_CACHE_TTL || '30000', 10), // 30 секунд

  // Rate limiting
  MAX_PARALLEL_REQUESTS: parseInt(process.env.MAX_PARALLEL_REQUESTS || '10', 10), // Макс. параллельных запросов
  JUPITER_BATCH_SIZE: 100, // Макс. токенов в одном batch запросе Jupiter
  PUMP_FUN_BATCH_SIZE: 10, // Макс. параллельных запросов к Pump.fun
} as const;