/**
 * Типы для сервисов API
 */

import { Transaction, PublicKey } from '@solana/web3.js';

// ============================================================================
// ITransactionSubmitter типы
// ============================================================================

/**
 * Результат симуляции транзакции
 */
export interface SimulationResult {
  success: boolean;
  error?: string;
  logs?: string[];
}

/**
 * Опции отправки транзакции
 */
export interface SendTransactionOptions {
  skipPreflight?: boolean;
  maxRetries?: number;
}

/**
 * Опции подтверждения транзакции
 */
export interface ConfirmTransactionOptions {
  commitment?: 'confirmed' | 'finalized';
  timeoutMs?: number;
}

// ============================================================================
// Jupiter Price Service типы
// ============================================================================

/**
 * Детали цены токена от Jupiter
 */
export interface JupiterPriceDetails {
  price: number;
  id: string;
  type: string;
}

// ============================================================================
// PumpFun Price Service типы
// ============================================================================

/**
 * Данные о токене с Pump.fun
 */
export interface PumpFunTokenData {
  mint: string;
  name: string;
  symbol: string;
  complete: boolean;
  virtual_sol_reserves: number;
  virtual_token_reserves: number;
  market_cap: number;
  raydium_pool: string | null;
  bonding_curve: string;
  created_at: string;
}

/**
 * Статус токена
 */
export interface TokenStatus {
  exists: boolean;
  onBondingCurve: boolean;
  migrated: boolean;
  raydiumPool: string | null;
  marketCap: number;
}

// ============================================================================
// Jupiter Swap Service типы
// ============================================================================

/**
 * Параметры для получения quote
 */
export interface QuoteParams {
  inputMint: string;
  outputMint: string;
  amount: number; // в минимальных единицах (lamports для SOL)
  slippageBps?: number; // basis points (100 = 1%)
  onlyDirectRoutes?: boolean;
  asLegacyTransaction?: boolean;
}

/**
 * Информация о маршруте swap
 */
export interface RouteInfo {
  routePlanLength: number;
  priceImpactPct: number;
  contextSlot: number;
  timeTaken: number;
}

/**
 * Параметры для построения swap транзакции
 */
export interface BuildSwapParams {
  quoteResponse: any;
  userPublicKey: PublicKey;
  wrapAndUnwrapSol?: boolean;
  dynamicComputeUnitLimit?: boolean;
  prioritizationFeeLamports?: number;
}

/**
 * Параметры для создания полной swap транзакции
 */
export interface CreateSwapParams {
  inputMint: string;
  outputMint: string;
  amount: number;
  userWallet: any;
  slippage?: number; // 0-1 (например, 0.01 = 1%)
  priorityFeeLamports?: number;
}

// ============================================================================
// PumpFun Swap Service типы
// ============================================================================

/**
 * Параметры для создания buy транзакции
 */
export interface CreateBuyParams {
  tokenMint: string;
  amountSOL: number; // в SOL
  userWallet: any;
  slippage?: number;
}

/**
 * Параметры для создания sell транзакции
 */
export interface CreateSellParams {
  tokenMint: string;
  tokenAmount: number; // количество токенов
  userWallet: any;
  slippage?: number;
}

// ============================================================================
// Unified Price Service типы
// ============================================================================

/**
 * Результат получения цены
 */
export interface PriceResult {
  price: number;
  source: 'JUPITER' | 'PUMP_FUN';
  tokenType: 'DEX_POOL' | 'BONDING_CURVE';
}

/**
 * Тип токена
 */
export type TokenType = 'DEX_POOL' | 'BONDING_CURVE';

/**
 * Детальная информация о цене
 */
export interface PriceDetails extends PriceResult {
  tokenMint: string;
  timestamp: number;
  marketCap?: number;
  migrationProgress?: number;
}

/**
 * Информация о кэше
 */
export interface CacheInfo {
  jupiterCacheSize: number;
  pumpFunCacheSize: number;
  totalCacheSize: number;
}

// ============================================================================
// Price Monitor типы
// ============================================================================

/**
 * Callback для обновления цены
 */
export type PriceUpdateCallback = (mint: string, price: number, source: string) => void;

/**
 * Статистика кэша PriceMonitor
 */
export interface PriceMonitorCacheStats {
  size: number;
  entries: Array<{
    mint: string;
    age: number;
    source: string;
  }>;
}

/**
 * Информация о кэшах PriceMonitor
 */
export interface PriceMonitorCacheInfo {
  monitorCacheSize: number;
  unifiedCacheInfo: CacheInfo;
}

// ============================================================================
// Alchemy RPC Service типы
// ============================================================================

/**
 * Информация о blockhash
 */
export interface BlockhashInfo {
  blockhash: string;
  lastValidBlockHeight: number;
}

// ============================================================================
// Общие типы
// ============================================================================

/**
 * Результат операции с токеном
 */
export interface TokenOperationResult {
  success: boolean;
  signature?: string;
  error?: string;
}

/**
 * Информация о транзакции
 */
export interface TransactionInfo {
  signature: string;
  timestamp: number;
  status: 'pending' | 'confirmed' | 'failed';
  error?: string;
}

/**
 * Конфигурация кэша
 */
export interface CacheConfig {
  ttl: number; // время жизни в миллисекундах
  maxSize?: number; // максимальный размер кэша
}

/**
 * Метрики производительности
 */
export interface PerformanceMetrics {
  requestCount: number;
  successCount: number;
  failureCount: number;
  averageResponseTime: number;
  cacheHitRate: number;
}
