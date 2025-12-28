import { Keypair } from '@solana/web3.js';
import {
  LimitOrder,
  LimitOrderParams,
  OrderType,
  OrderStatus,
  OrderFilledCallback
} from './ILimitOrderManager';
import { PumpFunStrategy } from '../strategies/solana/PumpFunStrategy';
import { PriceMonitor } from './PriceMonitor';
import { UserSettings } from '../router/ITradingStrategy';
import { BaseLimitOrderManager } from './BaseLimitOrderManager';
import { ExecutionResult } from './OrderExecutor';

/**
 * Менеджер виртуальных лимитных ордеров для PumpFun
 * Наследует общую логику от BaseLimitOrderManager
 * Использует мониторинг цен и авто-исполнение ордеров
 */
export class PumpFunLimitOrderManager extends BaseLimitOrderManager {
  name = 'PumpFun Limit Orders';
  dex = 'PumpFun';

  private pumpFunStrategy: PumpFunStrategy;
  private priceMonitor: PriceMonitor;

  constructor(
    pumpFunStrategy: PumpFunStrategy,
    priceMonitor: PriceMonitor,
    wallet: Keypair,
    userSettings: UserSettings,
    dataDir: string = './data'
  ) {
    super(wallet, userSettings, dataDir, 'limit_orders.json');
    this.pumpFunStrategy = pumpFunStrategy;
    this.priceMonitor = priceMonitor;
  }

  /**
   * Переопределяем createOrder для добавления мониторинга цены
   */
  async createOrder(params: LimitOrderParams): Promise<string> {
    // Вызываем родительский метод для создания ордера
    const orderId = await super.createOrder(params);
    
    // Запускаем мониторинг цены токена в реальном времени
    this.priceMonitor.startMonitoring(
      [params.tokenMint],
      (mint, price) => {
        console.log(`   💹 Price updated for ${params.tokenMint.slice(0, 8)}...: ${price.toFixed(8)} SOL`);
      },
      {
        dexInterval: 10000 // 10 секунд (быстрее!)
      }
    );
    
    console.log(`   📊 Started real-time price monitoring for ${params.tokenMint.slice(0, 8)}...`);
    
    return orderId;
  }

  /**
   * Получить тип токена для PumpFun (всегда BONDING_CURVE)
   */
  protected getTokenType(): 'DEX_POOL' | 'BONDING_CURVE' {
    return 'BONDING_CURVE';
  }

  /**
   * Получить текущую цену токена через PriceMonitor
   */
  protected async getCurrentPrice(tokenMint: string): Promise<number> {
    return await this.priceMonitor.getCurrentPrice(tokenMint);
  }

  /**
   * Исполнить ордер с retry
   */
  protected async executeOrderWithRetry(order: LimitOrder): Promise<ExecutionResult> {
    // Если есть OrderExecutor, используем его с retry
    if (this.orderExecutor) {
      return await this.orderExecutor.executeOrderWithRetry(order, 'BONDING_CURVE', 3);
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
      const signature = await this.pumpFunStrategy.executeSwap(params, this.userSettings);
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
