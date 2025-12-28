import { Transaction } from '@solana/web3.js';
import { IChainProvider } from '../../chains/IChainProvider';

export interface QuoteResult {
  inputAmount: number;
  outputAmount: number;
  priceImpact: number;
  fee: number;
  route?: string;
}

export interface SwapParams {
  tokenIn: string;
  tokenOut: string;
  amount: number;
  slippage: number;
  userWallet: any;
}

export interface UserSettings {
  slippage: number;
  mevProtection: boolean;
  speedStrategy: 'low' | 'normal' | 'aggressive';
  useJito?: boolean; // Использовать Jito для MEV защиты
  jitoTipMultiplier?: number; // Множитель Jito tip (1.0 = стандартный)
  priorityFee?: number; // Priority fee в микролампортах
  skipPreflight?: boolean; // Пропустить preflight симуляцию
}

export interface ITradingStrategy {
  name: string;
  chain: string;
  dex: string;
  priority: number; // ⭐ Чем БОЛЬШЕ, тем ВЫШЕ приоритет
  chainProvider: IChainProvider;

  canTrade(tokenMint: string): Promise<boolean>;
  getQuote(params: SwapParams): Promise<QuoteResult>;
  executeSwap(params: SwapParams, settings: UserSettings): Promise<string>;
  buildTransaction(params: SwapParams): Promise<Transaction>;
  supportsLimitOrders(): boolean;
}