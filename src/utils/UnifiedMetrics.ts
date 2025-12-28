/**
 * Унифицированная система метрик и мониторинга
 * Объединяет in-memory метрики (MetricsManager) и персистентность (MetricsCollector)
 */

import * as fs from 'fs/promises';
import * as path from 'path';

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

export interface OrderExecutionData {
  orderId: string;
  success: boolean;
  duration: number;
  fee: number;
  volume: number;
  priceImpact?: number;
  timestamp: number;
  error?: string;
}

/**
 * Унифицированный менеджер метрик
 * - In-memory: для быстрого доступа к runtime метрикам
 * - Персистентность: для долгосрочного хранения и анализа
 */
export class UnifiedMetrics {
  // ==================== In-memory метрики (быстрый доступ) ====================
  private metrics: Map<string, MetricValue[]> = new Map();
  private readonly MAX_HISTORY_SIZE = 1000;
  private startTime: number = Date.now();
  
  // Метрики ордеров (in-memory)
  private orderExecutionTimes: number[] = [];
  private orderFees: number[] = [];
  private orderPriceImpacts: number[] = [];
  
  // Метрики торгов (in-memory)
  private trades: Array<{ volume: number; profit: number; timestamp: number }> = [];

  // ==================== Персистентные метрики (файловая система) ====================
  private metricsFile: string;
  private executions: OrderExecutionData[] = [];
  private enabled: boolean;

  constructor(dataDir: string = './data', enabled: boolean = true) {
    this.metricsFile = path.join(dataDir, 'metrics.json');
    this.enabled = enabled;
  }

  // ==================== Инициализация ====================

