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
  EXECUTING = 'executing', // Для ордеров в процессе исполнения
  FILLED = 'filled',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
  ERROR = 'error',
  INACTIVE = 'inactive', // Для take profit ордеров, которые еще не активированы
}

export interface LimitOrderParams {
  userId: number; // ID пользователя, создающего ордер
  tokenMint: string;
  orderType: OrderType;
  amount: number; // в базовых единицах (lamports для SOL, token units для токенов)
  price: number; // цена в SOL за 1 токен
  slippage?: number;
  takeProfitPercent?: number; // автоматический take profit
  stopLossPercent?: number; // автоматический stop loss
  linkedPositionId?: string; // ID связанной позиции (для TP/SL ордеров)
}

export interface LimitOrder {
  id: string;
  params: LimitOrderParams;
  status: OrderStatus;
  createdAt: number;
  updatedAt?: number; // Время последнего обновления ордера
  filledAt?: number;
  filledAmount?: number;
  filledPrice?: number;
  txSignature?: string;
  signature?: string; // Псевдоним для txSignature (для совместимости с базой данных)
  relatedOrderId?: string; // для take profit / stop loss (deprecated, используйте linkedBuyOrderId/linkedTakeProfitOrderId)
  linkedBuyOrderId?: string; // ID связанного buy ордера (для take profit)
  linkedTakeProfitOrderId?: string; // ID связанного take profit ордера (для buy)
  linkedPositionId?: string; // ID связанной позиции (для TP/SL ордеров)
  errorMessage?: string; // текст ошибки при статусе ERROR
  error?: string; // Псевдоним для errorMessage (для совместимости с базой данных)
  currentPrice?: number; // Текущая цена токена (для мониторинга)
  tokenType?: 'DEX_POOL' | 'BONDING_CURVE'; // Тип токена (для выбора стратегии)
  takeProfitPercent?: number; // Процент take profit (для take profit ордеров)
  jitoTip?: number; // Размер Jito tip в lamports
  retryCount?: number; // Количество попыток повтора
  lastRetryAt?: number; // Время последней попытки повтора
}

export type OrderFilledCallback = (order: LimitOrder) => Promise<void>;
export type OrderCancelledCallback = (order: LimitOrder) => Promise<void>;

/**
 * Связка ордеров (buy limit + take profit)
 */
export interface LinkedOrderPair {
  buyOrderId: string;
  takeProfitOrderId?: string;
}

export interface ILimitOrderManager {
  name: string;
  dex: string;

  /**
   * Установить колбэк, который будет вызываться при исполнении ордера.
   * @param callback Функция обратного вызова
   */
  setOrderFilledCallback(callback: OrderFilledCallback): void;

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
  getStats(): Promise<Record<OrderStatus | 'total', number>>;
}
