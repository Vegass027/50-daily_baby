import { Keypair } from '@solana/web3.js';
import {
  LimitOrder,
  LimitOrderParams,
  OrderType,
  OrderFilledCallback
} from './ILimitOrderManager';
import { JupiterStrategy } from '../strategies/solana/JupiterStrategy';
import { UserSettings } from '../router/ITradingStrategy';
import { BaseLimitOrderManager } from './BaseLimitOrderManager';
import { ExecutionResult } from './OrderExecutor';

/**
 * Менеджер лимитных ордеров для Jupiter
 * Наследует общую логику от BaseLimitOrderManager
 * Использует Jupiter Limit Order Program для нативных лимитных ордеров
 */
export class JupiterLimitOrderManager extends BaseLimitOrderManager {
  name = 'Jupiter Limit Orders';
  dex = 'Jupiter';

  private jupiterStrategy: JupiterStrategy;

  constructor(
    jupiterStrategy: JupiterStrategy,
    wallet: Keypair,
    userSettings: UserSettings,
    dataDir: string = './data'
  ) {
    super(wallet, userSettings, dataDir, 'jupiter_limit_orders.json');
    this.jupiterStrategy = jupiterStrategy;
  }

  /**
   * Получить тип токена для Jupiter (всегда DEX_POOL)
   */
  protected getTokenType(): 'DEX_POOL' | 'BONDING_CURVE' {
    return 'DEX_POOL';
  }

  /**
   * Получить текущую цену токена через Jupiter
   */
  protected async getCurrentPrice(tokenMint: string): Promise<number> {
    try {
      const SOL_MINT = 'So11111111111111111111111111111111111111111112';
      
      const quote = await this.jupiterStrategy.getQuote({
        tokenIn: SOL_MINT,
        tokenOut: tokenMint,
        amount: 1_000_000_000, // 1 SOL в lamports
        slippage: 1.0,
        userWallet: this.wallet,
      });

      // Рассчитываем цену: SOL / токены
      const price = 1_000_000_000 / quote.outputAmount; // SOL за 1 токен
      
      return price;
    } catch (error) {
      console.error(`   ❌ Error getting price for ${tokenMint}:`, error);
      throw new Error(`Failed to get price for ${tokenMint}: ${error}`);
    }
  }

  /**
   * Исполнить ордер с retry
   */
  protected async executeOrderWithRetry(order: LimitOrder): Promise<ExecutionResult> {
    // Если есть OrderExecutor, используем его с retry
    if (this.orderExecutor) {
      return await this.orderExecutor.executeOrderWithRetry(order, 'DEX_POOL', 3);
    }
    
    // Fallback на старый метод без retry (для совместимости)
    const params = {
      tokenIn: order.params.orderType === OrderType.BUY
        ? 'So11111111111111111111111111111111111111111112'
        : order.params.tokenMint,
      tokenOut: order.params.orderType === OrderType.BUY
        ? order.params.tokenMint
        : 'So11111111111111111111111111111111111111111112',
      amount: order.params.amount,
      slippage: order.params.slippage || this.userSettings.slippage,
      userWallet: this.wallet,
    };

    try {
      const signature = await this.jupiterStrategy.executeSwap(params, this.userSettings);
      return {
        success: true,
        signature
      };
    } catch (error) {
      return {
        success: false,
        error: String(error)
      };
    }
  }
}
