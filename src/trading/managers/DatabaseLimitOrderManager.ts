import { LimitOrder, LimitOrderParams, OrderStatus, OrderType, OrderFilledCallback, OrderCancelledCallback, LinkedOrderPair } from './ILimitOrderManager';
import { JupiterLimitOrderManager } from './JupiterLimitOrderManager';
import { PumpFunLimitOrderManager } from './PumpFunLimitOrderManager';
import { PriceMonitor } from './PriceMonitor';
import { OrderExecutor } from './OrderExecutor';
import { UnifiedValidator } from '../../utils/UnifiedValidator';
import { TokenTypeDetector } from './TokenTypeDetector';
import { DatabaseOrderRepository } from '../../database/DatabaseOrderRepository';

/**
 * Unified менеджер лимитных ордеров с поддержкой базы данных
 * Объединяет Jupiter и PumpFun менеджеры, поддерживает linked orders (buy + take profit)
 * Хранит все ордера в PostgreSQL через DatabaseOrderRepository
 */
export class DatabaseLimitOrderManager {
  private jupiterManager: JupiterLimitOrderManager;
  private pumpFunManager: PumpFunLimitOrderManager;
  private priceMonitor: PriceMonitor;
  private orderExecutor: OrderExecutor;
  private tokenTypeDetector: TokenTypeDetector;
  private orderRepository: DatabaseOrderRepository;
  
  // Кэш ордеров в памяти для быстрого доступа
  private orderCache: Map<string, LimitOrder> = new Map();
  
  // Linked orders (buy limit ↔ take profit)
  private linkedOrders: Map<string, LinkedOrderPair> = new Map();
  
  // Callbacks
  private orderFilledCallback: OrderFilledCallback | null = null;
  private orderCancelledCallback: OrderCancelledCallback | null = null;
  
  // Флаг инициализации для защиты от двойной инициализации
  private isInitialized = false;
  
  constructor(
    jupiterManager: JupiterLimitOrderManager,
    pumpFunManager: PumpFunLimitOrderManager,
    priceMonitor: PriceMonitor,
    orderExecutor: OrderExecutor,
    tokenTypeDetector: TokenTypeDetector,
    projectId: string
  ) {
    this.jupiterManager = jupiterManager;
    this.pumpFunManager = pumpFunManager;
    this.priceMonitor = priceMonitor;
    this.orderExecutor = orderExecutor;
    this.tokenTypeDetector = tokenTypeDetector;
    this.orderRepository = new DatabaseOrderRepository(projectId);
  }
  
  /**
   * Инициализация менеджера
   */
  async initialize(): Promise<void> {
    // Защита от повторной инициализации
    if (this.isInitialized) {
      console.warn(' ⚠️ DatabaseLimitOrderManager already initialized');
      return;
    }

    // Загружаем ордера из базы данных
    await this.loadOrdersFromDatabase();
    
    // Настраиваем callbacks для менеджеров
    this.jupiterManager.setOrderFilledCallback(this.handleOrderFilled.bind(this));
    this.pumpFunManager.setOrderFilledCallback(this.handleOrderFilled.bind(this));
    
    // Настраиваем callback для изменения типа токена
    this.tokenTypeDetector.setTokenTypeChangeCallback(this.handleTokenTypeChange.bind(this));
    
    this.isInitialized = true; // Устанавливаем флаг
    console.log(`   ✅ DatabaseLimitOrderManager initialized (${this.orderCache.size} orders)`);
  }
  
  /**
   * Обработка изменения типа токена (миграция с bonding curve на DEX)
   * Оптимизировано с использованием batch update вместо цикла с await
   */
  private async handleTokenTypeChange(
    tokenMint: string,
    oldType: 'DEX_POOL' | 'BONDING_CURVE',
    newType: 'DEX_POOL' | 'BONDING_CURVE'
  ): Promise<void> {
    console.log(`   🔄 Token type changed: ${tokenMint.slice(0, 8)}... ${oldType} -> ${newType}`);
    
    // Собираем ID всех затронутых ордеров
    const affectedOrderIds: string[] = [];
    
    for (const order of this.orderCache.values()) {
      if (order.params.tokenMint === tokenMint && order.tokenType !== newType) {
        order.tokenType = newType;
        order.updatedAt = Date.now();
        affectedOrderIds.push(order.id);
      }
    }

    if (affectedOrderIds.length > 0) {
      // Один batch update вместо множественных
      await this.orderRepository.batchUpdate(affectedOrderIds, { tokenType: newType });
      console.log(`   ✅ Updated ${affectedOrderIds.length} orders for migrated token (batch update)`);
    }
  }
  
