/**
 * Unit Tests для DatabaseOrderRepository
 * Тестирует работу с ордерами в базе данных
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { DatabaseOrderRepository } from '../../src/database/DatabaseOrderRepository';
import { LimitOrder, OrderStatus, OrderType, LimitOrderParams } from '../../src/trading/managers/ILimitOrderManager';

// Mock dependencies
jest.mock('../../src/database/SupabaseDirectClient');
jest.mock('../../src/utils/Logger', () => ({
  getLogger: jest.fn(() => ({
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  }))
}));
jest.mock('../../src/utils/UnifiedValidator', () => ({
  UnifiedValidator: {
    validateLimitOrder: jest.fn(() => ({ valid: true, errors: [] }))
  }
}));

describe('DatabaseOrderRepository', () => {
  let repository: DatabaseOrderRepository;
  let mockDbClient: any;
  let mockLogger: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock database client
    mockDbClient = {
      executeSQL: jest.fn(),
      executeTransaction: jest.fn(),
      getProjectId: jest.fn(() => 'test-project')
    };

    // Mock logger
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    };

    // Create repository with mocked client
    repository = new DatabaseOrderRepository('test-project', true);
    (repository as any).dbClient = mockDbClient;
  });

  describe('create', () => {
    it('должен создать новый ордер', async () => {
      // Arrange
      const order: LimitOrder = {
        id: 'order123',
        params: {
          userId: 123,
          tokenMint: 'token123',
          orderType: OrderType.BUY,
          amount: 100,
          price: 0.5,
          slippage: 0.01
        } as LimitOrderParams,
        status: OrderStatus.PENDING,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      mockDbClient.executeSQL.mockResolvedValue({ rows: [], rowCount: 1 });

      // Act
      await repository.create(order);

      // Assert
      expect(mockDbClient.executeSQL).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO "Order"'),
        expect.arrayContaining([
          'order123',
          123,
          OrderType.BUY,
          'BUY',
          'token123',
          100,
          0.5,
          OrderStatus.PENDING
        ])
      );
    });

    it('должен выбросить ошибку если пользователь не авторизован', async () => {
      // Arrange
      const order: LimitOrder = {
        id: 'order123',
        params: {
          userId: 999, // Не авторизованный пользователь
          tokenMint: 'token123',
          orderType: OrderType.BUY,
          amount: 100,
          price: 0.5
        } as LimitOrderParams,
        status: OrderStatus.PENDING,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      // Act & Assert
      await expect(repository.create(order)).rejects.toThrow('not authorized');
    });

    it('должен логировать создание ордера', async () => {
      // Arrange
      const order: LimitOrder = {
        id: 'order123',
        params: {
          userId: 123,
          tokenMint: 'token123',
          orderType: OrderType.BUY,
          amount: 100,
          price: 0.5
        } as LimitOrderParams,
        status: OrderStatus.PENDING,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      mockDbClient.executeSQL.mockResolvedValue({ rows: [], rowCount: 1 });

      // Act
      await repository.create(order);

      // Assert
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Creating order order123'),
        expect.any(Object)
      );
    });
  });

  describe('findById', () => {
    it('должен найти ордер по ID', async () => {
      // Arrange
      const orderId = 'order123';
      const mockRow = {
        id: orderId,
        params: JSON.stringify({
          userId: 123,
          tokenMint: 'token123',
          orderType: OrderType.BUY,
          amount: 100,
          price: 0.5
        }),
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        filledPrice: null,
        filledAmount: null,
        linkedBuyOrderId: null,
        linkedTakeProfitOrderId: null,
        linkedPositionId: null,
        tokenType: 'DEX_POOL',
        takeProfitPercent: null,
        signature: null,
        jitoTip: null,
        error: null,
        retryCount: 0,
        lastRetryAt: null
      };

      mockDbClient.executeSQL.mockResolvedValue({ rows: [mockRow], rowCount: 1 });

      // Act
      const order = await repository.findById(orderId);

      // Assert
      expect(order).toBeDefined();
      expect(order?.id).toBe(orderId);
      expect(order?.status).toBe(OrderStatus.PENDING);
      expect(mockDbClient.executeSQL).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM "Order" WHERE "id" = $1'),
        [orderId]
      );
    });

    it('должен вернуть null если ордер не найден', async () => {
      // Arrange
      mockDbClient.executeSQL.mockResolvedValue({ rows: [], rowCount: 0 });

      // Act
      const order = await repository.findById('nonexistent');

      // Assert
      expect(order).toBeNull();
    });

    it('должен использовать кэш', async () => {
      // Arrange
      const orderId = 'order123';
      const mockRow = {
        id: orderId,
        params: JSON.stringify({
          userId: 123,
          tokenMint: 'token123',
          orderType: OrderType.BUY,
          amount: 100,
          price: 0.5
        }),
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        filledPrice: null,
        filledAmount: null,
        linkedBuyOrderId: null,
        linkedTakeProfitOrderId: null,
        linkedPositionId: null,
        tokenType: null,
        takeProfitPercent: null,
        signature: null,
        jitoTip: null,
        error: null,
        retryCount: 0,
        lastRetryAt: null
      };

      mockDbClient.executeSQL.mockResolvedValue({ rows: [mockRow], rowCount: 1 });

      // Act - первый вызов
      const order1 = await repository.findById(orderId);
      
      // Assert - проверяем что был вызов к БД
      expect(mockDbClient.executeSQL).toHaveBeenCalledTimes(1);

      // Act - второй вызов (из кэша)
      const order2 = await repository.findById(orderId);

      // Assert - не должно быть дополнительного вызова к БД
      expect(mockDbClient.executeSQL).toHaveBeenCalledTimes(1);
      expect(order1).toEqual(order2);
    });
  });

  describe('findByUserId', () => {
    it('должен найти все ордера пользователя', async () => {
      // Arrange
      const userId = 123;
      const mockRows = [
        {
          id: 'order1',
          params: JSON.stringify({ userId, tokenMint: 'token1', orderType: OrderType.BUY, amount: 100, price: 0.5 }),
          status: 'PENDING',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          filledPrice: null,
          filledAmount: null,
          linkedBuyOrderId: null,
          linkedTakeProfitOrderId: null,
          linkedPositionId: null,
          tokenType: null,
          takeProfitPercent: null,
          signature: null,
          jitoTip: null,
          error: null,
          retryCount: 0,
          lastRetryAt: null
        },
        {
          id: 'order2',
          params: JSON.stringify({ userId, tokenMint: 'token2', orderType: OrderType.SELL, amount: 200, price: 1.0 }),
          status: 'FILLED',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          filledPrice: 0.55,
          filledAmount: 100,
          linkedBuyOrderId: null,
          linkedTakeProfitOrderId: null,
          linkedPositionId: null,
          tokenType: null,
          takeProfitPercent: null,
          signature: 'sig123',
          jitoTip: 1000,
          error: null,
          retryCount: 0,
          lastRetryAt: null
        }
      ];

      mockDbClient.executeSQL.mockResolvedValue({ rows: mockRows, rowCount: 2 });

      // Act
      const orders = await repository.findByUserId(userId);

      // Assert
      expect(orders).toHaveLength(2);
      expect(orders[0].id).toBe('order1');
      expect(orders[1].id).toBe('order2');
      expect(mockDbClient.executeSQL).toHaveBeenCalledWith(
        expect.stringContaining('WHERE "userId" = $1'),
        [userId]
      );
    });

    it('должен возвращать пустой массив если ордеров нет', async () => {
      // Arrange
      mockDbClient.executeSQL.mockResolvedValue({ rows: [], rowCount: 0 });

      // Act
      const orders = await repository.findByUserId(123);

      // Assert
      expect(orders).toEqual([]);
    });
  });

  describe('findByStatus', () => {
    it('должен найти ордера по статусу', async () => {
      // Arrange
      const mockRows = [
        {
          id: 'order1',
          params: JSON.stringify({ userId: 123, tokenMint: 'token1', orderType: OrderType.BUY, amount: 100, price: 0.5 }),
          status: 'PENDING',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          filledPrice: null,
          filledAmount: null,
          linkedBuyOrderId: null,
          linkedTakeProfitOrderId: null,
          linkedPositionId: null,
          tokenType: null,
          takeProfitPercent: null,
          signature: null,
          jitoTip: null,
          error: null,
          retryCount: 0,
          lastRetryAt: null
        }
      ];

      mockDbClient.executeSQL.mockResolvedValue({ rows: mockRows, rowCount: 1 });

      // Act
      const orders = await repository.findByStatus(OrderStatus.PENDING);

      // Assert
      expect(orders).toHaveLength(1);
      expect(orders[0].status).toBe(OrderStatus.PENDING);
      expect(mockDbClient.executeSQL).toHaveBeenCalledWith(
        expect.stringContaining('WHERE "status" = $1'),
        [OrderStatus.PENDING]
      );
    });
  });

  describe('update', () => {
    it('должен обновить ордер', async () => {
      // Arrange
      const order: LimitOrder = {
        id: 'order123',
        params: {
          userId: 123,
          tokenMint: 'token123',
          orderType: OrderType.BUY,
          amount: 100,
          price: 0.5
        } as LimitOrderParams,
        status: OrderStatus.FILLED,
        filledPrice: 0.55,
        filledAmount: 100,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      mockDbClient.executeSQL.mockResolvedValue({ rows: [], rowCount: 1 });

      // Act
      await repository.update(order);

      // Assert
      expect(mockDbClient.executeSQL).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE "Order" SET'),
        expect.arrayContaining([
          OrderStatus.FILLED,
          0.55,
          100
        ])
      );
    });

    it('должен инвалидировать кэш при обновлении', async () => {
      // Arrange
      const order: LimitOrder = {
        id: 'order123',
        params: {
          userId: 123,
          tokenMint: 'token123',
          orderType: OrderType.BUY,
          amount: 100,
          price: 0.5
        } as LimitOrderParams,
        status: OrderStatus.FILLED,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      mockDbClient.executeSQL.mockResolvedValue({ rows: [], rowCount: 1 });

      // Act
      await repository.update(order);

      // Assert - кэш должен быть очищен для этого ордера
      const cacheSize = repository.getCacheSize();
      expect(cacheSize).toBe(0);
    });
  });

  describe('updateStatus', () => {
    it('должен обновить статус ордера', async () => {
      // Arrange
      const orderId = 'order123';
      const newStatus = OrderStatus.CANCELLED;

      mockDbClient.executeSQL.mockResolvedValue({ rows: [], rowCount: 1 });

      // Act
      await repository.updateStatus(orderId, newStatus);

      // Assert
      expect(mockDbClient.executeSQL).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE "Order" SET "status" = $1'),
        expect.arrayContaining([newStatus, expect.any(Number), orderId])
      );
    });

    it('должен инвалидировать кэш при обновлении статуса', async () => {
      // Arrange
      const orderId = 'order123';
      mockDbClient.executeSQL.mockResolvedValue({ rows: [], rowCount: 1 });

      // Act
      await repository.updateStatus(orderId, OrderStatus.CANCELLED);

      // Assert
      const cacheSize = repository.getCacheSize();
      expect(cacheSize).toBe(0);
    });
  });

  describe('delete', () => {
    it('должен удалить ордер', async () => {
      // Arrange
      const orderId = 'order123';
      mockDbClient.executeSQL.mockResolvedValue({ rows: [], rowCount: 1 });

      // Act
      await repository.delete(orderId);

      // Assert
      expect(mockDbClient.executeSQL).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM "Order" WHERE "id" = $1'),
        [orderId]
      );
    });

    it('должен инвалидировать кэш при удалении', async () => {
      // Arrange
      const orderId = 'order123';
      mockDbClient.executeSQL.mockResolvedValue({ rows: [], rowCount: 1 });

      // Act
      await repository.delete(orderId);

      // Assert
      const cacheSize = repository.getCacheSize();
      expect(cacheSize).toBe(0);
    });
  });

  describe('getStats', () => {
    it('должен вернуть статистику ордеров', async () => {
      // Arrange
      const mockRows = [
        { status: 'PENDING', count: '5' },
        { status: 'FILLED', count: '10' },
        { status: 'CANCELLED', count: '2' }
      ];

      mockDbClient.executeSQL.mockResolvedValue({ rows: mockRows, rowCount: 3 });

      // Act
      const stats = await repository.getStats();

      // Assert
      expect(stats).toBeDefined();
      expect(stats.pending).toBe(5);
      expect(stats.filled).toBe(10);
      expect(stats.cancelled).toBe(2);
      expect(stats.total).toBe(17);
    });

    it('должен возвращать нулевую статистику если ордеров нет', async () => {
      // Arrange
      mockDbClient.executeSQL.mockResolvedValue({ rows: [], rowCount: 0 });

      // Act
      const stats = await repository.getStats();

      // Assert
      expect(stats.total).toBe(0);
      expect(stats.pending).toBe(0);
      expect(stats.filled).toBe(0);
    });
  });

  describe('testConnection', () => {
    it('должен успешно протестировать соединение', async () => {
      // Arrange
      mockDbClient.executeSQL.mockResolvedValue({ rows: [{ result: 1 }], rowCount: 1 });

      // Act
      const result = await repository.testConnection();

      // Assert
      expect(result).toBe(true);
      expect(mockDbClient.executeSQL).toHaveBeenCalledWith('SELECT 1', []);
    });

    it('должен вернуть false при ошибке соединения', async () => {
      // Arrange
      mockDbClient.executeSQL.mockRejectedValue(new Error('Connection failed'));

      // Act
      const result = await repository.testConnection();

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('clearCache', () => {
    it('должен очистить кэш', async () => {
      // Arrange
      const mockRow = {
        id: 'order1',
        params: JSON.stringify({ userId: 123, tokenMint: 'token1', orderType: OrderType.BUY, amount: 100, price: 0.5 }),
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        filledPrice: null,
        filledAmount: null,
        linkedBuyOrderId: null,
        linkedTakeProfitOrderId: null,
        linkedPositionId: null,
        tokenType: null,
        takeProfitPercent: null,
        signature: null,
        jitoTip: null,
        error: null,
        retryCount: 0,
        lastRetryAt: null
      };

      mockDbClient.executeSQL.mockResolvedValue({ rows: [mockRow], rowCount: 1 });

      // Act - загружаем ордер в кэш
      await repository.findById('order1');
      expect(repository.getCacheSize()).toBe(1);

      // Очищаем кэш
      repository.clearCache();

      // Assert
      expect(repository.getCacheSize()).toBe(0);
    });
  });

  describe('getCacheSize', () => {
    it('должен возвращать размер кэша', async () => {
      // Arrange
      const mockRow = {
        id: 'order1',
        params: JSON.stringify({ userId: 123, tokenMint: 'token1', orderType: OrderType.BUY, amount: 100, price: 0.5 }),
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        filledPrice: null,
        filledAmount: null,
        linkedBuyOrderId: null,
        linkedTakeProfitOrderId: null,
        linkedPositionId: null,
        tokenType: null,
        takeProfitPercent: null,
        signature: null,
        jitoTip: null,
        error: null,
        retryCount: 0,
        lastRetryAt: null
      };

      mockDbClient.executeSQL.mockResolvedValue({ rows: [mockRow], rowCount: 1 });

      // Act
      await repository.findById('order1');
      const cacheSize = repository.getCacheSize();

      // Assert
      expect(cacheSize).toBe(1);
    });

    it('должен возвращать 0 если кэш пуст', () => {
      // Act & Assert
      expect(repository.getCacheSize()).toBe(0);
    });
  });

  describe('getProjectId', () => {
    it('должен возвращать ID проекта', () => {
      // Act
      const projectId = repository.getProjectId();

      // Assert
      expect(projectId).toBe('test-project');
    });
  });

  describe('обработка ошибок', () => {
    it('должен логировать ошибки при создании ордера', async () => {
      // Arrange
      const order: LimitOrder = {
        id: 'order123',
        params: {
          userId: 123,
          tokenMint: 'token123',
          orderType: OrderType.BUY,
          amount: 100,
          price: 0.5
        } as LimitOrderParams,
        status: OrderStatus.PENDING,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      mockDbClient.executeSQL.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(repository.create(order)).rejects.toThrow('Database error');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('должен логировать ошибки при поиске ордера', async () => {
      // Arrange
      mockDbClient.executeSQL.mockRejectedValue(new Error('Query error'));

      // Act & Assert
      await expect(repository.findById('order123')).rejects.toThrow('Query error');
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
});
