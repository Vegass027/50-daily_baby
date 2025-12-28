import { Keypair, Transaction, Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { JupiterStrategy } from '../strategies/solana/JupiterStrategy.js';
import { PumpFunStrategy } from '../strategies/solana/PumpFunStrategy.js';
import { OrderExecutor } from './OrderExecutor.js';
import { TokenTypeDetector } from './TokenTypeDetector.js';
import { UnifiedPriceService, TokenType } from '../../services/UnifiedPriceService.js';
import { PositionManager, type Position } from './PositionManager.js';
import { DatabaseLimitOrderManager } from './DatabaseLimitOrderManager.js';
import { SwapParams, UserSettings } from '../router/ITradingStrategy.js';
import { JitoTipCalculator } from '../../utils/JitoTipCalculator.js';
import { SimulationResult } from '../../interfaces/ITransactionSubmitter.js';
import { OrderType } from './ILimitOrderManager.js';
import { getMetricsCollector } from '../../utils/MetricsCollector.js';

/**
 * Результат market buy операции
 */
export interface MarketBuyResult {
  success: boolean;
  signature?: string;
  position?: Position;
  receivedTokens?: number;
  entryPrice?: number;
  takeProfitOrderId?: string;
  error?: string;
}

/**
 * Результат market sell операции
 */
export interface MarketSellResult {
  success: boolean;
  signature?: string;
  exitPrice?: number;
  pnl?: PnLResult;
  error?: string;
}

/**
 * Результат расчета P&L
 */
export interface PnLResult {
  pnlSOL: number;
  pnlPercent: number;
  pnlUSD: number;
}

/**
 * Менеджер market orders
 * Исполняет немедленные buy/sell операции без мониторинга цены
 */
export class MarketOrderManager {
  private jupiterStrategy: JupiterStrategy;
  private pumpFunStrategy: PumpFunStrategy;
  private orderExecutor: OrderExecutor;
  private tokenTypeDetector: TokenTypeDetector;
  private unifiedPriceService: UnifiedPriceService;
  private positionManager: PositionManager;
  private wallet: Keypair;
  private userSettings: UserSettings;
  private connection: Connection;
  private limitOrderManager?: DatabaseLimitOrderManager;
  private userId: number;
  private metricsCollector = getMetricsCollector();

  constructor(
    jupiterStrategy: JupiterStrategy,
    pumpFunStrategy: PumpFunStrategy,
    orderExecutor: OrderExecutor,
    tokenTypeDetector: TokenTypeDetector,
    unifiedPriceService: UnifiedPriceService,
    positionManager: PositionManager,
    wallet: Keypair,
    userSettings: UserSettings,
    userId: number,
    limitOrderManager?: DatabaseLimitOrderManager
  ) {
    this.jupiterStrategy = jupiterStrategy;
    this.pumpFunStrategy = pumpFunStrategy;
    this.orderExecutor = orderExecutor;
    this.tokenTypeDetector = tokenTypeDetector;
    this.unifiedPriceService = unifiedPriceService;
    this.positionManager = positionManager;
    this.wallet = wallet;
    this.userSettings = userSettings;
    this.connection = orderExecutor.getConnection();
    this.limitOrderManager = limitOrderManager;
    this.userId = userId;
  }

  /**
   * Исполнить market buy (немедленная покупка)
   * @param tokenMint Адрес токена
   * @param amountSOL Количество SOL для покупки
   * @param options Дополнительные опции
   * @returns Результат операции
   */
  async executeMarketBuy(
    tokenMint: string,
    amountSOL: number,
    options?: {
      createTakeProfit?: boolean;
      takeProfitPrice?: number;
      slippage?: number;
    }
  ): Promise<MarketBuyResult> {
    console.log(`   💰 Executing market buy...`);
    console.log(`      Token: ${tokenMint.slice(0, 8)}...`);
    console.log(`      Amount: ${amountSOL} SOL`);

    // Замеряем время начала операции для метрик
    const startTime = Date.now();
    let jitoTip = 0;

    try {
      // Шаг 1: Определение типа токена
      const tokenType = await this.tokenTypeDetector.detectType(tokenMint);

      // Шаг 2: Получение текущей цены (для отображения)
      const currentPrice = await this.unifiedPriceService.getPrice(tokenMint);

      console.log(`      Current price: ${currentPrice.price.toFixed(8)} SOL/token`);
      console.log(`      Token type: ${tokenType}`);

      // Шаг 3: Валидация баланса
      await this.validateBalance(amountSOL);

      // Шаг 4: Построение транзакции
      const transaction = await this.buildBuyTransaction(
        tokenMint,
        amountSOL,
        tokenType,
        options?.slippage || this.userSettings.slippage
      );

      // Шаг 5: Симуляция
      const simResult = await this.orderExecutor.simulateTransaction(transaction);

      if (!simResult.success) {
        throw new Error(`Simulation failed: ${simResult.error}`);
      }

      console.log(`   ✅ Simulation successful`);

      // Шаг 6: Исполнение
      jitoTip = this.userSettings.mevProtection
        ? JitoTipCalculator.calculateTipByPriority(
            amountSOL * 1_000_000_000,
            'high'
          )
        : 0;

      const signature = await this.orderExecutor.sendTransaction(transaction, {
        priorityFee: 100000, // Высокий priority для быстроты
        jitoTip
      });

      console.log(`   ✅ Transaction sent: ${signature.slice(0, 8)}...`);

      // Шаг 7: Подтверждение
      const confirmed = await this.orderExecutor.confirmTransaction(signature);

      if (!confirmed) {
        throw new Error('Transaction confirmation timeout');
      }

      console.log(`   ✅ Transaction confirmed`);

      // Шаг 8: Расчет полученных токенов
      const receivedTokens = await this.orderExecutor.getReceivedTokensFromTx(
        signature,
        tokenMint
      );

      console.log(`      Received: ${receivedTokens.toFixed(2)} tokens`);

      // Шаг 9: Создание позиции
      const position = await this.positionManager.createPosition(this.userId, {
        tokenAddress: tokenMint,
        tokenType,
        entryPrice: currentPrice.price,
        size: receivedTokens,
        openTxSignature: signature,
        orderType: 'MARKET_BUY'
      });

      console.log(`   ✅ Position created: ${position.id}`);

      // Шаг 10: Создание take profit если нужно
      let takeProfitOrderId: string | undefined;
      if (options?.createTakeProfit && options.takeProfitPrice && this.limitOrderManager) {
        takeProfitOrderId = await this.createTakeProfitOrder(
          position,
          options.takeProfitPrice
        );

        console.log(`   ✅ Take profit order created: ${takeProfitOrderId}`);
      }

      // Рассчитываем время исполнения
      const duration = Date.now() - startTime;

      // Записываем метрики успешного market buy
      await this.metricsCollector.recordOrderExecution(
        `MARKET_BUY_${signature.slice(0, 8)}`,
        duration,
        true,
        jitoTip,
        receivedTokens || 0,
        undefined
      );

      return {
        success: true,
        signature,
        position,
        receivedTokens,
        entryPrice: currentPrice.price,
        takeProfitOrderId
      };
    } catch (error) {
      console.error(`   ❌ Market buy failed:`, error);

      // Рассчитываем время исполнения (даже при ошибке)
      const duration = Date.now() - startTime;

      // Записываем метрики неудачного market buy
      await this.metricsCollector.recordOrderExecution(
        `MARKET_BUY_FAILED_${Date.now()}`,
        duration,
        false,
        jitoTip,
        0,
        undefined,
        String(error)
      );

      return {
        success: false,
        error: String(error)
      };
    }
  }

  /**
   * Исполнить market sell (немедленная продажа позиции)
   * @param positionId ID позиции
   * @returns Результат операции
   */
  async executeMarketSell(
    positionId: string
  ): Promise<MarketSellResult> {
    console.log(`   💸 Executing market sell...`);
    console.log(`      Position: ${positionId}`);

    // Замеряем время начала операции для метрик
    const startTime = Date.now();
    let jitoTip = 0;

    try {
      // Шаг 1: Получение позиции
      const position = await this.positionManager.getPosition(positionId);

      if (!position) {
        throw new Error(`Position ${positionId} not found`);
      }

      if (position.status !== 'OPEN') {
        throw new Error(`Position is not open (status: ${position.status})`);
      }

      console.log(`      Token: ${position.tokenAddress.slice(0, 8)}...`);
      console.log(`      Size: ${position.size} tokens`);

      // Шаг 2: Получение текущей цены
      const currentPrice = await this.unifiedPriceService.getPrice(position.tokenAddress);

      // Шаг 3: Расчет P&L
      const pnl = this.calculatePnL(position, currentPrice.price);

      console.log(`      Current price: ${currentPrice.price.toFixed(8)} SOL/token`);
      console.log(`      P&L: ${pnl.pnlPercent.toFixed(2)}% (${pnl.pnlSOL.toFixed(6)} SOL)`);

      // Шаг 4: Отмена активных TP/SL ордеров
      await this.cancelLinkedOrders(positionId);

      // Шаг 5: Построение sell транзакции
      const transaction = await this.buildSellTransaction(
        position.tokenAddress,
        position.size,
        position.tokenType,
        this.userSettings.slippage
      );

      // Шаг 6: Симуляция
      const simResult = await this.orderExecutor.simulateTransaction(transaction);

      if (!simResult.success) {
        throw new Error(`Simulation failed: ${simResult.error}`);
      }

      console.log(`   ✅ Simulation successful`);

      // Шаг 7: Исполнение
      jitoTip = this.userSettings.mevProtection
        ? JitoTipCalculator.calculateTipByPriority(
            position.size * 1_000_000_000,
            'high'
          )
        : 0;

      const signature = await this.orderExecutor.sendTransaction(transaction, {
        priorityFee: 100000,
        jitoTip
      });

      console.log(`   ✅ Transaction sent: ${signature.slice(0, 8)}...`);

      // Шаг 8: Подтверждение
      const confirmed = await this.orderExecutor.confirmTransaction(signature);

      if (!confirmed) {
        throw new Error('Transaction confirmation timeout');
      }

      console.log(`   ✅ Transaction confirmed`);

      // Шаг 9: Закрытие позиции
      await this.positionManager.closePosition(positionId, {
        exitPrice: currentPrice.price,
        exitTxSignature: signature,
        realizedPnL: pnl.pnlSOL,
        realizedPnLPercent: pnl.pnlPercent
      });

      console.log(`   ✅ Position closed`);

      // Рассчитываем время исполнения
      const duration = Date.now() - startTime;

      // Записываем метрики успешного market sell
      await this.metricsCollector.recordOrderExecution(
        `MARKET_SELL_${signature.slice(0, 8)}`,
        duration,
        true,
        jitoTip,
        pnl.pnlSOL,
        undefined
      );

      return {
        success: true,
        signature,
        exitPrice: currentPrice.price,
        pnl
      };
    } catch (error) {
      console.error(`   ❌ Market sell failed:`, error);

      // Рассчитываем время исполнения (даже при ошибке)
      const duration = Date.now() - startTime;

      // Записываем метрики неудачного market sell
      await this.metricsCollector.recordOrderExecution(
        `MARKET_SELL_FAILED_${Date.now()}`,
        duration,
        false,
        jitoTip,
        0,
        undefined,
        String(error)
      );

      return {
        success: false,
        error: String(error)
      };
    }
  }

  /**
   * Построить buy транзакцию
   * @param tokenMint Адрес токена
   * @param amountSOL Количество SOL
   * @param tokenType Тип токена
   * @param slippage Проскальзывание
   * @returns Транзакция
   */
  private async buildBuyTransaction(
    tokenMint: string,
    amountSOL: number,
    tokenType: TokenType,
    slippage: number
  ): Promise<Transaction> {
    const params: SwapParams = {
      tokenIn: 'So11111111111111111111111111111111111111112', // SOL
      tokenOut: tokenMint,
      amount: amountSOL * 1_000_000_000, // SOL в lamports
      slippage,
      userWallet: this.wallet
    };

    if (tokenType === 'DEX_POOL') {
      return await this.jupiterStrategy.buildTransaction(params);
    } else {
      return await this.pumpFunStrategy.buildTransaction(params);
    }
  }

  /**
   * Построить sell транзакцию
   * @param tokenMint Адрес токена
   * @param tokenAmount Количество токенов
   * @param tokenType Тип токена
   * @param slippage Проскальзывание
   * @returns Транзакция
   */
  private async buildSellTransaction(
    tokenMint: string,
    tokenAmount: number,
    tokenType: TokenType,
    slippage: number
  ): Promise<Transaction> {
    const params: SwapParams = {
      tokenIn: tokenMint,
      tokenOut: 'So11111111111111111111111111111111111111112', // SOL
      amount: Math.floor(tokenAmount), // Токены (округляем)
      slippage,
      userWallet: this.wallet
    };

    if (tokenType === 'DEX_POOL') {
      return await this.jupiterStrategy.buildTransaction(params);
    } else {
      return await this.pumpFunStrategy.buildTransaction(params);
    }
  }

  /**
   * Создать take profit order
   * @param position Позиция
   * @param takeProfitPrice Цена take profit
   * @returns ID ордера
   */
  private async createTakeProfitOrder(
    position: Position,
    takeProfitPrice: number
  ): Promise<string> {
    if (!this.limitOrderManager) {
      throw new Error('LimitOrderManager not initialized');
    }

    const orderId = await this.limitOrderManager.createOrder({
      userId: Number(position.userId),
      tokenMint: position.tokenAddress,
      orderType: OrderType.SELL,
      price: takeProfitPrice,
      amount: position.size,
      slippage: this.userSettings.slippage,
      linkedPositionId: position.id
    });

    return orderId;
  }

  /**
   * Отменить связанные ордера (TP/SL)
   * @param positionId ID позиции
   */
  private async cancelLinkedOrders(positionId: string): Promise<void> {
    if (!this.limitOrderManager) {
      console.log(`   🗑️ No LimitOrderManager initialized, skipping order cancellation`);
      return;
    }

    console.log(`   🗑️ Cancelling linked orders for position ${positionId}`);

    // Получаем все активные ордера для этой позиции
    const orders = await this.limitOrderManager.getOrdersByPosition(positionId);

    // Отменяем каждый ордер
    for (const order of orders) {
      try {
        await this.limitOrderManager.cancelOrder(order.id);
        console.log(`      Cancelled order ${order.id}`);
      } catch (error) {
        console.error(`      Failed to cancel order ${order.id}:`, error);
      }
    }
  }

  /**
   * Валидировать баланс
   * @param amountSOL Количество SOL
   */
  private async validateBalance(amountSOL: number): Promise<void> {
    const balance = await this.connection.getBalance(this.wallet.publicKey);

    // Оставляем минимум 0.01 SOL для fees
    const requiredBalance = amountSOL * 1_000_000_000 + 10_000_000;

    if (balance < requiredBalance) {
      throw new Error(
        `Insufficient SOL balance. Required: ${(requiredBalance / 1_000_000_000).toFixed(4)} SOL, Available: ${(balance / 1_000_000_000).toFixed(4)} SOL`
      );
    }
  }

  /**
   * Рассчитать P&L
   * @param position Позиция
   * @param currentPrice Текущая цена
   * @returns Результат P&L
   */
  private calculatePnL(position: Position, currentPrice: number): PnLResult {
    const entryPrice = position.entryPrice;
    const size = position.size;

    // P&L в SOL: (текущая цена - цена входа) * количество токенов
    const pnlSOL = (currentPrice - entryPrice) * size;

    // P&L в %
    const pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;

    // P&L в USD (предполагаем 1 SOL = 150 USD)
    // TODO: Получать актуальный курс SOL/USD из API
    const SOL_USD_PRICE = 150;
    const pnlUSD = pnlSOL * SOL_USD_PRICE;

    return {
      pnlSOL,
      pnlPercent,
      pnlUSD
    };
  }
}
