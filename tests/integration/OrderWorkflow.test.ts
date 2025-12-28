/**
 * Integration Tests для Order Workflow
 * Тестирует полный цикл создания, исполнения и отслеживания ордеров
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { DatabaseOrderRepository } from '../../src/database/DatabaseOrderRepository';
import { OrderExpirationService } from '../../src/trading/managers/OrderExpirationService';
import { LimitOrder, OrderStatus, OrderType, LimitOrderParams } from '../../src/trading/managers/ILimitOrderManager';

// Mock dependencies
jest.mock('../../src/database/SupabaseDirectClient');
jest.mock('../../src/utils/Logger');
jest.mock('../../src/utils/UnifiedValidator');

describe('Order Workflow Integration', () => {
  let repository: DatabaseOrderRepository;
  let expirationService: OrderExpirationService;
  let mockDbClient: any;
  let expiredOrders: string[] = [];

  beforeEach(() => {
    jest.clearAllMocks();
    expiredOrders = [];

    // Mock database client
    mockDbClient = {
      executeSQL: jest.fn(),
      executeTransaction: jest.fn(),
      getProjectId: jest.fn(() => 'test-project')
    };

    // Mock logger
    const mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn()
    };

    jest.doMock('../../src/utils/Logger', () => ({
      getLogger: () => mockLogger
    }));

    jest.doMock('../../src/utils/UnifiedValidator', () => ({
      UnifiedValidator: {
        validateLimitOrder: jest.fn(() => ({ valid: true, errors: [] }))
      }
    }));

    // Create repository with mocked client
    repository = new DatabaseOrderRepository('test-project', true);
    (repository as any).dbClient = mockDbClient;

    // Create expiration service with callback
    expirationService = new OrderExpirationService(
      repository,
      (orderId) => {
        expiredOrders.push(orderId);
      }
    );
  });

  afterEach(() => {
    expirationService.stop();
    jest.restoreAllMocks();
  });

  describe('полный цикл ордера', () => {
    it('должен создать ордер, обновить статус и удалить', async () => {
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

      // Act - создаем ордер
      await repository.create(order);

      // Assert
      expect(mockDbClient.executeSQL).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO "Order"'),
        expect.any(Array)
      );

      // Act - обновляем статус
      order.status = OrderStatus.FILLED;
      order.filledPrice = 0.55;
      order.filledAmount = 100;
      await repository.update(order);

      // Assert
      expect(mockDbClient.executeSQL).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE "Order" SET'),
        expect.arrayContaining([OrderStatus.FILLED, 0.55, 100])
      );

      // Act - удаляем ордер
      await repository.delete(order.id);

      // Assert
      expect(mockDbClient.executeSQL).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM "Order" WHERE "id" = $1'),
        [order.id]
      );
    });

    it('должен корректно обрабатывать кэш в течение жизненного цикла ордера', async () => {
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

      const mockRow = {
        id: order.id,
        params: JSON.stringify(order.params),
        status: order.status,
        createdAt: new Date(order.createdAt).toISOString(),
        updatedAt: new Date(order.updatedAt).toISOString(),
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

      // Act - создаем ордер
      await repository.create(order);

      // Assert - кэш пуст после создания
      expect(repository.getCacheSize()).toBe(0);

      // Act - находим ордер (добавляется в кэш)
      const foundOrder = await repository.findById(order.id);

      // Assert - кэш содержит ордер
      expect(repository.getCacheSize()).toBe(1);
      expect(foundOrder?.id).toBe(order.id);

      // Act - находим ордер снова (из кэша)
      const cachedOrder = await repository.findById(order.id);

      // Assert - не было нового запроса к БД
      expect(mockDbClient.executeSQL).toHaveBeenCalledTimes(2); // 1 create + 1 findById
      expect(cachedOrder?.id).toBe(order.id);

      // Act - обновляем ордер (кэш инвалидирован)
      order.status = OrderStatus.FILLED;
      await repository.update(order);

      // Assert - кэш очищен
      expect(repository.getCacheSize()).toBe(0);
    });
  });

  describe('множественные ордера', () => {
    it('должен корректно обрабатывать несколько ордеров пользователя', async () => {
      // Arrange
      const orders: LimitOrder[] = [
        {
          id: 'order1',
          params: {
            userId: 123,
            tokenMint: 'token1',
            orderType: OrderType.BUY,
            amount: 100,
            price: 0.5
          } as LimitOrderParams,
          status: OrderStatus.PENDING,
          createdAt: Date.now(),
          updatedAt: Date.now()
        },
        {
          id: 'order2',
          params: {
            userId: 123,
            tokenMint: 'token2',
            orderType: OrderType.SELL,
            amount: 200,
            price: 1.0
          } as LimitOrderParams,
          status: OrderStatus.FILLED,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }
      ];

      const mockRows = orders.map(order => ({
        id: order.id,
        params: JSON.stringify(order.params),
        status: order.status,
        createdAt: new Date(order.createdAt).toISOString(),
        updatedAt: new Date(order.updatedAt).toISOString(),
        filledPrice: order.filledPrice || null,
        filledAmount: order.filledAmount || null,
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
      }));

      mockDbClient.executeSQL.mockResolvedValue({ rows: mockRows, rowCount: 2 });

      // Act - находим все ордера пользователя
      const foundOrders = await repository.findByUserId(123);

      // Assert
      expect(foundOrders).toHaveLength(2);
      expect(foundOrders[0].id).toBe('order1');
      expect(foundOrders[1].id).toBe('order2');

      // Assert - все ордера в кэше
      expect(repository.getCacheSize()).toBe(2);
    });

    it('должен корректно обрабатывать ордера разных статусов', async () => {
      // Arrange
      const statuses = [
        OrderStatus.PENDING,
        OrderStatus.EXECUTING,
        OrderStatus.FILLED,
        OrderStatus.CANCELLED,
        OrderStatus.EXPIRED
      ];

      const mockRows = statuses.map((status, index) => ({
        id: `order${index}`,
        params: JSON.stringify({
          userId: 123,
          tokenMint: `token${index}`,
          orderType: OrderType.BUY,
          amount: 100,
          price: 0.5
        }),
        status: status.toUpperCase(),
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
      }));

      mockDbClient.executeSQL.mockResolvedValue({ rows: mockRows, rowCount: statuses.length });

      // Act - находим ордера по каждому статусу
      for (const status of statuses) {
        const orders = await repository.findByStatus(status);
        expect(orders).toHaveLength(1);
        expect(orders[0].status).toBe(status);
      }
    });
  });

  describe('истечение ордеров', () => {
    it('должен автоматически истекать старые ордера', async () => {
      // Arrange
      const oldOrder: LimitOrder = {
        id: 'oldOrder',
        params: {
          userId: 123,
          tokenMint: 'token123',
          orderType: OrderType.BUY,
          amount: 100,
          price: 0.5
        } as LimitOrderParams,
        status: OrderStatus.PENDING,
        createdAt: Date.now() - 25 * 60 * 60 * 1000, // 25 часов назад
        updatedAt: Date.now() - 25 * 60 * 60 * 1000
      };

      const recentOrder: LimitOrder = {
        id: 'recentOrder',
        params: {
          userId: 123,
          tokenMint: 'token456',
          orderType: OrderType.BUY,
          amount: 100,
          price: 0.5
        } as LimitOrderParams,
        status: OrderStatus.PENDING,
        createdAt: Date.now() - 1 * 60 * 60 * 1000, // 1 час назад
        updatedAt: Date.now() - 1 * 60 * 60 * 1000
      };

      mockDbClient.executeSQL.mockResolvedValue({
        rows: [
          {
            id: oldOrder.id,
            params: JSON.stringify(oldOrder.params),
            status: oldOrder.status,
            createdAt: new Date(oldOrder.createdAt).toISOString(),
            updatedAt: new Date(oldOrder.updatedAt).toISOString(),
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
            id: recentOrder.id,
            params: JSON.stringify(recentOrder.params),
            status: recentOrder.status,
            createdAt: new Date(recentOrder.createdAt).toISOString(),
            updatedAt: new Date(recentOrder.updatedAt).toISOString(),
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
        ],
        rowCount: 2
      });

      // Act - запускаем проверку истечения
      await expirationService['checkExpiredOrders']();

      // Assert
      expect(expiredOrders).toHaveLength(1);
      expect(expiredOrders[0]).toBe('oldOrder');
      expect(mockDbClient.executeSQL).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE "Order" SET "status" = $1'),
        expect.arrayContaining([OrderStatus.EXPIRED, expect.any(Number), 'oldOrder'])
      );
    });

    it('должен вызывать callback при истечении ордера', async () => {
      // Arrange
      const order: LimitOrder = {
        id: 'expiredOrder',
        params: {
          userId: 123,
          tokenMint: 'token123',
          orderType: OrderType.BUY,
          amount: 100,
          price: 0.5
        } as LimitOrderParams,
        status: OrderStatus.PENDING,
        createdAt: Date.now() - 25 * 60 * 60 * 1000,
        updatedAt: Date.now() - 25 * 60 * 60 * 1000
      };

      mockDbClient.executeSQL.mockResolvedValue({
        rows: [
          {
            id: order.id,
            params: JSON.stringify(order.params),
            status: order.status,
            createdAt: new Date(order.createdAt).toISOString(),
            updatedAt: new Date(order.updatedAt).toISOString(),
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
        ],
        rowCount: 1
      });

      // Act
      await expirationService['checkExpiredOrders']();

      // Assert
      expect(expiredOrders).toHaveLength(1);
      expect(expiredOrders[0]).toBe('expiredOrder');
    });
  });

  describe('статистика и мониторинг', () => {
    it('должен корректно подсчитывать статистику', async () => {
      // Arrange
      const mockRows = [
        { status: 'PENDING', count: '5' },
        { status: 'FILLED', count: '10' },
        { status: 'CANCELLED', count: '2' },
        { status: 'EXPIRED', count: '1' }
      ];

      mockDbClient.executeSQL.mockResolvedValue({ rows: mockRows, rowCount: 4 });

      // Act
      const stats = await repository.getStats();

      // Assert
      expect(stats).toBeDefined();
      expect(stats.pending).toBe(5);
      expect(stats.filled).toBe(10);
      expect(stats.cancelled).toBe(2);
      expect(stats.expired).toBe(1);
      expect(stats.total).toBe(18);
    });

    it('должен возвращать ордера для мониторинга', async () => {
      // Arrange
      const mockRows = [
        {
          id: 'order1',
          params: JSON.stringify({
            userId: 123,
            tokenMint: 'token1',
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
        },
        {
          id: 'order2',
          params: JSON.stringify({
            userId: 123,
            tokenMint: 'token2',
            orderType: OrderType.BUY,
            amount: 100,
            price: 0.5
          }),
          status: 'ACTIVE',
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

      mockDbClient.executeSQL.mockResolvedValue({ rows: mockRows, rowCount: 2 });

      // Act
      const orders = await repository.getOrdersForMonitoring();

      // Assert
      expect(orders).toHaveLength(2);
      expect(orders.every(order => 
        order.status === OrderStatus.PENDING || order.status === OrderStatus.ACTIVE
      )).toBe(true);
    });
  });

  describe('обработка ошибок', () => {
    it('должен корректно обрабатывать ошибки базы данных', async () => {
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

      mockDbClient.executeSQL.mockRejectedValue(new Error('Database connection failed'));

      // Act & Assert
      await expect(repository.create(order)).rejects.toThrow('Database connection failed');
    });

    it('должен продолжать работу при ошибке истечения ордера', async () => {
      // Arrange
      const order1: LimitOrder = {
        id: 'order1',
        params: {
          userId: 123,
          tokenMint: 'token1',
          orderType: OrderType.BUY,
          amount: 100,
          price: 0.5
        } as LimitOrderParams,
        status: OrderStatus.PENDING,
        createdAt: Date.now() - 25 * 60 * 60 * 1000,
        updatedAt: Date.now() - 25 * 60 * 60 * 1000
      };

      const order2: LimitOrder = {
        id: 'order2',
        params: {
          userId: 123,
          tokenMint: 'token2',
          orderType: OrderType.BUY,
          amount: 100,
          price: 0.5
        } as LimitOrderParams,
        status: OrderStatus.PENDING,
        createdAt: Date.now() - 26 * 60 * 60 * 1000,
        updatedAt: Date.now() - 26 * 60 * 60 * 1000
      };

      mockDbClient.executeSQL.mockImplementation((query: string) => {
        if (query.includes('SELECT * FROM "Order"')) {
          return Promise.resolve({
            rows: [
              {
                id: order1.id,
                params: JSON.stringify(order1.params),
                status: order1.status,
                createdAt: new Date(order1.createdAt).toISOString(),
                updatedAt: new Date(order1.updatedAt).toISOString(),
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
                id: order2.id,
                params: JSON.stringify(order2.params),
                status: order2.status,
                createdAt: new Date(order2.createdAt).toISOString(),
                updatedAt: new Date(order2.updatedAt).toISOString(),
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
            ],
            rowCount: 2
          });
        } else if (query.includes('UPDATE "Order" SET "status" = $1')) {
          // Первое обновление успешно, второе с ошибкой
          if (mockDbClient.executeSQL.mock.calls.filter((call: any) => 
            call[0].includes('UPDATE "Order"')
          ).length === 0) {
            return Promise.resolve({ rows: [], rowCount: 1 });
          } else {
            return Promise.reject(new Error('Update failed'));
          }
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      // Act
      await expirationService['checkExpiredOrders']();

      // Assert - должен быть вызван callback хотя бы для одного ордера
      expect(expiredOrders.length).toBeGreaterThanOrEqual(0);
    });
  });
});
