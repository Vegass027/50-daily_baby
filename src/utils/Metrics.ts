/**
 * Система метрик и мониторинга
 * Отслеживает ключевые показатели работы бота
 */

export interface MetricValue {
  value: number;
  timestamp: number;
}

export interface OrderMetrics {
  total: number;
  pending: number;
  filled: number;
  cancelled: number;
  expired: number;
  error: number;
  inactive: number;
  successRate: number;
  avgExecutionTime: number;
  avgFee: number;
  avgPriceImpact: number;
}

export interface TradingMetrics {
  totalVolume: number; // Общий объем торгов в SOL
  totalTrades: number; // Количество сделок
  profit: number; // Общая прибыль в SOL
  profitPercent: number; // Прибыль в процентах
  avgTradeSize: number; // Средний размер сделки в SOL
}

export interface SystemMetrics {
  uptime: number; // Время работы в секундах
  memoryUsage: number; // Использование памяти в MB
  cpuUsage: number; // Использование CPU в %
  activeOrders: number; // Количество активных ордеров
  activeLocks: number; // Количество активных блокировок
}

export class MetricsManager {
  private metrics: Map<string, MetricValue[]> = new Map();
  private readonly MAX_HISTORY_SIZE = 1000; // Максимальное количество записей в истории
  private startTime: number = Date.now();
  
  // Метрики ордеров
  private orderExecutionTimes: number[] = [];
  private orderFees: number[] = [];
  private orderPriceImpacts: number[] = [];
  
  // Метрики торгов
  private trades: Array<{ volume: number; profit: number; timestamp: number }> = [];

  /**
   * Записать метрику
   */
  recordMetric(name: string, value: number): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    
    const history = this.metrics.get(name)!;
    history.push({
      value,
      timestamp: Date.now()
    });
    