  /**
   * Создать лимитный ордер
   */
  async createOrder(params: LimitOrderParams): Promise<string> {
    // Валидация параметров
    const validation = UnifiedValidator.validateLimitOrder(params);
    if (!validation.valid) {
      throw new Error(`Invalid order parameters: ${validation.errors.join(', ')}`);
    }
    
    // Определение типа токена
    const tokenType = await this.tokenTypeDetector.detectType(params.tokenMint);
    
    // Создание ордера
    const orderId = this.generateOrderId();
    const now = Date.now();
    const order: LimitOrder = {
      id: orderId,
      params,
      status: OrderStatus.PENDING,
      tokenType,
      createdAt: now,
      updatedAt: now
    };
    
    // Создание take profit если указан
    let takeProfitOrderId: string | undefined;
    if (params.takeProfitPercent) {
      const tpOrder = this.createTakeProfitOrderObject(order, params.takeProfitPercent);
      
      // Используем транзакцию для создания связанных ордеров
      const result = await this.orderRepository.createBuyOrderWithTakeProfit(order, tpOrder);
      takeProfitOrderId = result.takeProfitOrderId;
      
      // Сохраняем в кэш
      this.orderCache.set(orderId, order);
      this.orderCache.set(takeProfitOrderId, tpOrder);
      
      // Сохраняем связь ордеров
      this.linkedOrders.set(orderId, {
        buyOrderId: orderId,
        takeProfitOrderId
      });
      
      console.log(`   ✅ Buy order with take profit created in transaction`);
    } else {
      // Сохраняем в кэш и базу данных (без take profit)
      this.orderCache.set(orderId, order);
      await this.orderRepository.create(order);
    }
    
    // Добавление в соответствующий менеджер
    if (tokenType === 'DEX_POOL') {
      await this.jupiterManager.createOrder(params);
    } else {
      await this.pumpFunManager.createOrder(params);
    }
    
    console.log(`   ✅ Limit order created: ${orderId}`);
    console.log(`      Type: ${params.orderType}, Token: ${params.tokenMint.slice(0, 8)}...`);
    console.log(`      Price: ${params.price} SOL, Amount: ${params.amount}`);
    if (takeProfitOrderId && params.takeProfitPercent) {
      const tpPrice = UnifiedValidator.calculateTakeProfitPrice(params.price, params.takeProfitPercent);
      console.log(`      Take Profit: ${tpPrice.toFixed(8)} SOL (${takeProfitOrderId})`);
    }
    
    return orderId;
  }
  
  /**
   * Создать объект take profit ордера (без сохранения в БД)
   */
  private createTakeProfitOrderObject(
    buyOrder: LimitOrder,
    takeProfitPercent: number
  ): LimitOrder {
    const tpOrderId = this.generateOrderId();
    const tpPrice = UnifiedValidator.calculateTakeProfitPrice(buyOrder.params.price, takeProfitPercent);
    const now = Date.now();
    
    return {
      id: tpOrderId,
      params: {
        userId: buyOrder.params.userId,
        tokenMint: buyOrder.params.tokenMint,
        orderType: OrderType.SELL,
        price: tpPrice,
        amount: buyOrder.params.amount, // Будет обновлено после buy
        slippage: buyOrder.params.slippage
      },
      status: OrderStatus.INACTIVE,
      tokenType: buyOrder.tokenType,
      linkedBuyOrderId: buyOrder.id,
      createdAt: now,
      updatedAt: now
    };
  }
  
  /**
   * Отменить ордер
   */
  async cancelOrder(orderId: string): Promise<void> {
    const order = this.orderCache.get(orderId);
    
    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }
    
    if (order.status !== OrderStatus.PENDING) {
      throw new Error(`Cannot cancel order with status ${order.status}`);
    }
    
    // Отмена связанных ордеров в транзакции
    const linkedPair = this.linkedOrders.get(orderId);
    if (linkedPair && linkedPair.takeProfitOrderId) {
      const relatedOrderId = linkedPair.buyOrderId === orderId
        ? linkedPair.takeProfitOrderId
        : linkedPair.buyOrderId;
      
      if (relatedOrderId) {
        const relatedOrder = this.orderCache.get(relatedOrderId);
        if (relatedOrder && (relatedOrder.status === OrderStatus.PENDING || relatedOrder.status === OrderStatus.INACTIVE)) {
          // Используем транзакцию для отмены связанных ордеров
          await this.orderRepository.cancelLinkedOrdersInTransaction(orderId, relatedOrderId);
          
          // Обновляем в кэше
          relatedOrder.status = OrderStatus.CANCELLED;
          relatedOrder.updatedAt = Date.now();
          this.orderCache.set(relatedOrderId, relatedOrder);
          
          console.log(`   ✅ Related order cancelled in transaction: ${relatedOrderId}`);
        }
      }
      
      this.linkedOrders.delete(orderId);
    }
    
