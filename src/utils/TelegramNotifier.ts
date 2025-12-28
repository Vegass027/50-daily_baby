/**
 * Система уведомлений через Telegram
 * Отправляет алерты и метрики в Telegram чат
 */

import { Telegraf } from 'telegraf';
import { getMetricsManager, SystemMetrics, OrderMetrics, TradingMetrics } from './Metrics';

export enum AlertLevel {
  INFO = 'ℹ️',
  WARNING = '⚠️',
  ERROR = '❌',
  CRITICAL = '🚨'
}

export interface AlertData {
  level: AlertLevel;
  title: string;
  message: string;
  details?: Record<string, any>;
  timestamp?: number;
}

export interface TelegramNotifierConfig {
  enabled: boolean;
  minLevel?: AlertLevel; // Минимальный уровень для отправки
  rateLimitMs?: number; // Минимальный интервал между отправками
  chatId?: string; // ID чата для отправки (опционально, по умолчанию используется ALLOWED_TELEGRAM_USERS)
}

export class TelegramNotifier {
  private config: TelegramNotifierConfig;
  private lastSentTime: number = 0;
  private pendingAlerts: AlertData[] = [];
  private flushInterval: NodeJS.Timeout | null = null;
  private readonly FLUSH_INTERVAL = 5000; // 5 секунд
  private bot: Telegraf<any> | null = null;

  constructor(config: TelegramNotifierConfig) {
    this.config = {
      ...config,
      enabled: config.enabled ?? true,
      minLevel: config.minLevel ?? AlertLevel.WARNING,
      rateLimitMs: config.rateLimitMs ?? 1000 // 1 секунда по умолчанию
    };
  }

  /**
   * Установить инстанс бота
   */
  setBot(bot: Telegraf<any>): void {
    this.bot = bot;
  }

  /**
   * Отправить алерт
   */
  async sendAlert(alert: AlertData): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    // Проверяем уровень алерта
    if (!this.shouldSendAlert(alert.level)) {
      return;
    }

    // Добавляем в очередь
    this.pendingAlerts.push({
      ...alert,
      timestamp: alert.timestamp ?? Date.now()
    });