    // Ограничиваем размер истории
    if (history.length > this.MAX_HISTORY_SIZE) {
      history.shift();
    }
  }

  /**
   * Получить текущее значение метрики
   */
  getMetric(name: string): number | null {
    const history = this.metrics.get(name);
    if (!history || history.length === 0) {
      return null;
    }
    return history[history.length - 1].value;
  }

  /**
   * Получить историю метрики
   */
  getMetricHistory(name: string, limit?: number): MetricValue[] {
    const history = this.metrics.get(name);
    if (!history) {
      return [];
    }
    
    if (limit) {
      return history.slice(-limit);
    }
    
    return [...history];
  }

  /**
   * Получить среднее значение метрики за период
   */
  getAverageMetric(name: string, periodMs: number = 60000): number | null {
    const history = this.metrics.get(name);
    if (!history || history.length === 0) {
      return null;
    }
    
    const now = Date.now();
    const recent = history.filter(m => now - m.timestamp <= periodMs);
    
    if (recent.length === 0) {
      return null;
    }
    
    const sum = recent.reduce((acc, m) => acc + m.value, 0);
    return sum / recent.length;
  }

  /**
   * Получить метрики ордеров
   */
  getOrderMetrics(orderStats: {
    total: number;
    pending: number;
    filled: number;
    cancelled: number;
    expired: number;
    error: number;
    inactive: number;
  }): OrderMetrics {
    const successRate = orderStats.total > 0
      ? (orderStats.filled / orderStats.total) * 100
      : 0;
    
    const avgExecutionTime = this.orderExecutionTimes.length > 0
      ? this.orderExecutionTimes.reduce((a, b) => a + b, 0) / this.orderExecutionTimes.length
      : 0;
    
    const avgFee = this.orderFees.length > 0
      ? this.orderFees.reduce((a, b) => a + b, 0) / this.orderFees.length
      : 0;

    const avgPriceImpact = this.orderPriceImpacts.length > 0
      ? this.orderPriceImpacts.reduce((a, b) => a + b, 0) / this.orderPriceImpacts.length
      : 0;

    return {
      total: orderStats.total,
      pending: orderStats.pending,
      filled: orderStats.filled,
      cancelled: orderStats.cancelled,
      expired: orderStats.expired,
      error: orderStats.error,
      inactive: orderStats.inactive,
      successRate,
      avgExecutionTime,
      avgFee,
      avgPriceImpact
    };
  }

  /**
   * Записать время исполнения ордера
   */
  recordOrderExecutionTime(executionTimeMs: number): void {
    this.orderExecutionTimes.push(executionTimeMs);
    
    // Ограничиваем размер истории
    if (this.orderExecutionTimes.length > 1000) {
      this.orderExecutionTimes.shift();
    }
    
    this.recordMetric('order_execution_time', executionTimeMs);
  }

  /**
   * Записать комиссию ордера
   */
  recordOrderFee(fee: number): void {
    this.orderFees.push(fee);
    
    // Ограничиваем размер истории
    if (this.orderFees.length > 1000) {
      this.orderFees.shift();
    }
    
    this.recordMetric('order_fee', fee);
  }

  /**
   * Записать price impact ордера
   */
  recordOrderPriceImpact(priceImpact: number): void {
    this.orderPriceImpacts.push(priceImpact);
    
    // Ограничиваем размер истории
    if (this.orderPriceImpacts.length > 1000) {
      this.orderPriceImpacts.shift();
    }
    
    this.recordMetric('order_price_impact', priceImpact);
  }

  /**
   * Записать сделку
   */
  recordTrade(volume: number, profit: number): void {
    this.trades.push({
      volume,
      profit,
      timestamp: Date.now()
    });
    
    // Ограничиваем размер истории
    if (this.trades.length > 1000) {
      this.trades.shift();
    }
    
    this.recordMetric('trade_volume', volume);
    this.recordMetric('trade_profit', profit);
  }

  /**
   * Получить метрики торговли
   */
  getTradingMetrics(): TradingMetrics {
    const totalVolume = this.trades.reduce((acc, t) => acc + t.volume, 0);
    const totalTrades = this.trades.length;
    const profit = this.trades.reduce((acc, t) => acc + t.profit, 0);
    const avgTradeSize = totalTrades > 0 ? totalVolume / totalTrades : 0;
    
    // Рассчитываем прибыль в процентах (относительно объема)
    const profitPercent = totalVolume > 0 ? (profit / totalVolume) * 100 : 0;

    return {
      totalVolume,
      totalTrades,
      profit,
      profitPercent,
      avgTradeSize
    };
  }

  /**
   * Получить системные метрики
   */
  getSystemMetrics(activeOrders: number, activeLocks: number): SystemMetrics {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    const memoryUsage = process.memoryUsage();
    const memoryUsageMB = memoryUsage.heapUsed / 1024 / 1024;
    
    // CPU usage - упрощенная оценка
    const cpuUsage = process.cpuUsage();
    const cpuUsagePercent = (cpuUsage.user + cpuUsage.system) / 1000000 / uptime * 100;

    return {
      uptime,
      memoryUsage: memoryUsageMB,
      cpuUsage: cpuUsagePercent,
      activeOrders,
      activeLocks
    };
  }

  /**
   * Получить все метрики в формате для логирования
   */
  getAllMetrics(): Record<string, any> {
    const orderMetrics = this.getMetric('order_count') || 0;
    const tradeMetrics = this.getMetric('trade_count') || 0;
    
    return {
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      orders: orderMetrics,
      trades: tradeMetrics,
      metrics: Object.fromEntries(
        Array.from(this.metrics.entries()).map(([name, history]) => [
          name,
          history.length > 0 ? history[history.length - 1].value : 0
        ])
      )
    };
  }

  /**
   * Очистить все метрики
   */
  clearAll(): void {
    this.metrics.clear();
    this.orderExecutionTimes = [];
    this.orderFees = [];
    this.orderPriceImpacts = [];
    this.trades = [];
    this.startTime = Date.now();
  }

  /**
   * Получить размер истории метрик
   */
  getMetricsCount(): number {
    return Array.from(this.metrics.values()).reduce((acc, history) => acc + history.length, 0);
  }
}

// Синглтон для глобального использования
let globalMetricsManager: MetricsManager | null = null;

export function getMetricsManager(): MetricsManager {
  if (!globalMetricsManager) {
    globalMetricsManager = new MetricsManager();
  }
  return globalMetricsManager;
}
