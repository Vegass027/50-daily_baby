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
import { PumpFunStrategy } from '../strategies/solana/PumpFunStrategy';
import { PriceMonitor } from './PriceMonitor';
import { UserSettings } from '../router/ITradingStrategy';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

/**
 * Менеджер виртуальных лимитных ордеров для PumpFun
 * Использует мониторинг цен и авто-исполнение ордеров
 */
export class PumpFunLimitOrderManager implements ILimitOrderManager {
  name = 'PumpFun Limit Orders';
  dex = 'PumpFun';

  private pumpFunStrategy: PumpFunStrategy;
  private priceMonitor: PriceMonitor;
  private wallet: Keypair;
  private userSettings: UserSettings;
  private orders: Map<string, LimitOrder> = new Map();
  private ordersFile: string;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private readonly MONITORING_INTERVAL = 30000; // 30 секунд
  private orderFilledCallback: OrderFilledCallback | null = null;

  constructor(
    pumpFunStrategy: PumpFunStrategy,
    priceMonitor: PriceMonitor,
    wallet: Keypair,
    userSettings: UserSettings,
    dataDir: string = './data'
  ) {
    this.pumpFunStrategy = pumpFunStrategy;
    this.priceMonitor = priceMonitor;
    this.wallet = wallet;
    this.userSettings = userSettings;
    this.ordersFile = path.join(dataDir, 'limit_orders.json');
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

  public setOrderFilledCallback(callback: OrderFilledCallback): void {
    this.orderFilledCallback = callback;
  }

  /**
   * Создать лимитный ордер
   */
  async createOrder(params: LimitOrderParams): Promise<string> {
    const orderId = this.generateOrderId();
    
    const order: LimitOrder = {
      id: orderId,
      params,
      status: OrderStatus.PENDING,
      createdAt: Date.now(),
    };

    this.orders.set(orderId, order);
    await this.saveOrders();

    console.log(`   ✅ Limit order created: ${orderId}`);
    console.log(`      Type: ${params.orderType}, Amount: ${params.amount}, Price: ${params.price} SOL`);
    
    return orderId;
  }

  /**
   * Отменить ордер
   */
  async cancelOrder(orderId: string): Promise<void> {
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

    console.log(`   🔄 Starting limit order monitoring (interval: ${this.MONITORING_INTERVAL}ms)`);
    
    this.monitoringInterval = setInterval(async () => {
      await this.checkAndExecuteOrders();
    }, this.MONITORING_INTERVAL);

    // Сразу проверяем ордера
    await this.checkAndExecuteOrders();
  }

  /**
   * Остановить мониторинг ордеров
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      console.log('   ⏹️ Limit order monitoring stopped');
    }
  }

  /**
   * Проверить и исполнить ордера
   */
  private async checkAndExecuteOrders(): Promise<void> {
    const activeOrders = await this.getActiveOrders();
    
    if (activeOrders.length === 0) {
      return;
    }

    console.log(`   🔍 Checking ${activeOrders.length} active orders...`);

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
  private async checkAndExecuteOrder(order: LimitOrder): Promise<void> {
    const currentPrice = await this.priceMonitor.getCurrentPrice(order.params.tokenMint);
    const shouldExecute = this.shouldExecuteOrder(order, currentPrice);

    if (!shouldExecute) {
      return;
    }

    console.log(`   🎯 Order ${order.id} condition met! Executing...`);
    console.log(`      Current price: ${currentPrice.toFixed(8)} SOL, Target: ${order.params.price.toFixed(8)} SOL`);

    try {
      // Исполняем ордер
      const txSignature = await this.executeOrder(order);
      
      order.status = OrderStatus.FILLED;
      order.filledAt = Date.now();
      order.filledPrice = currentPrice;
      order.txSignature = txSignature;
      
      console.log(`   ✅ Order ${order.id} filled! TX: ${txSignature.slice(0, 8)}...`);
      
      await this.saveOrders();

      if (this.orderFilledCallback) {
        await this.orderFilledCallback(order);
      }
    } catch (error) {
      console.error(`   ❌ Failed to execute order ${order.id}:`, error);
      order.status = OrderStatus.ERROR;
      order.errorMessage = String(error);
      await this.saveOrders();
    }
  }

  /**
   * Проверить, нужно ли исполнять ордер
   */
  private shouldExecuteOrder(order: LimitOrder, currentPrice: number): boolean {
    const targetPrice = order.params.price;
    const tolerance = 0.01; // 1% допуск

    if (order.params.orderType === OrderType.BUY) {
      // Buy: исполнить если текущая цена <= целевая (с допуском)
      return currentPrice <= targetPrice * (1 + tolerance);
    } else {
      // Sell: исполнить если текущая цена >= целевая (с допуском)
      return currentPrice >= targetPrice * (1 - tolerance);
    }
  }

  /**
   * Исполнить ордер
   */
  private async executeOrder(order: LimitOrder): Promise<string> {
    const params = {
      tokenIn: order.params.orderType === OrderType.BUY 
        ? 'So11111111111111111111111111111111111111112' 
        : order.params.tokenMint,
      tokenOut: order.params.orderType === OrderType.BUY 
        ? order.params.tokenMint 
        : 'So11111111111111111111111111111111111111112',
      amount: order.params.amount,
      slippage: order.params.slippage || this.userSettings.slippage,
      userWallet: this.wallet,
    };

    return await this.pumpFunStrategy.executeSwap(params, this.userSettings);
  }

  /**
   * Получить статистику ордеров
   */
  async getStats(): Promise<{
    total: number;
    pending: number;
    filled: number;
    cancelled: number;
    expired: number;
    error: number;
  }> {
    const orders = await this.getAllOrders();
    
    const stats = {
      total: orders.length,
      pending: 0,
      filled: 0,
      cancelled: 0,
      expired: 0,
      error: 0,
    };

    for (const order of orders) {
      stats[order.status]++;
    }

    return stats;
  }

  /**
   * Загрузить ордера из файла
   */
  private async loadOrders(): Promise<void> {
    try {
      const data = await fs.readFile(this.ordersFile, 'utf-8');
      const ordersArray = JSON.parse(data) as LimitOrder[];
      
      this.orders.clear();
      for (const order of ordersArray) {
        this.orders.set(order.id, order);
      }
      
      console.log(`   📂 Loaded ${this.orders.size} orders from ${this.ordersFile}`);
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        console.log(`   📂 No orders file found, starting fresh`);
      } else {
        console.error('   ❌ Error loading orders:', error);
      }
    }
  }

  /**
   * Сохранить ордера в файл
   */
  private async saveOrders(): Promise<void> {
    try {
      const ordersArray = Array.from(this.orders.values());
      await fs.writeFile(this.ordersFile, JSON.stringify(ordersArray, null, 2), 'utf-8');
    } catch (error) {
      console.error('   ❌ Error saving orders:', error);
    }
  }

  /**
   * Сгенерировать уникальный ID ордера
   */
  private generateOrderId(): string {
    return `LO_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Очистить все ордера
   */
  async clearAllOrders(): Promise<void> {
    this.orders.clear();
    await this.saveOrders();
    console.log('   🗑️ All orders cleared');
  }
}
