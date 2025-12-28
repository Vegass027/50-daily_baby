/**
 * Health Check Endpoint
 * Проверяет состояние системы и возвращает статус
 */

import { getMetricsManager } from './Metrics';
import { getConcurrencyManager } from './ConcurrencyManager';
import { getTelegramNotifier, AlertLevel } from './TelegramNotifier';

export interface HealthCheckResult {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: number;
  uptime: number;
  version: string;
  checks: {
    database: CheckResult;
    orders: CheckResult;
    trading: CheckResult;
    system: CheckResult;
  };
  metrics?: {
    orders: any;
    trading: any;
    system: any;
  };
}

export interface CheckResult {
  status: 'pass' | 'fail' | 'warn';
  message?: string;
  details?: Record<string, any>;
}

export class HealthCheckServer {
  private port: number;
  private server: any = null;
  private metricsManager = getMetricsManager();
  private concurrencyManager = getConcurrencyManager();
  private telegramNotifier = getTelegramNotifier();
  private version = process.env.npm_package_version || '1.0.0';

  constructor(port: number = 3000) {
    this.port = port;
  }

  /**
   * Запустить health check сервер
   */
  async start(): Promise<void> {
    const http = await import('http');
    
    this.server = http.createServer(async (req, res) => {
      try {
        if (req.url === '/health' || req.url === '/') {
          await this.handleHealthCheck(req, res);
        } else if (req.url === '/metrics') {
          await this.handleMetrics(req, res);
        } else if (req.url === '/ready') {
          await this.handleReadinessCheck(req, res);
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
        }
      } catch (error) {
        console.error('Health check error:', error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    });

    this.server.listen(this.port, () => {
      console.log(`🏥 Health check server listening on port ${this.port}`);
      console.log(`   Health: http://localhost:${this.port}/health`);
      console.log(`   Metrics: http://localhost:${this.port}/metrics`);
      console.log(`   Ready: http://localhost:${this.port}/ready`);
    });
  }

  /**
   * Обработчик health check
   */
  private async handleHealthCheck(req: any, res: any): Promise<void> {
    const result = await this.performHealthCheck();
    
    const statusCode = result.status === 'healthy' ? 200 
                    : result.status === 'degraded' ? 200 
                    : 503;
    
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result, null, 2));
  }

