/**
 * Универсальный интерфейс для управления лимитными ордерами
 * Поддерживает разные DEX (PumpFun, Jupiter)
 */

export enum OrderType {
  BUY = 'buy',
  SELL = 'sell',
}

export enum OrderStatus {
  PENDING = 'pending',
  FILLED = 'filled',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
  ERROR = 'error',
}

export interface LimitOrderParams {
  tokenMint: string;
  orderType: OrderType;
  amount: number; // в базовых единицах (lamports для SOL, token units для токенов)
  price: number; // цена в SOL за 1 токен
  slippage?: number;
  takeProfitPercent?: number; // автоматический take profit
  stopLossPercent?: number; // автоматический stop loss
}

export interface LimitOrder {
  id: string;
  params: LimitOrderParams;
  status: OrderStatus;
  createdAt: number;
  filledAt?: number;
  filledAmount?: number;
  filledPrice?: number;
  txSignature?: string;
  relatedOrderId?: string; // для take profit / stop loss
  errorMessage?: string; // текст ошибки при статусе ERROR
}

export interface ILimitOrderManager {
  name: string;
  dex: string;

  /**
   * Создать лимитный ордер
   * @param params параметры ордера
   * @returns ID созданного ордера
   */
  createOrder(params: LimitOrderParams): Promise<string>;

  /**
   * Отменить ордер
   * @param orderId ID ордера
   */
  cancelOrder(orderId: string): Promise<void>;

  /**
   * Получить ордер по ID
   * @param orderId ID ордера
   * @returns Ордер или null если не найден
   */
  getOrder(orderId: string): Promise<LimitOrder | null>;

  /**
   * Получить все ордера
   * @returns Массив всех ордеров
   */
  getAllOrders(): Promise<LimitOrder[]>;

  /**
   * Получить активные ордера (PENDING)
   * @returns Массив активных ордеров
   */
  getActiveOrders(): Promise<LimitOrder[]>;

  /**
   * Мониторинг и исполнение ордеров
   * Для виртуальных ордеров (PumpFun) - проверка условий и авто-исполнение
   * Для нативных ордеров (Jupiter) - проверка статуса
   */
  monitorOrders(): Promise<void>;

  /**
   * Остановить мониторинг ордеров
   */
  stopMonitoring(): void;

  /**
   * Получить статистику ордеров
   */
  getStats(): Promise<{
    total: number;
    pending: number;
    filled: number;
    cancelled: number;
    expired: number;
    error: number;
  }>;
}
