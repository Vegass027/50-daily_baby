import { Keypair, Transaction, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { LimitOrder, OrderType } from './ILimitOrderManager';
import { UnifiedValidator } from '../../utils/UnifiedValidator';
import { JupiterStrategy } from '../strategies/solana/JupiterStrategy';
import { PumpFunStrategy } from '../strategies/solana/PumpFunStrategy';
import { ITransactionSubmitter, SimulationResult } from '../../interfaces/ITransactionSubmitter';
import { SwapParams } from '../router/ITradingStrategy';
import { UserSettings } from '../router/ITradingStrategy';
import { JitoBundle } from '../../utils/JitoBundle';
import { JitoTipCalculator } from '../../utils/JitoTipCalculator';
import { getMetricsCollector } from '../../utils/MetricsCollector';
import { getTelegramNotifier, AlertLevel } from '../../utils/TelegramNotifier';

export interface ExecutionResult {
  success: boolean;
  signature?: string;
  filledPrice?: number;
  receivedAmount?: number;
  jitoTip?: number;
  error?: string;
}

/**
 * Исполнитель лимитных ордеров
 * Отвечает за исполнение ордеров через Jupiter/PumpFun стратегии
 */
export class OrderExecutor {
  private jupiterStrategy: JupiterStrategy;
  private pumpFunStrategy: PumpFunStrategy;
  private transactionSubmitter: ITransactionSubmitter;
  private wallet: Keypair;
  private userSettings: UserSettings;
  private jitoBundle: JitoBundle;
  private metricsCollector = getMetricsCollector();
  private telegramNotifier = getTelegramNotifier();
  
  constructor(
    jupiterStrategy: JupiterStrategy,
    pumpFunStrategy: PumpFunStrategy,
    transactionSubmitter: ITransactionSubmitter,
    wallet: Keypair,
    userSettings: UserSettings,
    jitoAuthKeypair: Keypair | null = null
  ) {
    this.jupiterStrategy = jupiterStrategy;
    this.pumpFunStrategy = pumpFunStrategy;
    this.transactionSubmitter = transactionSubmitter;
    this.wallet = wallet;
    this.userSettings = userSettings;
    
    // Инициализируем JitoBundle если указан auth keypair и включена MEV защита
    this.jitoBundle = new JitoBundle(
      transactionSubmitter.getConnection(),
      jitoAuthKeypair,
      userSettings.mevProtection && !!jitoAuthKeypair
    );
  }
  
  /**
   * Retry с exponential backoff
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: Error | undefined;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;
        console.warn(`   ⚠️ Attempt ${attempt}/${maxRetries} failed: ${error}`);
        
        // Если это последняя попытка, выбрасываем ошибку
        if (attempt === maxRetries) {
          throw lastError;
        }
        
        // Exponential backoff: 1s, 2s, 4s
        const delay = baseDelay * Math.pow(2, attempt - 1);
        console.log(`   ⏳ Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    
    throw lastError!;
  }

  /**
   * Исполнить лимитный ордер
   */
  async executeOrder(order: LimitOrder, tokenType: 'DEX_POOL' | 'BONDING_CURVE'): Promise<ExecutionResult> {
    console.log(`   🎯 Executing order ${order.id}...`);
    console.log(`      Type: ${order.params.orderType}, Amount: ${order.params.amount}`);
    console.log(`      Target Price: ${order.params.price} SOL`);
    console.log(`      Token Type: ${tokenType}`);
    console.log(`      MEV Protection: ${this.userSettings.mevProtection ? 'ON' : 'OFF'}`);
    
    // Замеряем время начала исполнения для метрик
    const startTime = Date.now();
    let priceImpact: number | undefined;
    
    // Шаг 5: Расчет tip если используется Jito
    let tipLamports = 0;
    
    try {
      // Шаг 1: Финальная валидация цены
      const isValid = await UnifiedValidator.validatePriceBeforeExecution(
        order,
        order.currentPrice || 0
      );
      
      if (!isValid) {
        throw new Error('Price moved away, skipping execution');
      }
      
      console.log(`   ✅ Price validation passed`);
      
      // Шаг 2: Выбор стратегии и построение транзакции
      const strategy = tokenType === 'DEX_POOL' ? this.jupiterStrategy : this.pumpFunStrategy;
      
      // Шаг 3: Получаем quote перед исполнением
      const swapParams = this.buildSwapParams(order);
      const quote = await strategy.getQuote(swapParams);
      
      console.log(`   📊 Quote received:`);
      console.log(`      Input: ${quote.inputAmount}`);
      console.log(`      Output: ${quote.outputAmount}`);
      console.log(`      Price Impact: ${quote.priceImpact.toFixed(2)}%`);
      console.log(`      Route: ${quote.route}`);
      
      // Сохраняем price impact для метрик
      priceImpact = quote.priceImpact;
      
      // Шаг 4: Проверка price impact
      if (quote.priceImpact > 10) { // 10% максимальный price impact
        throw new Error(`Price impact too high: ${quote.priceImpact.toFixed(2)}%`);
      }
      
      try {
        if (this.userSettings.mevProtection) {
          const amountInLamports = order.params.amount;
          
          // Используем новую функцию с учетом network congestion
          tipLamports = await JitoTipCalculator.calculateOptimalTipWithCongestion(
            amountInLamports,
            this.transactionSubmitter.getConnection(),
            {
              isBondingCurve: tokenType === 'BONDING_CURVE',
              isVolatile: true, // Для лимитных ордеров считаем волатильными
              customMultiplier: this.userSettings.jitoTipMultiplier
            }
          );
          
          console.log(`   💰 Jito tip: ${tipLamports} lamports (with congestion adjustment)`);
        } else {
          console.log(`   💰 Jito tip: 0 lamports (MEV protection disabled)`);
        }
      } catch (tipError) {
        console.warn(`   ⚠️ Failed to calculate Jito tip, using default: ${tipError}`);
        // Используем дефолтный tip если MEV защита включена
        if (this.userSettings.mevProtection) {
          tipLamports = 1000; // Минимальный tip
          console.log(`   💰 Using fallback Jito tip: ${tipLamports} lamports`);
        }
      }
      
      // Шаг 6: Построение транзакции через стратегию
      console.log(`   🏗️ Building transaction via ${strategy.constructor.name}...`);
      const transaction = await strategy.buildTransaction(swapParams);

      if (!transaction) {
        throw new Error('Failed to build transaction from strategy');
      }

      // Шаг 7: Отправка транзакции через JitoBundle (который сам решает, как отправить)
      // Передаем wallet как signer для подписи внутри JitoBundle
      const signature = await this.jitoBundle.sendBundle([transaction], {
        tipLamports,
        skipPreflight: this.userSettings.skipPreflight,
      }, this.wallet);

      console.log(`   ✅ Transaction sent: ${signature.slice(0, 8)}...`);

      // Шаг 8: Подтверждение транзакции (также через JitoBundle)
      const confirmed = await this.jitoBundle.confirmTransaction(signature, 'confirmed');

      if (!confirmed) {
        throw new Error('Transaction confirmation timeout');
      }

      console.log(`   ✅ Transaction confirmed`);
      
      // Шаг 8: Получаем полученное количество токенов
      const receivedAmount = await this.getReceivedTokensFromTx(signature, order.params.tokenMint);
      
      // Рассчитываем реальную цену исполнения
      const filledPrice = this.calculateFilledPrice(order, receivedAmount);
      
      // Рассчитываем время исполнения
      const duration = Date.now() - startTime;
      
      // Записываем метрики успешного ордера
      await this.metricsCollector.recordOrderExecution(
        order.id,
        duration,
        true,
        tipLamports,
        receivedAmount || 0,
        priceImpact
      );
      
      return {
        success: true,
        signature,
        filledPrice,
        receivedAmount,
        jitoTip: tipLamports
      };
    } catch (error) {
      console.error(`   ❌ Failed to execute order ${order.id}:`, error);
      
      // Рассчитываем время исполнения (даже при ошибке)
      const duration = Date.now() - startTime;
      
      // Записываем метрики неудачного ордера
      await this.metricsCollector.recordOrderExecution(
        order.id,
        duration,
        false,
        tipLamports,
        0,
        priceImpact,
        String(error)
      );
      
      // Бросаем исключение для retry логики
      throw error;
    }
  }

  /**
   * Исполнить лимитный ордер с retry
   */
  async executeOrderWithRetry(
    order: LimitOrder,
    tokenType: 'DEX_POOL' | 'BONDING_CURVE',
    maxRetries: number = 3
  ): Promise<ExecutionResult> {
    return this.retryWithBackoff(
      () => this.executeOrder(order, tokenType),
      maxRetries,
      1000
    );
  }
  
  /**
   * Построить параметры swap для стратегии
   */
  private buildSwapParams(order: LimitOrder): SwapParams {
    return {
      tokenIn: order.params.orderType === OrderType.BUY
        ? 'So11111111111111111111111111111111111111111112' // SOL
        : order.params.tokenMint,
      tokenOut: order.params.orderType === OrderType.BUY
        ? order.params.tokenMint
        : 'So11111111111111111111111111111111111111111112', // SOL
      amount: order.params.amount,
      slippage: order.params.slippage || this.userSettings.slippage,
      userWallet: this.wallet
    };
  }
  
  /**
   * Рассчитать цену исполнения
   */
  private calculateFilledPrice(order: LimitOrder, receivedAmount: number): number {
    if (order.params.orderType === OrderType.BUY) {
      // Для buy: SOL / токены (SOL за 1 токен)
      return order.params.amount / receivedAmount;
    } else {
      // Для sell: SOL / токены (SOL за 1 токен)
      // order.params.amount = количество токенов на продажу
      // receivedAmount = полученные SOL
      return receivedAmount / order.params.amount;
    }
  }
  
  /**
   * Получить полученное количество токенов из транзакции
   */
  async getReceivedTokensFromTx(signature: string, tokenMint: string): Promise<number> {
    try {
      const connection = this.transactionSubmitter.getConnection();
      const tx = await connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0
      });
      
      if (!tx) {
        throw new Error('Transaction not found');
      }
      
      // Проверяем, что транзакция выполнена успешно
      if (tx.meta?.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(tx.meta.err)}`);
      }
      
      // Проверяем наличие meta
      if (!tx.meta) {
        throw new Error('Transaction metadata not available');
      }
      
      // Поиск token balance change
      const postTokenBalances = tx.meta.postTokenBalances || [];
      const preTokenBalances = tx.meta.preTokenBalances || [];
      
      const postBalance = postTokenBalances.find((b: any) => b.mint === tokenMint);
      const preBalance = preTokenBalances.find((b: any) => b.mint === tokenMint);
      
      if (!postBalance) {
        throw new Error('Token balance not found in transaction');
      }
      
      const postAmount = postBalance.uiTokenAmount?.uiAmount || 0;
      const preAmount = preBalance?.uiTokenAmount?.uiAmount || 0;
      const received = postAmount - preAmount;
      
      console.log(`   📊 Token balance change: ${preAmount} -> ${postAmount} (${received} tokens)`);
      
      return received;
    } catch (error) {
      console.error('Error getting received tokens:', error);
      throw error;
    }
  }
  
  /**
   * Симулировать исполнение ордера
   */
  async simulateExecution(order: LimitOrder, tokenType: 'DEX_POOL' | 'BONDING_CURVE'): Promise<SimulationResult> {
    try {
      console.log(`   🔍 Simulating execution for order ${order.id}...`);
      
      const strategy = tokenType === 'DEX_POOL' ? this.jupiterStrategy : this.pumpFunStrategy;
      const swapParams = this.buildSwapParams(order);
      
      // Получаем quote
      const quote = await strategy.getQuote(swapParams);
      
      // Проверяем price impact
      if (quote.priceImpact > 10) {
        return {
          success: false,
          error: `Price impact too high: ${quote.priceImpact.toFixed(2)}%`
        };
      }
      
      console.log(`   ✅ Simulation successful`);
      console.log(`      Expected output: ${quote.outputAmount}`);
      console.log(`      Price impact: ${quote.priceImpact.toFixed(2)}%`);
      
      return {
        success: true,
        error: undefined
      };
    } catch (error) {
      console.error(`   ❌ Simulation failed:`, error);
      return {
        success: false,
        error: String(error)
      };
    }
  }
  
  /**
   * Получить connection
   */
  getConnection(): Connection {
    return this.transactionSubmitter.getConnection();
  }
  
  /**
   * Переключить режим MEV защиты
   * @param useJito Включить/выключить MEV защиту
   */
  setMevProtection(useJito: boolean): void {
    this.jitoBundle.setUseJito(useJito);
    this.userSettings.mevProtection = useJito;
  }
  
  /**
   * Симулировать транзакцию
   * @param transaction Транзакция для симуляции
   * @returns Результат симуляции
   */
  async simulateTransaction(transaction: Transaction): Promise<SimulationResult> {
    try {
      console.log(`   🔍 Simulating transaction...`);

      const connection = this.transactionSubmitter.getConnection();
      const simulation = await connection.simulateTransaction(transaction, [this.wallet]);

      if (simulation.value.err) {
        return {
          success: false,
          error: JSON.stringify(simulation.value.err),
          logs: simulation.value.logs || undefined
        };
      }

      console.log(`   ✅ Simulation successful`);

      return {
        success: true,
        logs: simulation.value.logs || undefined
      };
    } catch (error) {
      console.error(`   ❌ Simulation failed:`, error);
      return {
        success: false,
        error: String(error)
      };
    }
  }

  /**
   * Отправить транзакцию
   * @param transaction Транзакция для отправки
   * @param options Опции отправки
   * @returns Подпись транзакции
   */
  async sendTransaction(
    transaction: Transaction,
    options?: {
      priorityFee?: number;
      jitoTip?: number;
    }
  ): Promise<string> {
    try {
      // Если указан Jito tip, используем Jito bundle
      if (options?.jitoTip && options.jitoTip > 0) {
        console.log(`   🛡️ Sending via Jito bundle (tip: ${options.jitoTip} lamports)`);
        return await this.jitoBundle.sendBundle([transaction], {
          tipLamports: options.jitoTip
        }, this.wallet);
      }

      // Обычная отправка - подписываем транзакцию здесь
      console.log(`   ✍️ Signing transaction for standard RPC...`);
      transaction.sign(this.wallet);
      
      console.log(`   📤 Sending transaction...`);
      const signature = await this.transactionSubmitter.sendTransaction(transaction);
      console.log(`   ✅ Transaction sent: ${signature.slice(0, 8)}...`);
      return signature;
    } catch (error) {
      console.error(`   ❌ Failed to send transaction:`, error);
      throw error;
    }
  }

  /**
   * Подтвердить транзакцию
   * @param signature Подпись транзакции
   * @param commitment Уровень подтверждения
   * @returns true если подтверждена
   */
  async confirmTransaction(
    signature: string,
    commitment: 'confirmed' | 'finalized' = 'confirmed'
  ): Promise<boolean> {
    try {
      console.log(`   ⏳ Waiting for confirmation (${commitment})...`);
      const confirmed = await this.jitoBundle.confirmTransaction(signature, commitment);

      if (confirmed) {
        console.log(`   ✅ Transaction confirmed`);
      }

      return confirmed;
    } catch (error) {
      console.error(`   ❌ Confirmation failed:`, error);
      return false;
    }
  }

  /**
   * Получить JitoBundle
   * @returns JitoBundle
   */
  getJitoBundle(): JitoBundle {
    return this.jitoBundle;
  }

  /**
   * Проверить критические ситуации и отправить алерты
   */
  async checkAndSendAlerts(): Promise<void> {
    const alerts = this.metricsCollector.checkCriticalSituations();
    
    for (const alert of alerts) {
      await this.telegramNotifier.sendAlert({
        level: AlertLevel.WARNING,
        title: 'Order Execution Alert',
        message: alert,
        timestamp: Date.now()
      });
    }
  }
}