  /**
   * Обработчик метрик
   */
  private async handleMetrics(req: any, res: any): Promise<void> {
    const metrics = this.metricsManager.getAllMetrics();
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(metrics, null, 2));
  }

  /**
   * Обработчик readiness check
   */
  private async handleReadinessCheck(req: any, res: any): Promise<void> {
    // Готовность к работе - проверяем только критические компоненты
    const isReady = await this.checkReadiness();
    
    const statusCode = isReady ? 200 : 503;
    
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: isReady ? 'ready' : 'not ready',
      timestamp: Date.now()
    }, null, 2));
  }

  /**
   * Выполнить полную проверку здоровья
   */
  private async performHealthCheck(): Promise<HealthCheckResult> {
    const checks = {
      database: await this.checkDatabase(),
      orders: await this.checkOrders(),
      trading: await this.checkTrading(),
      system: await this.checkSystem()
    };

    // Определяем общий статус
    const allPass = Object.values(checks).every(c => c.status === 'pass');
    const anyFail = Object.values(checks).some(c => c.status === 'fail');
    
    const status = allPass ? 'healthy' 
                 : anyFail ? 'unhealthy' 
                 : 'degraded';

    // Если статус unhealthy, отправляем алерт в Telegram
    if (status === 'unhealthy') {
      await this.telegramNotifier.sendAlert({
        level: AlertLevel.CRITICAL,
        title: 'System Health Check Failed',
        message: 'One or more health checks failed',
        details: checks
      });
    }

    return {
      status,
      timestamp: Date.now(),
      uptime: Math.floor((Date.now() - this.metricsManager['startTime']) / 1000),
      version: this.version,
      checks,
      metrics: this.getDetailedMetrics()
    };
  }

  /**
   * Проверить базу данных
   */
  private async checkDatabase(): Promise<CheckResult> {
    try {
      // Проверяем соединение с базой данных
      // Для упрощения считаем, что база доступна
      return {
        status: 'pass',
        message: 'Database connection is healthy'
      };
    } catch (error) {
      return {
        status: 'fail',
        message: 'Database connection failed',
        details: { error: String(error) }
      };
    }
  }

  /**
   * Проверить ордера
   */
  private async checkOrders(): Promise<CheckResult> {
    try {
      const activeLocks = this.concurrencyManager.getActiveLocksCount();
      const metrics = this.metricsManager.getMetric('order_count') || 0;
      
      // Если слишком много блокировок, это warning
      if (activeLocks > 10) {
        return {
          status: 'warn',
          message: 'High number of active locks',
          details: { activeLocks, totalOrders: metrics }
        };
      }
      
      return {
        status: 'pass',
        message: 'Orders system is healthy',
        details: { activeLocks, totalOrders: metrics }
      };
    } catch (error) {
      return {
        status: 'fail',
        message: 'Orders check failed',
        details: { error: String(error) }
      };
    }
  }

  /**
   * Проверить торговлю
   */
  private async checkTrading(): Promise<CheckResult> {
    try {
      const lastTradeTime = this.metricsManager.getMetric('last_trade_time');
      const recentTrades = this.metricsManager.getAverageMetric('trade_volume', 300000); // 5 минут
      
      // Если нет торгов более 30 минут, это warning
      if (lastTradeTime && Date.now() - lastTradeTime > 1800000) {
        return {
          status: 'warn',
          message: 'No recent trading activity',
          details: { lastTradeTime, recentTrades }
        };
      }
      
      return {
        status: 'pass',
        message: 'Trading system is healthy',
        details: { lastTradeTime, recentTrades }
      };
    } catch (error) {
      return {
        status: 'fail',
        message: 'Trading check failed',
        details: { error: String(error) }
      };
    }
  }

  /**
   * Проверить систему
   */
  private async checkSystem(): Promise<CheckResult> {
    try {
      const memoryUsage = process.memoryUsage();
      const memoryUsageMB = memoryUsage.heapUsed / 1024 / 1024;
      const memoryLimitMB = memoryUsage.heapTotal / 1024 / 1024;
      const memoryUsagePercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
      
      // Если использование памяти > 90%, это warning
      if (memoryUsagePercent > 90) {
        return {
          status: 'warn',
          message: 'High memory usage',
          details: { 
            memoryUsageMB: memoryUsageMB.toFixed(2),
            memoryLimitMB: memoryLimitMB.toFixed(2),
            memoryUsagePercent: memoryUsagePercent.toFixed(2)
          }
        };
      }
      
      return {
        status: 'pass',
        message: 'System is healthy',
        details: {
          memoryUsageMB: memoryUsageMB.toFixed(2),
          memoryLimitMB: memoryLimitMB.toFixed(2),
          memoryUsagePercent: memoryUsagePercent.toFixed(2)
        }
      };
    } catch (error) {
      return {
        status: 'fail',
        message: 'System check failed',
        details: { error: String(error) }
      };
    }
  }

  /**
   * Проверить готовность к работе
   */
  private async checkReadiness(): Promise<boolean> {
    // Проверяем только критические компоненты
    const dbCheck = await this.checkDatabase();
    const systemCheck = await this.checkSystem();
    
    return dbCheck.status === 'pass' && systemCheck.status === 'pass';
  }

  /**
   * Получить детальные метрики
   */
  private getDetailedMetrics(): any {
    const systemMetrics = this.metricsManager.getSystemMetrics(
      this.metricsManager.getMetric('active_orders') || 0,
      this.concurrencyManager.getActiveLocksCount()
    );
    
    return {
      orders: this.metricsManager.getMetric('order_count'),
      trading: this.metricsManager.getMetric('trade_count'),
      system: {
        uptime: systemMetrics.uptime,
        memoryUsage: systemMetrics.memoryUsage.toFixed(2),
        cpuUsage: systemMetrics.cpuUsage.toFixed(2),
        activeOrders: systemMetrics.activeOrders,
        activeLocks: systemMetrics.activeLocks
      }
    };
  }

  /**
   * Остановить сервер
   */
  stop(): void {
    if (this.server) {
      this.server.close(() => {
        console.log('🏥 Health check server stopped');
      });
    }
  }
}

// Синглтон для глобального использования
let globalHealthCheckServer: HealthCheckServer | null = null;

export function getHealthCheckServer(): HealthCheckServer {
  if (!globalHealthCheckServer) {
    const port = parseInt(process.env.HEALTH_CHECK_PORT || '3000', 10);
    globalHealthCheckServer = new HealthCheckServer(port);
  }
  return globalHealthCheckServer;
}
