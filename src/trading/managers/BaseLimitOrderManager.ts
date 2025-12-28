import * as fs from 'fs/promises';
import * as path from 'path';
import { Keypair } from '@solana/web3.js';
import {
  ILimitOrderManager,
  LimitOrder,
  LimitOrderParams,
  OrderStatus,
  OrderType,
  OrderFilledCallback
} from './ILimitOrderManager';
import { UnifiedValidator } from '../../utils/UnifiedValidator';
import { OrderExecutor, ExecutionResult } from './OrderExecutor';
import { UserSettings } from '../router/ITradingStrategy';
import { getConcurrencyManager } from '../../utils/ConcurrencyManager';

/**
 * Базовый класс для менеджеров лимитных ордеров
 * Содержит общую логику для Jupiter и PumpFun менеджеров
 */
export abstract class BaseLimitOrderManager implements ILimitOrderManager {
  public abstract name: string;
  public abstract dex: string;

  protected wallet: Keypair;
  protected userSettings: UserSettings;
  protected orders: Map<string, LimitOrder> = new Map();
  protected ordersFile: string;
  protected monitoringInterval: NodeJS.Timeout | null = null;
  protected readonly MONITORING_INTERVAL = 30000; // 30 секунд
  protected orderFilledCallback: OrderFilledCallback | null = null;
  protected orderExecutor: OrderExecutor | null = null;
  protected isMonitoring = false; // Защита от race condition
  protected concurrencyManager = getConcurrencyManager(); // Менеджер конкурентного доступа

  constructor(
    wallet: Keypair,
    userSettings: UserSettings,
    dataDir: string = './data',
    ordersFileName: string
  ) {
    this.wallet = wallet;
    this.userSettings = userSettings;
    this.ordersFile = path.join(dataDir, ordersFileName);
  }

  /**
   * Инициализация менеджера
   */
  async initialize(): Promise<void> {
    // Создаем директорию для данных если не существует
    const dataDir = path.dirname(this.ordersFile);
    try {
      await fs.mkdir(dataDir, { recursive: true });
    } catch (error) {
      console.warn('   ⚠️ Data directory already exists or cannot be created');
    }

    // Загружаем ордера из файла
    await this.loadOrders();
    
    console.log(`   ✅ ${this.name} initialized (${this.orders.size} orders loaded)`);
  }

  /**
   * Установить callback на заполнение ордера
   */
  public setOrderFilledCallback(callback: OrderFilledCallback): void {
    this.orderFilledCallback = callback;
  }

  /**
   * Установить OrderExecutor для исполнения ордеров
   */
  setOrderExecutor(orderExecutor: OrderExecutor): void {
    this.orderExecutor = orderExecutor;
  }

  /**
   * Создать лимитный ордер
   */
  async createOrder(params: LimitOrderParams): Promise<string> {
    // Используем блокировку для защиты от race conditions
    return await this.concurrencyManager.withLock(
      `order_create_${this.dex}`,
      async () => {
        // Валидация параметров через OrderValidator
        const validation = UnifiedValidator.validateLimitOrder(params);
        if (!validation.valid) {
          throw new Error(`Invalid order parameters: ${validation.errors.join(', ')}`);
        }
        
        const orderId = this.generateOrderId();
        
        const order: LimitOrder = {
          id: orderId,
          params,
          status: OrderStatus.PENDING,
          createdAt: Date.now(),
          tokenType: this.getTokenType()
        };

        this.orders.set(orderId, order);
        await this.saveOrders();

        console.log(`   ✅ ${this.dex} limit order created: ${orderId}`);
        console.log(`      Type: ${params.orderType}, Amount: ${params.amount}, Price: ${params.price} SOL`);
        
        return orderId;
      }
    );
  }

  /**
   * Отменить ордер
   */
  async cancelOrder(orderId: string): Promise<void> {
    // Используем блокировку для защиты от race conditions
    await this.concurrencyManager.withLock(
      `order_cancel_${orderId}`,
      async () => {
        const order = this.orders.get(orderId);
        
        if (!order) {
          throw new Error(`Order ${orderId} not found`);
        }

        if (order.status !== OrderStatus.PENDING) {
          throw new Error(`Cannot cancel order with status ${order.status}`);
        }

        // Отменяем связанные ордера
        if (order.relatedOrderId) {
          const relatedOrder = this.orders.get(order.relatedOrderId);
          if (relatedOrder && relatedOrder.status === OrderStatus.PENDING) {
            relatedOrder.status = OrderStatus.CANCELLED;
            console.log(`   ✅ Related order cancelled: ${order.relatedOrderId}`);
          }
        }

        order.status = OrderStatus.CANCELLED;
        await this.saveOrders();

        console.log(`   ✅ Order cancelled: ${orderId}`);
      }
    );
  }