    // Отмена через соответствующий менеджер
    if (order.tokenType === 'DEX_POOL') {
      await this.jupiterManager.cancelOrder(orderId);
    } else {
      await this.pumpFunManager.cancelOrder(orderId);
    }
    
    order.status = OrderStatus.CANCELLED;
    order.updatedAt = Date.now();
    await this.orderRepository.update(order);
    
    if (this.orderCancelledCallback) {
      await this.orderCancelledCallback(order);
    }
    
    console.log(`   ✅ Order cancelled: ${orderId}`);
  }
  
  /**
   * Получить ордер по ID
   */
  async getOrder(orderId: string): Promise<LimitOrder | null> {
    // Сначала проверяем кэш
    if (this.orderCache.has(orderId)) {
      return this.orderCache.get(orderId)!;
    }
    
    // Если нет в кэше, загружаем из базы
    const order = await this.orderRepository.findById(orderId);
    if (order) {
      this.orderCache.set(orderId, order);
    }
    
    return order;
  }
  
  /**
   * Получить все ордера
   */
  async getAllOrders(): Promise<LimitOrder[]> {
    // Загружаем из базы данных для актуальности
    const orders = await this.orderRepository.findAll();
    
    // Обновляем кэш
    this.orderCache.clear();
    for (const order of orders) {
      this.orderCache.set(order.id, order);
    }
    
    // Восстанавливаем связи
    this.rebuildLinkedOrders(orders);
    
    return orders.sort((a, b) => b.createdAt - a.createdAt);
  }
  
  /**
   * Получить активные ордера
   */
  async getActiveOrders(): Promise<LimitOrder[]> {
    const orders = await this.orderRepository.findByStatus(OrderStatus.PENDING);
    
    // Обновляем кэш
    for (const order of orders) {
      this.orderCache.set(order.id, order);
    }
    
    return orders.sort((a, b) => b.createdAt - a.createdAt);
  }
  
  /**
   * Получить связку ордеров
   */
  getLinkedOrders(orderId: string): LinkedOrderPair | null {
    return this.linkedOrders.get(orderId) || null;
  }

  /**
   * Получить ордера, связанные с позицией
   * @param positionId ID позиции (обычно ID buy ордера)
   * @returns Массив ордеров, связанных с позицией
   */
  async getOrdersByPosition(positionId: string): Promise<LimitOrder[]> {
    const orders = await this.orderRepository.findByPositionId(positionId);
    
    // Обновляем кэш
    for (const order of orders) {
      this.orderCache.set(order.id, order);
    }
    
    return orders;
  }
  
  /**
   * Обработка заполнения ордера
   */
  private async handleOrderFilled(order: LimitOrder): Promise<void> {
    console.log(`   🎯 Order filled: ${order.id}`);
    
    // Обновляем статус
    order.status = OrderStatus.FILLED;
    order.filledAt = Date.now();
    order.updatedAt = Date.now();
    
    // Активируем take profit если есть
    const linkedPair = this.linkedOrders.get(order.id);
    if (linkedPair && order.params.orderType === OrderType.BUY) {
      const tpOrderId = linkedPair.takeProfitOrderId;
      if (tpOrderId) {
        await this.activateTakeProfitOrder(tpOrderId, order);
      }
    } else {
      // Если нет take profit, просто обновляем buy ордер
      await this.orderRepository.update(order);
    }
    
    if (this.orderFilledCallback) {
      await this.orderFilledCallback(order);
    }
  }
  
  /**
   * Активировать take profit ордер с защитой от двойной активации
   */
  private async activateTakeProfitOrder(
    tpOrderId: string,
    buyOrder: LimitOrder,
    retries = 3
  ): Promise<void> {
    for (let i = 0; i < retries; i++) {
      try {
        // Double-check order still exists and inactive
        const dbOrder = await this.orderRepository.findById(tpOrderId);
        if (!dbOrder) {
          throw new Error(`TP order ${tpOrderId} not found in database`);
        }
        
        if (dbOrder.status !== OrderStatus.INACTIVE) {
          console.warn(`TP order ${tpOrderId} already activated (status: ${dbOrder.status})`);
          return;
        }
        
        const tpOrder = this.orderCache.get(tpOrderId);
        if (!tpOrder) {
          throw new Error(`TP order ${tpOrderId} not found in cache`);
        }
        
        // Подготовка обновлений
        const buyOrderUpdate = {
          status: buyOrder.status,
          filledPrice: buyOrder.filledPrice,
          filledAmount: buyOrder.filledAmount,
          updatedAt: buyOrder.updatedAt,
        };

        tpOrder.status = OrderStatus.PENDING;
        tpOrder.updatedAt = Date.now();
        // Обновляем количество токенов для take profit
        tpOrder.params.amount = buyOrder.filledAmount || buyOrder.params.amount;

        const tpOrderUpdate = {
          status: tpOrder.status,
          params: tpOrder.params,
          updatedAt: tpOrder.updatedAt,
        };

        // Используем транзакцию для обновления связанных ордеров
        await this.orderRepository.updateLinkedOrdersInTransaction(
          buyOrder.id,
          tpOrderId,
          {
            buyOrder: buyOrderUpdate,
            takeProfitOrder: tpOrderUpdate,
          }
        );

        console.log(`   ✅ Take profit activated in transaction: ${tpOrderId}`);
        console.log(`      Amount: ${tpOrder.params.amount} tokens`);
        console.log(`      Price: ${tpOrder.params.price.toFixed(8)} SOL`);
        
        return; // Success
        
      } catch (error) {
        console.error(`Failed to activate TP order (attempt ${i + 1}/${retries}):`, error);
        
        if (i === retries - 1) {
          // Last attempt failed - notify user
          console.error(`⚠️ Failed to activate Take Profit order ${tpOrderId} after ${retries} attempts. Please check manually.`);
          throw error;
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }
  
  /**
   * Установить callbacks
   */
  setOrderFilledCallback(callback: OrderFilledCallback): void {
    this.orderFilledCallback = callback;
  }
  
  setOrderCancelledCallback(callback: OrderCancelledCallback): void {
    this.orderCancelledCallback = callback;
  }
  
  /**
   * Загрузить ордера из базы данных с валидацией
   */
  private async loadOrdersFromDatabase(): Promise<void> {
    try {
      const orders = await this.orderRepository.findAll();
      
      this.orderCache.clear();
      this.linkedOrders.clear();
      
      let validCount = 0;
      let invalidCount = 0;
      
      for (const order of orders) {
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
        
        this.orderCache.set(order.id, order);
        validCount++;
      }
      
      // Восстанавливаем связи ордеров
      this.rebuildLinkedOrders(orders);
      
      console.log(`   📂 Loaded ${validCount} valid orders from database`);
      if (invalidCount > 0) {
        console.log(`   ⚠️ Skipped ${invalidCount} invalid orders`);
      }
    } catch (error) {
      console.error('   ❌ Error loading orders from database:', error);
    }
  }
  
  /**
   * Восстановить связи ордеров из загруженных данных
   */
  private rebuildLinkedOrders(orders: LimitOrder[]): void {
    for (const order of orders) {
      if (order.linkedBuyOrderId || order.linkedTakeProfitOrderId) {
        this.linkedOrders.set(order.id, {
          buyOrderId: order.linkedBuyOrderId || order.id,
          takeProfitOrderId: order.linkedTakeProfitOrderId
        });
      }
    }
  }
  
  /**
   * Сгенерировать уникальный ID ордера
   */
  private generateOrderId(): string {
    return `LO_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
  
  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    console.log('   🔒 Shutting down DatabaseLimitOrderManager...');
    
    // Останавливаем мониторинг
    this.jupiterManager.stopMonitoring();
    this.pumpFunManager.stopMonitoring();
    
    // Останавливаем мониторинг цен
    this.priceMonitor.stopAllMonitoring();
    
    // Сбрасываем флаг инициализации
    this.isInitialized = false;
    
    // Ордера уже сохранены в базе данных, но можно принудительно обновить
    console.log('   ✅ All orders are already saved in database');
    
    console.log('   ✅ DatabaseLimitOrderManager shutdown complete');
  }

  /**
   * Очистить все ордера
   */
  async clearAllOrders(): Promise<void> {
    // Удаляем из базы данных
    for (const order of this.orderCache.values()) {
      await this.orderRepository.delete(order.id);
    }
    
    this.orderCache.clear();
    this.linkedOrders.clear();
    console.log('   🗑️ All orders cleared from database');
  }
  
  /**
   * Получить статистику ордеров
   */
  async getStats(): Promise<Record<OrderStatus | 'total', number>> {
    const stats = await this.orderRepository.getStats();
    
    return stats;
  }
}
