import * as fs from 'fs/promises';
import * as path from 'path';

export interface OrderMetrics {
  totalOrders: number;
  successRate: number;
  avgExecutionTime: number;
  avgFee: number;
  avgPriceImpact: number;
  totalVolume: number;
  failedOrders: string[];
  uptime: number;
  lastOrderTime?: number;
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
 * Класс для сбора и анализа метрик
 */
export class MetricsCollector {
  private metricsFile: string;
  private executions: OrderExecutionData[] = [];
  private startTime: number;
  private enabled: boolean;

  constructor(dataDir: string = './data', enabled: boolean = true) {
    this.metricsFile = path.join(dataDir, 'metrics.json');
    this.startTime = Date.now();
    this.enabled = enabled;
  }

  /**
   * Инициализация коллектора
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

  /**
   * Записать исполнение ордера
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
   * Получить текущие метрики
   */
  getMetrics(): OrderMetrics {
    const totalOrders = this.executions.length;
    const successfulOrders = this.executions.filter(e => e.success);
    const failedOrders = this.executions.filter(e => !e.success);

    const successRate = totalOrders > 0 
      ? (successfulOrders.length / totalOrders) * 100 
      : 0;

    const avgExecutionTime = successfulOrders.length > 0
      ? successfulOrders.reduce((sum, e) => sum + e.duration, 0) / successfulOrders.length
      : 0;

    const avgFee = successfulOrders.length > 0
      ? successfulOrders.reduce((sum, e) => sum + e.fee, 0) / successfulOrders.length
      : 0;

    const avgPriceImpact = successfulOrders.length > 0 &&
      successfulOrders.some(e => e.priceImpact !== undefined)
      ? successfulOrders
          .filter(e => e.priceImpact !== undefined)
          .reduce((sum, e) => sum + (e.priceImpact || 0), 0) /
          successfulOrders.filter(e => e.priceImpact !== undefined).length
      : 0;

    const totalVolume = successfulOrders.reduce((sum, e) => sum + e.volume, 0);

    const failedOrderIds = failedOrders.map(e => e.orderId);
    const lastOrderTime = this.executions.length > 0
      ? this.executions[this.executions.length - 1].timestamp
      : undefined;

    const uptime = Date.now() - this.startTime;

    return {
      totalOrders,
      successRate,
      avgExecutionTime,
      avgFee,
      avgPriceImpact,
      totalVolume,
      failedOrders: failedOrderIds,
      uptime,
      lastOrderTime
    };
  }

  /**
   * Получить метрики за период
   */
  getMetricsForPeriod(startTime: number, endTime: number): OrderMetrics {
    const periodExecutions = this.executions.filter(
      e => e.timestamp >= startTime && e.timestamp <= endTime
    );

    const totalOrders = periodExecutions.length;
    const successfulOrders = periodExecutions.filter(e => e.success);
    const failedOrders = periodExecutions.filter(e => !e.success);

    const successRate = totalOrders > 0 
      ? (successfulOrders.length / totalOrders) * 100 
      : 0;

    const avgExecutionTime = successfulOrders.length > 0
      ? successfulOrders.reduce((sum, e) => sum + e.duration, 0) / successfulOrders.length
      : 0;

    const avgFee = successfulOrders.length > 0
      ? successfulOrders.reduce((sum, e) => sum + e.fee, 0) / successfulOrders.length
      : 0;

    const avgPriceImpact = successfulOrders.length > 0 &&
      successfulOrders.some(e => e.priceImpact !== undefined)
      ? successfulOrders
          .filter(e => e.priceImpact !== undefined)
          .reduce((sum, e) => sum + (e.priceImpact || 0), 0) /
          successfulOrders.filter(e => e.priceImpact !== undefined).length
      : 0;

    const totalVolume = successfulOrders.reduce((sum, e) => sum + e.volume, 0);

    const failedOrderIds = failedOrders.map(e => e.orderId);
    const lastOrderTime = periodExecutions.length > 0
      ? periodExecutions[periodExecutions.length - 1].timestamp
      : undefined;

    const uptime = endTime - startTime;

    return {
      totalOrders,
      successRate,
      avgExecutionTime,
      avgFee,
      avgPriceImpact,
      totalVolume,
      failedOrders: failedOrderIds,
      uptime,
      lastOrderTime
    };
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

  /**
   * Проверить критические ситуации
   */
  checkCriticalSituations(): string[] {
    const alerts: string[] = [];
    const metrics = this.getMetrics();

    // Низкий success rate
    if (metrics.successRate < 50 && metrics.totalOrders >= 10) {
      alerts.push(`⚠️ Low success rate: ${metrics.successRate.toFixed(1)}%`);
    }

    // Много неудачных ордеров подряд
    const recentExecutions = this.executions.slice(-10);
    const recentFailures = recentExecutions.filter(e => !e.success).length;
    if (recentFailures >= 7) {
      alerts.push(`🚨 High failure rate: ${recentFailures}/10 recent orders failed`);
    }

    // Высокое среднее время исполнения
    if (metrics.avgExecutionTime > 30000) { // > 30 секунд
      alerts.push(`⚠️ High average execution time: ${(metrics.avgExecutionTime / 1000).toFixed(1)}s`);
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
   * Очистить старые данные
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
   * Сбросить метрики
   */
  async resetMetrics(): Promise<void> {
    this.executions = [];
    this.startTime = Date.now();
    await this.saveMetrics();
    console.log('   🗑️ Metrics reset');
  }

  /**
   * Сохранить метрики в файл
   */
  private async saveMetrics(): Promise<void> {
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
    const metrics = this.getMetrics();
    const uptimeHours = metrics.uptime / (1000 * 60 * 60);
 
    console.log('\n📊 === METRICS ===');
    console.log(`   Total Orders: ${metrics.totalOrders}`);
    console.log(`   Success Rate: ${metrics.successRate.toFixed(1)}%`);
    console.log(`   Avg Execution Time: ${metrics.avgExecutionTime.toFixed(0)}ms`);
    console.log(`   Avg Fee: ${metrics.avgFee.toFixed(6)} SOL`);
    console.log(`   Avg Price Impact: ${metrics.avgPriceImpact.toFixed(2)}%`);
    console.log(`   Total Volume: ${metrics.totalVolume.toFixed(6)} SOL`);
    console.log(`   Uptime: ${uptimeHours.toFixed(2)} hours`);
    
    if (metrics.lastOrderTime) {
      const lastOrderAgo = (Date.now() - metrics.lastOrderTime) / 1000;
      console.log(`   Last Order: ${lastOrderAgo.toFixed(0)}s ago`);
    }

    if (metrics.failedOrders.length > 0) {
      console.log(`   Failed Orders: ${metrics.failedOrders.length}`);
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
}

// Singleton instance
let metricsInstance: MetricsCollector | null = null;

/**
 * Получить инстанс коллектора метрик
 */
export function getMetricsCollector(): MetricsCollector {
  if (!metricsInstance) {
    metricsInstance = new MetricsCollector();
  }
  return metricsInstance;
}

/**
 * Инициализировать коллектор метрик с настройками
 */
export function initMetricsCollector(dataDir?: string, enabled?: boolean): MetricsCollector {
  metricsInstance = new MetricsCollector(dataDir, enabled);
  return metricsInstance;
}