    // Если это критический алерт, отправляем сразу
    if (alert.level === AlertLevel.CRITICAL) {
      await this.flushAlerts();
    }
  }

  /**
   * Проверить, нужно ли отправлять алерт по уровню
   */
  private shouldSendAlert(level: AlertLevel): boolean {
    const levels = [AlertLevel.INFO, AlertLevel.WARNING, AlertLevel.ERROR, AlertLevel.CRITICAL];
    const minLevelIndex = levels.indexOf(this.config.minLevel!);
    const currentLevelIndex = levels.indexOf(level);
    return currentLevelIndex >= minLevelIndex;
  }

  /**
   * Отправить все ожидающие алерты
   */
  private async flushAlerts(): Promise<void> {
    if (this.pendingAlerts.length === 0) {
      return;
    }

    // Проверяем rate limit
    const now = Date.now();
    if (now - this.lastSentTime < this.config.rateLimitMs!) {
      return;
    }

    const alerts = [...this.pendingAlerts];
    this.pendingAlerts = [];

    try {
      await this.sendToTelegram(alerts);
      this.lastSentTime = now;
    } catch (error) {
      console.error('Failed to send Telegram alerts:', error);
      // Возвращаем алерты в очередь при ошибке
      this.pendingAlerts.unshift(...alerts);
    }
  }

  /**
   * Отправить алерты в Telegram
   */
  private async sendToTelegram(alerts: AlertData[]): Promise<void> {
    if (!this.bot) {
      throw new Error('Telegram bot is not initialized');
    }

    // Получаем список чатов для отправки
    const chatIds = this.getChatIds();

    for (const chatId of chatIds) {
      for (const alert of alerts) {
        const message = this.formatAlert(alert);
        
        try {
          await this.bot.telegram.sendMessage(chatId, message, {
            parse_mode: 'HTML'
          });
        } catch (error) {
          console.error(`Failed to send alert to chat ${chatId}:`, error);
        }
      }
    }
  }

  /**
   * Получить список чатов для отправки
   */
  private getChatIds(): number[] {
    // Если указан конкретный chatId, используем его
    if (this.config.chatId) {
      return [parseInt(this.config.chatId, 10)];
    }

    // Иначе используем ALLOWED_TELEGRAM_USERS
    const allowedUsers = (process.env.ALLOWED_TELEGRAM_USERS || '')
      .split(',')
      .map(id => parseInt(id.trim(), 10))
      .filter(id => !isNaN(id));

    return allowedUsers;
  }

  /**
   * Форматировать алерт для Telegram
   */
  private formatAlert(alert: AlertData): string {
    const emoji = alert.level;
    const timestamp = new Date(alert.timestamp!).toLocaleString('ru-RU');
    
    let message = `<b>${emoji} ${alert.title}</b>\n`;
    message += `<i>${alert.message}</i>\n`;
    message += `<code>${timestamp}</code>\n`;

    if (alert.details) {
      message += '\n<b>Детали:</b>\n';
      for (const [key, value] of Object.entries(alert.details)) {
        const formattedValue = typeof value === 'object' 
          ? JSON.stringify(value, null, 2)
          : String(value);
        message += `• <b>${key}:</b> <code>${formattedValue}</code>\n`;
      }
    }

    return message;
  }

  /**
   * Отправить отчет о метриках
   */
  async sendMetricsReport(metrics: {
    system: SystemMetrics;
    orders: OrderMetrics;
    trading: TradingMetrics;
  }): Promise<void> {
    if (!this.config.enabled || !this.bot) {
      return;
    }

    const message = this.formatMetricsReport(metrics);
    const chatIds = this.getChatIds();

    for (const chatId of chatIds) {
      try {
        await this.bot.telegram.sendMessage(chatId, message, {
          parse_mode: 'HTML'
        });
      } catch (error) {
        console.error(`Failed to send metrics to chat ${chatId}:`, error);
      }
    }
  }

  /**
   * Форматировать отчет о метриках
   */
  private formatMetricsReport(metrics: {
    system: SystemMetrics;
    orders: OrderMetrics;
    trading: TradingMetrics;
  }): string {
    const uptime = this.formatUptime(metrics.system.uptime);
    
    let message = `<b>📊 Отчет о метриках</b>\n\n`;
    
    // Системные метрики
    message += `<b>🖥️ Система:</b>\n`;
    message += `• Uptime: <code>${uptime}</code>\n`;
    message += `• Память: <code>${metrics.system.memoryUsage.toFixed(2)} MB</code>\n`;
    message += `• CPU: <code>${metrics.system.cpuUsage.toFixed(2)}%</code>\n`;
    message += `• Активных ордеров: <code>${metrics.system.activeOrders}</code>\n`;
    message += `• Активных блокировок: <code>${metrics.system.activeLocks}</code>\n\n`;
    
    // Метрики ордеров
    message += `<b>📋 Ордера:</b>\n`;
    message += `• Всего: <code>${metrics.orders.total}</code>\n`;
    message += `• Ожидают: <code>${metrics.orders.pending}</code>\n`;
    message += `• Исполнено: <code>${metrics.orders.filled}</code>\n`;
    message += `• Отменено: <code>${metrics.orders.cancelled}</code>\n`;
    message += `• Ошибок: <code>${metrics.orders.error}</code>\n`;
    message += `• Success Rate: <code>${metrics.orders.successRate.toFixed(2)}%</code>\n`;
    message += `• Среднее время исполнения: <code>${metrics.orders.avgExecutionTime.toFixed(0)}ms</code>\n`;
    message += `• Средняя комиссия: <code>${metrics.orders.avgFee.toFixed(6)} SOL</code>\n\n`;
    
    // Метрики торговли
    message += `<b>💱 Торговля:</b>\n`;
    message += `• Общий объем: <code>${metrics.trading.totalVolume.toFixed(6)} SOL</code>\n`;
    message += `• Количество сделок: <code>${metrics.trading.totalTrades}</code>\n`;
    message += `• Прибыль: <code>${metrics.trading.profit.toFixed(6)} SOL</code>\n`;
    message += `• Прибыль %: <code>${metrics.trading.profitPercent.toFixed(2)}%</code>\n`;
    message += `• Средний размер сделки: <code>${metrics.trading.avgTradeSize.toFixed(6)} SOL</code>\n`;

    return message;
  }

  /**
   * Отправить health check отчет
   */
  async sendHealthCheckReport(healthStatus: {
    status: 'healthy' | 'degraded' | 'unhealthy';
    checks: any;
  }): Promise<void> {
    if (!this.config.enabled || !this.bot) {
      return;
    }

    const message = this.formatHealthCheckReport(healthStatus);
    const chatIds = this.getChatIds();

    for (const chatId of chatIds) {
      try {
        await this.bot.telegram.sendMessage(chatId, message, {
          parse_mode: 'HTML'
        });
      } catch (error) {
        console.error(`Failed to send health check to chat ${chatId}:`, error);
      }
    }
  }

  /**
   * Форматировать health check отчет
   */
  private formatHealthCheckReport(healthStatus: {
    status: 'healthy' | 'degraded' | 'unhealthy';
    checks: any;
  }): string {
    const emoji = healthStatus.status === 'healthy' ? '✅' 
                : healthStatus.status === 'degraded' ? '⚠️' 
                : '🚨';
    
    let message = `<b>${emoji} Health Check</b>\n`;
    message += `<b>Статус:</b> <code>${healthStatus.status.toUpperCase()}</code>\n\n`;
    
    message += `<b>Проверки:</b>\n`;
    for (const [name, check] of Object.entries(healthStatus.checks)) {
      const checkObj = check as { status: 'pass' | 'warn' | 'fail'; message: string; details?: Record<string, any> };
      const checkStatus = checkObj.status;
      const statusEmoji = checkStatus === 'pass' ? '✅'
                        : checkStatus === 'warn' ? '⚠️'
                        : '❌';
      message += `• ${statusEmoji} <b>${name}:</b> <code>${checkObj.message}</code>\n`;
      
      if (checkObj.details) {
        for (const [key, value] of Object.entries(checkObj.details)) {
          const formattedValue = typeof value === 'object'
            ? JSON.stringify(value, null, 2)
            : String(value);
          message += `  - <b>${key}:</b> <code>${formattedValue}</code>\n`;
        }
      }
    }

    return message;
  }

  /**
   * Форматировать uptime
   */
  private formatUptime(seconds: number): string {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    const parts = [];
    if (days > 0) parts.push(`${days}д`);
    if (hours > 0) parts.push(`${hours}ч`);
    if (minutes > 0) parts.push(`${minutes}м`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}с`);

    return parts.join(' ');
  }

  /**
   * Запустить автоматическую отправку алертов
   */
  startAutoFlush(): void {
    if (this.flushInterval) {
      return;
    }

    this.flushInterval = setInterval(() => {
      this.flushAlerts();
    }, this.FLUSH_INTERVAL);
  }

  /**
   * Остановить автоматическую отправку алертов
   */
  stopAutoFlush(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
  }

  /**
   * Очистить все ожидающие алерты
   */
  clearPendingAlerts(): void {
    this.pendingAlerts = [];
  }

  /**
   * Получить количество ожидающих алертов
   */
  getPendingAlertsCount(): number {
    return this.pendingAlerts.length;
  }
}

// Синглтон для глобального использования
let globalTelegramNotifier: TelegramNotifier | null = null;

export function getTelegramNotifier(): TelegramNotifier {
  if (!globalTelegramNotifier) {
    globalTelegramNotifier = new TelegramNotifier({
      enabled: true,
      minLevel: AlertLevel.WARNING,
      rateLimitMs: 1000
    });
  }
  return globalTelegramNotifier;
}