  /**
   * Получить ордер по ID
   */
  async getOrder(orderId: string): Promise<LimitOrder | null> {
    return this.orders.get(orderId) || null;
  }

  /**
   * Получить все ордера
   */
  async getAllOrders(): Promise<LimitOrder[]> {
    return Array.from(this.orders.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Получить активные ордера
   */
  async getActiveOrders(): Promise<LimitOrder[]> {
    return Array.from(this.orders.values())
      .filter(order => order.status === OrderStatus.PENDING)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Мониторинг и исполнение ордеров
   */
  async monitorOrders(): Promise<void> {
    if (this.monitoringInterval) {
      console.log('   ⚠️ Monitoring already running');
      return;
    }

    console.log(`   🔄 Starting ${this.dex} limit order monitoring (interval: ${this.MONITORING_INTERVAL}ms)`);
    
    const monitor = async () => {
      if (this.isMonitoring) {
        console.log('   ⚠️ Previous monitoring cycle still running, skipping');
        return;
      }
      this.isMonitoring = true;
      try {
        await this.checkAndExecuteOrders();
      } finally {
        this.isMonitoring = false;
      }
    };
    
    await monitor(); // Первый запуск сразу
    this.monitoringInterval = setInterval(monitor, this.MONITORING_INTERVAL);
  }

  /**
   * Остановить мониторинг ордеров
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      this.isMonitoring = false;
      console.log(`   ⏹️ ${this.dex} limit order monitoring stopped`);
    }
  }

  /**
   * Получить статистику ордеров
   */
  async getStats(): Promise<Record<OrderStatus | 'total', number>> {
    // Используем блокировку для защиты от race conditions при чтении статистики
    return await this.concurrencyManager.withLock(
      `orders_stats_${this.dex}`,
      async () => {
        const orders = await this.getAllOrders();
        
        const stats: Record<OrderStatus | 'total', number> = {
          total: orders.length,
          pending: 0,
          executing: 0,
          filled: 0,
          cancelled: 0,
          expired: 0,
          error: 0,
          inactive: 0,
        };

        for (const order of orders) {
          stats[order.status]++;
        }

        return stats;
      }
    );
  }

  /**
   * Очистить все ордера
   */
  async clearAllOrders(): Promise<void> {
    this.orders.clear();
    await this.saveOrders();
    console.log(`   🗑️ All ${this.dex} orders cleared`);
  }

  // ==================== Абстрактные методы ====================

  /**
   * Получить тип токена для этого менеджера
   */
  protected abstract getTokenType(): 'DEX_POOL' | 'BONDING_CURVE';

  /**
   * Получить текущую цену токена
   */
  protected abstract getCurrentPrice(tokenMint: string): Promise<number>;

  /**
   * Исполнить ордер с retry
   */
  protected abstract executeOrderWithRetry(order: LimitOrder): Promise<ExecutionResult>;

  // ==================== Защищенные методы ====================

  /**
   * Проверить и исполнить ордера
   */
  protected async checkAndExecuteOrders(): Promise<void> {
    const activeOrders = await this.getActiveOrders();
    
    if (activeOrders.length === 0) {
      return;
    }

    console.log(`   🔍 Checking ${activeOrders.length} active ${this.dex} orders...`);

    for (const order of activeOrders) {
      try {
        await this.checkAndExecuteOrder(order);
      } catch (error) {
        console.error(`   ❌ Error checking order ${order.id}:`, error);
        order.status = OrderStatus.ERROR;
        order.errorMessage = String(error);
        await this.saveOrders();
      }
    }
  }

  /**
   * Проверить и исполнить один ордер
   */
  protected async checkAndExecuteOrder(order: LimitOrder): Promise<void> {
    // Используем блокировку для защиты от race conditions при исполнении ордера
    await this.concurrencyManager.withLock(
      `order_execute_${order.id}`,
      async () => {
        // Double-check pattern - проверяем статус дважды
        const currentOrder = this.orders.get(order.id);
        if (!currentOrder || currentOrder.status !== OrderStatus.PENDING) {
          return; // Ордер уже был исполнен или отменен другим потоком
        }

        try {
          const currentPrice = await this.getCurrentPrice(order.params.tokenMint);
          const shouldExecute = this.shouldExecuteOrder(order, currentPrice);

          if (!shouldExecute) {
            return;
          }

          console.log(`   🎯 ${this.dex} order ${order.id} condition met! Executing...`);
          console.log(`      Current price: ${currentPrice.toFixed(8)} SOL, Target: ${order.params.price.toFixed(8)} SOL`);

          // Исполняем ордер с retry
          const result = await this.executeOrderWithRetry(order);
          
          if (result.success && result.signature) {
            order.status = OrderStatus.FILLED;
            order.filledAt = Date.now();
            order.filledPrice = currentPrice;
            order.txSignature = result.signature;
            order.filledAmount = result.receivedAmount;
            
            console.log(`   ✅ ${this.dex} order ${order.id} filled! TX: ${result.signature.slice(0, 8)}...`);
            
            await this.saveOrders();

            if (this.orderFilledCallback) {
              await this.orderFilledCallback(order);
            }
          } else {
            throw new Error(result.error || 'Execution failed after retries');
          }
        } catch (error) {
          console.error(`   ❌ Failed to execute ${this.dex} order ${order.id}:`, error);
          order.status = OrderStatus.ERROR;
          order.errorMessage = String(error);
          await this.saveOrders();
        }
      }
    );
  }

  /**
   * Проверить, нужно ли исполнять ордер
   */
  protected shouldExecuteOrder(order: LimitOrder, currentPrice: number): boolean {
    return UnifiedValidator.validateExecution(order, currentPrice);
  }

  /**
   * Загрузить ордера из файла с валидацией
   */
  protected async loadOrders(): Promise<void> {
    try {
      const data = await fs.readFile(this.ordersFile, 'utf-8');
      const ordersArray = JSON.parse(data) as LimitOrder[];
      
      this.orders.clear();
      
      let validCount = 0;
      let invalidCount = 0;
      
      for (const order of ordersArray) {
        // Валидация структуры ордера
        if (!order.id || !order.params || !order.status) {
          console.warn(`   ⚠️ Invalid order format, skipping: ${JSON.stringify(order)}`);
          invalidCount++;
          continue;
        }
        
        // Валидация параметров ордера
        const validation = UnifiedValidator.validateLimitOrder(order.params);
        if (!validation.valid) {
          console.warn(`   ⚠️ Order ${order.id} has invalid parameters: ${validation.errors.join(', ')}`);
          invalidCount++;
          continue;
        }
        
        this.orders.set(order.id, order);
        validCount++;
      }
      
      console.log(`   📂 Loaded ${validCount} valid ${this.dex} orders from ${this.ordersFile}`);
      if (invalidCount > 0) {
        console.log(`   ⚠️ Skipped ${invalidCount} invalid orders`);
      }
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        console.log(`   📂 No ${this.dex} orders file found, starting fresh`);
      } else {
        console.error(`   ❌ Error loading ${this.dex} orders:`, error);
      }
    }
  }

  /**
   * Сохранить ордера в файл (атомарно)
   */
  protected async saveOrders(): Promise<void> {
    // Используем блокировку для защиты от race conditions при сохранении
    await this.concurrencyManager.withLock(
      `orders_save_${this.dex}`,
      async () => {
        try {
          const ordersArray = Array.from(this.orders.values());
          const tempFile = `${this.ordersFile}.tmp`;
          await fs.writeFile(tempFile, JSON.stringify(ordersArray, null, 2), 'utf-8');
          await fs.rename(tempFile, this.ordersFile);
        } catch (error) {
          console.error(`   ❌ Error saving ${this.dex} orders:`, error);
        }
      }
    );
  }

  /**
   * Сгенерировать уникальный ID ордера
   */
  protected generateOrderId(): string {
    const prefix = this.dex === 'Jupiter' ? 'JLO' : 'LO';
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}
