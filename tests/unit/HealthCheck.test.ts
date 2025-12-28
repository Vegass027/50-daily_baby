/**
 * Unit Tests для HealthCheck
 * Тестирует проверку здоровья системы и метрики
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { HealthCheckServer, HealthCheckResult, CheckResult } from '../../src/utils/HealthCheck';
import http from 'http';

// Mock dependencies
jest.mock('../../src/utils/Metrics', () => ({
  getMetricsManager: jest.fn(() => ({
    getAllMetrics: jest.fn(() => ({
      order_count: 10,
      trade_count: 5,
      active_orders: 3
    })),
    getMetric: jest.fn((key: string) => {
      const metrics: Record<string, any> = {
        order_count: 10,
        trade_count: 5,
        active_orders: 3,
        last_trade_time: Date.now() - 100000
      };
      return metrics[key];
    }),
    getAverageMetric: jest.fn(() => 1000),
    getSystemMetrics: jest.fn(() => ({
      uptime: 3600,
      memoryUsage: 100.5,
      cpuUsage: 50.2,
      activeOrders: 3,
      activeLocks: 2
    })),
    startTime: Date.now() - 3600000
  }))
}));

jest.mock('../../src/utils/ConcurrencyManager', () => ({
  getConcurrencyManager: jest.fn(() => ({
    getActiveLocksCount: jest.fn(() => 2),
    getActiveLocks: jest.fn(() => ['lock1', 'lock2'])
  }))
}));

jest.mock('../../src/utils/TelegramNotifier', () => ({
  getTelegramNotifier: jest.fn(() => ({
    sendAlert: jest.fn()
  })),
  AlertLevel: {
    CRITICAL: 'critical',
    WARNING: 'warning',
    INFO: 'info'
  }
}));

jest.mock('http', () => ({
  createServer: jest.fn()
}));

describe('HealthCheckServer', () => {
  let healthCheckServer: HealthCheckServer;
  let mockServer: any;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.HEALTH_CHECK_PORT = '3001';

    // Mock server
    mockServer = {
      listen: jest.fn((port, callback) => callback()),
      close: jest.fn((callback) => callback())
    };
    (http.createServer as jest.Mock).mockReturnValue(mockServer);

    healthCheckServer = new HealthCheckServer(3001);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('constructor', () => {
    it('должен создать экземпляр с указанным портом', () => {
      // Act
      const server = new HealthCheckServer(4000);

      // Assert
      expect(server).toBeInstanceOf(HealthCheckServer);
    });

    it('должен использовать порт из переменной окружения по умолчанию', () => {
      // Arrange
      delete process.env.HEALTH_CHECK_PORT;

      // Act
      const server = new HealthCheckServer();

      // Assert
      expect(server).toBeInstanceOf(HealthCheckServer);
    });
  });

  describe('start', () => {
    it('должен запустить HTTP сервер', async () => {
      // Act
      await healthCheckServer.start();

      // Assert
      expect(http.createServer).toHaveBeenCalled();
      expect(mockServer.listen).toHaveBeenCalledWith(3001, expect.any(Function));
    });

    it('должен обрабатывать /health endpoint', async () => {
      // Arrange
      let requestHandler: any;
      (http.createServer as jest.Mock).mockImplementation((handler) => {
        requestHandler = handler;
        return mockServer;
      });

      await healthCheckServer.start();

      const mockReq = { url: '/health' };
      const mockRes = {
        writeHead: jest.fn(),
        end: jest.fn()
      };

      // Act
      await requestHandler(mockReq, mockRes);

      // Assert
      expect(mockRes.writeHead).toHaveBeenCalled();
      expect(mockRes.end).toHaveBeenCalled();
    });

    it('должен обрабатывать /metrics endpoint', async () => {
      // Arrange
      let requestHandler: any;
      (http.createServer as jest.Mock).mockImplementation((handler) => {
        requestHandler = handler;
        return mockServer;
      });

      await healthCheckServer.start();

      const mockReq = { url: '/metrics' };
      const mockRes = {
        writeHead: jest.fn(),
        end: jest.fn()
      };

      // Act
      await requestHandler(mockReq, mockRes);

      // Assert
      expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalled();
    });

    it('должен обрабатывать /ready endpoint', async () => {
      // Arrange
      let requestHandler: any;
      (http.createServer as jest.Mock).mockImplementation((handler) => {
        requestHandler = handler;
        return mockServer;
      });

      await healthCheckServer.start();

      const mockReq = { url: '/ready' };
      const mockRes = {
        writeHead: jest.fn(),
        end: jest.fn()
      };

      // Act
      await requestHandler(mockReq, mockRes);

      // Assert
      expect(mockRes.writeHead).toHaveBeenCalled();
      expect(mockRes.end).toHaveBeenCalled();
    });

    it('должен возвращать 404 для неизвестных endpoint', async () => {
      // Arrange
      let requestHandler: any;
      (http.createServer as jest.Mock).mockImplementation((handler) => {
        requestHandler = handler;
        return mockServer;
      });

      await healthCheckServer.start();

      const mockReq = { url: '/unknown' };
      const mockRes = {
        writeHead: jest.fn(),
        end: jest.fn()
      };

      // Act
      await requestHandler(mockReq, mockRes);

      // Assert
      expect(mockRes.writeHead).toHaveBeenCalledWith(404, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({ error: 'Not found' }));
    });

    it('должен обрабатывать ошибки gracefully', async () => {
      // Arrange
      let requestHandler: any;
      (http.createServer as jest.Mock).mockImplementation((handler) => {
        requestHandler = () => {
          throw new Error('Test error');
        };
        return mockServer;
      });

      await healthCheckServer.start();

      const mockReq = { url: '/health' };
      const mockRes = {
        writeHead: jest.fn(),
        end: jest.fn()
      };

      // Act
      await requestHandler(mockReq, mockRes);

      // Assert
      expect(mockRes.writeHead).toHaveBeenCalledWith(500, { 'Content-Type': 'application/json' });
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({ error: 'Internal server error' }));
    });
  });

  describe('stop', () => {
    it('должен остановить сервер', () => {
      // Act
      healthCheckServer.stop();

      // Assert
      expect(mockServer.close).toHaveBeenCalled();
    });

    it('должен работать без ошибок если сервер не запущен', () => {
      // Arrange
      const server = new HealthCheckServer();

      // Act & Assert - не должно выбросить ошибку
      expect(() => server.stop()).not.toThrow();
    });
  });

  describe('health check logic', () => {
    it('должен возвращать healthy статус когда все проверки пройдены', async () => {
      // Arrange
      let requestHandler: any;
      (http.createServer as jest.Mock).mockImplementation((handler) => {
        requestHandler = handler;
        return mockServer;
      });

      await healthCheckServer.start();

      const mockReq = { url: '/health' };
      const mockRes = {
        writeHead: jest.fn(),
        end: jest.fn()
      };

      // Act
      await requestHandler(mockReq, mockRes);

      // Assert
      const response = JSON.parse(mockRes.end.mock.calls[0][0]);
      expect(response.status).toBe('healthy');
      expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
    });

    it('должен возвращать degraded статус когда есть warnings', async () => {
      // Arrange
      const { getConcurrencyManager } = require('../../src/utils/ConcurrencyManager');
      getConcurrencyManager.mockReturnValue({
        getActiveLocksCount: jest.fn(() => 15), // > 10 triggers warning
        getActiveLocks: jest.fn(() => Array(15).fill('lock'))
      });

      let requestHandler: any;
      (http.createServer as jest.Mock).mockImplementation((handler) => {
        requestHandler = handler;
        return mockServer;
      });

      await healthCheckServer.start();

      const mockReq = { url: '/health' };
      const mockRes = {
        writeHead: jest.fn(),
        end: jest.fn()
      };

      // Act
      await requestHandler(mockReq, mockRes);

      // Assert
      const response = JSON.parse(mockRes.end.mock.calls[0][0]);
      expect(response.status).toBe('degraded');
      expect(response.checks.orders.status).toBe('warn');
    });

    it('должен возвращать unhealthy статус когда есть failures', async () => {
      // Arrange
      const { getMetricsManager } = require('../../src/utils/Metrics');
      getMetricsManager.mockReturnValue({
        getAllMetrics: jest.fn(() => {
          throw new Error('Metrics error');
        }),
        getMetric: jest.fn(() => {
          throw new Error('Error');
        }),
        getAverageMetric: jest.fn(() => 1000),
        getSystemMetrics: jest.fn(() => ({
          uptime: 3600,
          memoryUsage: 100.5,
          cpuUsage: 50.2,
          activeOrders: 3,
          activeLocks: 2
        })),
        startTime: Date.now() - 3600000
      });

      let requestHandler: any;
      (http.createServer as jest.Mock).mockImplementation((handler) => {
        requestHandler = handler;
        return mockServer;
      });

      await healthCheckServer.start();

      const mockReq = { url: '/health' };
      const mockRes = {
        writeHead: jest.fn(),
        end: jest.fn()
      };

      // Act
      await requestHandler(mockReq, mockRes);

      // Assert
      const response = JSON.parse(mockRes.end.mock.calls[0][0]);
      expect(response.status).toBe('unhealthy');
      expect(mockRes.writeHead).toHaveBeenCalledWith(503, { 'Content-Type': 'application/json' });
    });

    it('должен отправлять алерт в Telegram при unhealthy статусе', async () => {
      // Arrange
      const { getMetricsManager } = require('../../src/utils/Metrics');
      getMetricsManager.mockReturnValue({
        getAllMetrics: jest.fn(() => {
          throw new Error('Critical error');
        }),
        getMetric: jest.fn(() => {
          throw new Error('Error');
        }),
        getAverageMetric: jest.fn(() => 1000),
        getSystemMetrics: jest.fn(() => ({
          uptime: 3600,
          memoryUsage: 100.5,
          cpuUsage: 50.2,
          activeOrders: 3,
          activeLocks: 2
        })),
        startTime: Date.now() - 3600000
      });

      const { getTelegramNotifier } = require('../../src/utils/TelegramNotifier');
      const mockNotifier = {
        sendAlert: jest.fn()
      };
      getTelegramNotifier.mockReturnValue(mockNotifier);

      let requestHandler: any;
      (http.createServer as jest.Mock).mockImplementation((handler) => {
        requestHandler = handler;
        return mockServer;
      });

      await healthCheckServer.start();

      const mockReq = { url: '/health' };
      const mockRes = {
        writeHead: jest.fn(),
        end: jest.fn()
      };

      // Act
      await requestHandler(mockReq, mockRes);

      // Assert
      expect(mockNotifier.sendAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'critical',
          title: 'System Health Check Failed'
        })
      );
    });
  });

  describe('readiness check', () => {
    it('должен возвращать ready когда критические компоненты доступны', async () => {
      // Arrange
      let requestHandler: any;
      (http.createServer as jest.Mock).mockImplementation((handler) => {
        requestHandler = handler;
        return mockServer;
      });

      await healthCheckServer.start();

      const mockReq = { url: '/ready' };
      const mockRes = {
        writeHead: jest.fn(),
        end: jest.fn()
      };

      // Act
      await requestHandler(mockReq, mockRes);

      // Assert
      const response = JSON.parse(mockRes.end.mock.calls[0][0]);
      expect(response.status).toBe('ready');
      expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
    });

    it('должен возвращать not ready когда критические компоненты недоступны', async () => {
      // Arrange
      const { getMetricsManager } = require('../../src/utils/Metrics');
      getMetricsManager.mockReturnValue({
        getAllMetrics: jest.fn(() => {
          throw new Error('Database error');
        }),
        getMetric: jest.fn(() => {
          throw new Error('Error');
        }),
        getAverageMetric: jest.fn(() => 1000),
        getSystemMetrics: jest.fn(() => ({
          uptime: 3600,
          memoryUsage: 100.5,
          cpuUsage: 50.2,
          activeOrders: 3,
          activeLocks: 2
        })),
        startTime: Date.now() - 3600000
      });

      let requestHandler: any;
      (http.createServer as jest.Mock).mockImplementation((handler) => {
        requestHandler = handler;
        return mockServer;
      });

      await healthCheckServer.start();

      const mockReq = { url: '/ready' };
      const mockRes = {
        writeHead: jest.fn(),
        end: jest.fn()
      };

      // Act
      await requestHandler(mockReq, mockRes);

      // Assert
      const response = JSON.parse(mockRes.end.mock.calls[0][0]);
      expect(response.status).toBe('not ready');
      expect(mockRes.writeHead).toHaveBeenCalledWith(503, { 'Content-Type': 'application/json' });
    });
  });

  describe('metrics endpoint', () => {
    it('должен возвращать все метрики', async () => {
      // Arrange
      let requestHandler: any;
      (http.createServer as jest.Mock).mockImplementation((handler) => {
        requestHandler = handler;
        return mockServer;
      });

      await healthCheckServer.start();

      const mockReq = { url: '/metrics' };
      const mockRes = {
        writeHead: jest.fn(),
        end: jest.fn()
      };

      // Act
      await requestHandler(mockReq, mockRes);

      // Assert
      const response = JSON.parse(mockRes.end.mock.calls[0][0]);
      expect(response).toHaveProperty('order_count');
      expect(response).toHaveProperty('trade_count');
      expect(response).toHaveProperty('active_orders');
    });
  });

  describe('system checks', () => {
    it('должен проверять использование памяти', async () => {
      // Arrange
      let requestHandler: any;
      (http.createServer as jest.Mock).mockImplementation((handler) => {
        requestHandler = handler;
        return mockServer;
      });

      await healthCheckServer.start();

      const mockReq = { url: '/health' };
      const mockRes = {
        writeHead: jest.fn(),
        end: jest.fn()
      };

      // Act
      await requestHandler(mockReq, mockRes);

      // Assert
      const response = JSON.parse(mockRes.end.mock.calls[0][0]);
      expect(response.checks.system).toBeDefined();
      expect(response.checks.system.status).toBe('pass');
      expect(response.checks.system.details).toHaveProperty('memoryUsageMB');
      expect(response.checks.system.details).toHaveProperty('memoryLimitMB');
      expect(response.checks.system.details).toHaveProperty('memoryUsagePercent');
    });

    it('должен возвращать warning при высоком использовании памяти', async () => {
      // Arrange
      const { getMetricsManager } = require('../../src/utils/Metrics');
      getMetricsManager.mockReturnValue({
        getAllMetrics: jest.fn(() => ({})),
        getMetric: jest.fn(() => 0),
        getAverageMetric: jest.fn(() => 0),
        getSystemMetrics: jest.fn(() => ({
          uptime: 3600,
          memoryUsage: 95.5, // > 90% triggers warning
          cpuUsage: 50.2,
          activeOrders: 3,
          activeLocks: 2
        })),
        startTime: Date.now() - 3600000
      });

      let requestHandler: any;
      (http.createServer as jest.Mock).mockImplementation((handler) => {
        requestHandler = handler;
        return mockServer;
      });

      await healthCheckServer.start();

      const mockReq = { url: '/health' };
      const mockRes = {
        writeHead: jest.fn(),
        end: jest.fn()
      };

      // Act
      await requestHandler(mockReq, mockRes);

      // Assert
      const response = JSON.parse(mockRes.end.mock.calls[0][0]);
      expect(response.checks.system.status).toBe('warn');
      expect(response.checks.system.message).toContain('High memory usage');
    });
  });
});