  /**
   * Инициализация коллектора (загрузка персистентных данных)
   */
  async initialize(): Promise<void> {
    if (!this.enabled) return;

    try {
      const data = await fs.readFile(this.metricsFile, 'utf-8');
      const parsed = JSON.parse(data);
      this.executions = parsed.executions || [];
      this.startTime = parsed.startTime || Date.now();
      console.log(`   📊 Loaded ${this.executions.length} execution records`);
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        console.log('   📊 No metrics file found, starting fresh');
      } else {
        console.error('   ❌ Error loading metrics:', error);
      }
    }
  }

  // ==================== In-memory метрики (runtime) ====================

  /**
   * Записать метрику в память
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
   * Записать время исполнения ордера
   */
  recordOrderExecutionTime(executionTimeMs: number): void {
    this.orderExecutionTimes.push(executionTimeMs);
    
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
    
    if (this.trades.length > 1000) {
      this.trades.shift();
    }
    
    this.recordMetric('trade_volume', volume);
    this.recordMetric('trade_profit', profit);
  }

  // ==================== Персистентные метрики ====================

  /**
   * Записать исполнение ордера (в память и в файл)
   */
  async recordOrderExecution(
    orderId: string,
    duration: number,
    success: boolean,
    fee: number = 0,
    volume: number = 0,
    priceImpact?: number,
    error?: string
  ): Promise<void> {
    if (!this.enabled) return;

    // Записываем в in-memory
    this.recordOrderExecutionTime(duration);
    if (fee > 0) this.recordOrderFee(fee);
    if (priceImpact !== undefined) this.recordOrderPriceImpact(priceImpact);
    this.recordMetric('order_count', this.executions.length + 1);

    // Записываем в персистентное хранилище
    const execution: OrderExecutionData = {
      orderId,
      success,
      duration,
      fee,
      volume,
      priceImpact,
      timestamp: Date.now(),
      error
    };

    this.executions.push(execution);
    await this.saveMetrics();

    console.log(`   📊 Recorded execution: ${orderId} (${success ? '✅' : '❌'})`);
  }

  /**
   * Получить метрики ордеров (из in-memory)
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
   * Получить метрики торговли (из in-memory)
   */
  getTradingMetrics(): TradingMetrics {
    const totalVolume = this.trades.reduce((acc, t) => acc + t.volume, 0);
    const totalTrades = this.trades.length;
    const profit = this.trades.reduce((acc, t) => acc + t.profit, 0);
    const avgTradeSize = totalTrades > 0 ? totalVolume / totalTrades : 0;
    
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

  // ==================== Анализ и алерты ====================

  /**
   * Проверить критические ситуации
   */
  checkCriticalSituations(): string[] {
    const alerts: string[] = [];

    // Низкий success rate
    if (this.executions.length >= 10) {
      const successfulOrders = this.executions.filter(e => e.success).length;
      const successRate = (successfulOrders / this.executions.length) * 100;
      
      if (successRate < 50) {
        alerts.push(`⚠️ Low success rate: ${successRate.toFixed(1)}%`);
      }
    }

    // Много неудачных ордеров подряд
    const recentExecutions = this.executions.slice(-10);
    const recentFailures = recentExecutions.filter(e => !e.success).length;
    if (recentFailures >= 7) {
      alerts.push(`🚨 High failure rate: ${recentFailures}/10 recent orders failed`);
    }

    // Высокое среднее время исполнения
    if (this.orderExecutionTimes.length > 0) {
      const avgTime = this.orderExecutionTimes.reduce((a, b) => a + b, 0) / this.orderExecutionTimes.length;
      if (avgTime > 30000) {
        alerts.push(`⚠️ High average execution time: ${(avgTime / 1000).toFixed(1)}s`);
      }
    }

    // Проверка конкретных ошибок
    const errorStats = this.getErrorStats();
    for (const [error, count] of errorStats.entries()) {
      if (count >= 5) {
        alerts.push(`🚨 Frequent error: "${error}" (${count} times)`);
      }
    }

    return alerts;
  }

  /**
   * Получить статистику по типам ошибок
   */
  getErrorStats(): Map<string, number> {
    const errorStats = new Map<string, number>();

    for (const execution of this.executions) {
      if (!execution.success && execution.error) {
        const count = errorStats.get(execution.error) || 0;
        errorStats.set(execution.error, count + 1);
      }
    }

    return errorStats;
  }

  /**
   * Получить тренд success rate за последние N ордеров
   */
  getSuccessRateTrend(lastN: number = 100): number[] {
    const recentExecutions = this.executions.slice(-lastN);
    const trend: number[] = [];

    for (let i = 1; i <= recentExecutions.length; i++) {
      const slice = recentExecutions.slice(0, i);
      const successful = slice.filter(e => e.success).length;
      const rate = (successful / slice.length) * 100;
      trend.push(rate);
    }

    return trend;
  }

  // ==================== Управление данными ====================

  /**
   * Очистить старые данные (персистентные)
   */
  async clearOldData(daysToKeep: number = 30): Promise<void> {
    const cutoffDate = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
    const oldCount = this.executions.length;

    this.executions = this.executions.filter(e => e.timestamp >= cutoffDate);
    
    if (this.executions.length < oldCount) {
      await this.saveMetrics();
      console.log(`   🗑️ Cleared ${oldCount - this.executions.length} old metric records`);
    }
  }

  /**
   * Сбросить все метрики
   */
  async resetMetrics(): Promise<void> {
    this.metrics.clear();
    this.orderExecutionTimes = [];
    this.orderFees = [];
    this.orderPriceImpacts = [];
    this.trades = [];
    this.executions = [];
    this.startTime = Date.now();
    await this.saveMetrics();
    console.log('   🗑️ Metrics reset');
  }

  /**
   * Сохранить метрики в файл
   */
  private async saveMetrics(): Promise<void> {
    if (!this.enabled) return;
    
    try {
      const data = {
        startTime: this.startTime,
        executions: this.executions
      };
      await fs.writeFile(this.metricsFile, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      console.error('   ❌ Error saving metrics:', error);
    }
  }

  /**
   * Вывести метрики в консоль
   */
  printMetrics(): void {
    const totalOrders = this.executions.length;
    const successfulOrders = this.executions.filter(e => e.success);
    const failedOrders = this.executions.filter(e => !e.success);

    const successRate = totalOrders > 0 
      ? (successfulOrders.length / totalOrders) * 100 
      : 0;

    const avgExecutionTime = this.orderExecutionTimes.length > 0
      ? this.orderExecutionTimes.reduce((sum, e) => sum + e, 0) / this.orderExecutionTimes.length
      : 0;

    const avgFee = this.orderFees.length > 0
      ? this.orderFees.reduce((sum, e) => sum + e, 0) / this.orderFees.length
      : 0;

    const avgPriceImpact = this.orderPriceImpacts.length > 0
      ? this.orderPriceImpacts.reduce((sum, e) => sum + e, 0) / this.orderPriceImpacts.length
      : 0;

    const totalVolume = successfulOrders.reduce((sum, e) => e.volume, 0);
    const uptime = Date.now() - this.startTime;
    const uptimeHours = uptime / (1000 * 60 * 60);

    console.log('\n📊 === METRICS ===');
    console.log(`   Total Orders: ${totalOrders}`);
    console.log(`   Success Rate: ${successRate.toFixed(1)}%`);
    console.log(`   Avg Execution Time: ${avgExecutionTime.toFixed(0)}ms`);
    console.log(`   Avg Fee: ${avgFee.toFixed(6)} SOL`);
    console.log(`   Avg Price Impact: ${avgPriceImpact.toFixed(2)}%`);
    console.log(`   Total Volume: ${totalVolume.toFixed(6)} SOL`);
    console.log(`   Uptime: ${uptimeHours.toFixed(2)} hours`);
    
    if (this.executions.length > 0) {
      const lastOrderTime = this.executions[this.executions.length - 1].timestamp;
      const lastOrderAgo = (Date.now() - lastOrderTime) / 1000;
      console.log(`   Last Order: ${lastOrderAgo.toFixed(0)}s ago`);
    }

    if (failedOrders.length > 0) {
      console.log(`   Failed Orders: ${failedOrders.length}`);
    }

    // Проверяем критические ситуации
    const alerts = this.checkCriticalSituations();
    if (alerts.length > 0) {
      console.log('\n🚨 ALERTS:');
      for (const alert of alerts) {
        console.log(`   ${alert}`);
      }
    }

    console.log('==================\n');
  }

  /**
   * Включить/выключить сбор метрик
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Получить размер истории метрик
   */
  getMetricsCount(): number {
    return Array.from(this.metrics.values()).reduce((acc, history) => acc + history.length, 0);
  }
}

// Синглтон для глобального использования
let globalUnifiedMetrics: UnifiedMetrics | null = null;

export function getUnifiedMetrics(): UnifiedMetrics {
  if (!globalUnifiedMetrics) {
    globalUnifiedMetrics = new UnifiedMetrics();
  }
  return globalUnifiedMetrics;
}

export function initUnifiedMetrics(dataDir?: string, enabled?: boolean): UnifiedMetrics {
  globalUnifiedMetrics = new UnifiedMetrics(dataDir, enabled);
  return globalUnifiedMetrics;
}
