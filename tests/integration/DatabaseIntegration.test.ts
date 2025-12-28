/**
 * Integration Tests для компонентов базы данных
 * Тестирует интеграцию между DatabaseOrderRepository, StateManager и SupabaseDirectClient
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, jest } from '@jest/globals';
import { DatabaseOrderRepository } from '../../src/database/DatabaseOrderRepository';
import { StateManager } from '../../src/services/StateManager';
import { SupabaseDirectClient } from '../../src/database/SupabaseDirectClient';
import { LimitOrder, OrderStatus, OrderType, LimitOrderParams } from '../../src/trading/managers/ILimitOrderManager';
import { UserPanelState } from '../../src/types/panel';

describe('Database Integration Tests', () => {
  let repository: DatabaseOrderRepository;
  let stateManager: StateManager;
  let directClient: SupabaseDirectClient;
  
  // Тестовые данные
  const testUserId = 999999;
  const testTokenMint = 'test_token_mint_123';
  
  beforeAll(async () => {
    // Инициализация с тестовой базой данных
    const testProjectId = process.env.SUPABASE_PROJECT_ID || 'test-project';
    
    directClient = new SupabaseDirectClient(testProjectId);
    repository = new DatabaseOrderRepository(testProjectId, true);
    stateManager = new StateManager();
    
    // Проверяем подключение
    const connected = await directClient.testConnection();
    expect(connected).toBe(true);
  });

  afterAll(async () => {
    // Очистка
    await stateManager.dispose();
    await directClient.close();
  });

  beforeEach(async () => {
    // Очистка тестовых данных перед каждым тестом
    await repository.deleteByUserId(testUserId);
    await stateManager.deleteState(testUserId);
  });

  describe('DatabaseOrderRepository Integration', () => {
    describe('CRUD операции', () => {
      it('должен создать, найти, обновить и удалить ордер', async () => {
        // Arrange
        const order: LimitOrder = {
          id: `test_order_${Date.now()}`,
          params: {
            userId: testUserId,
            tokenMint: testTokenMint,
            orderType: OrderType.BUY,
            amount: 100,
            price: 0.5,
            slippage: 0.01
          } as LimitOrderParams,
          status: OrderStatus.PENDING,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        // Act - Create
        await repository.create(order);

        // Assert - Find
        const foundOrder = await repository.findById(order.id);
        expect(foundOrder).not.toBeNull();
        expect(foundOrder?.id).toBe(order.id);
        expect(foundOrder?.status).toBe(OrderStatus.PENDING);

        // Act - Update
        foundOrder!.status = OrderStatus.FILLED;
        foundOrder!.filledPrice = 0.55;
        foundOrder!.filledAmount = 100;
        await repository.update(foundOrder!);

        // Assert - Verify update
        const updatedOrder = await repository.findById(order.id);
        expect(updatedOrder?.status).toBe(OrderStatus.FILLED);
        expect(updatedOrder?.filledPrice).toBe(0.55);

        // Act - Delete
        await repository.delete(order.id);

        // Assert - Verify deletion
        const deletedOrder = await repository.findById(order.id);
        expect(deletedOrder).toBeNull();
      });

      it('должен находить ордера по пользователю', async () => {
        // Arrange
        const order1: LimitOrder = {
          id: `test_order_1_${Date.now()}`,
          params: {
            userId: testUserId,
            tokenMint: testTokenMint,
            orderType: OrderType.BUY,
            amount: 100,
            price: 0.5
          } as LimitOrderParams,
          status: OrderStatus.PENDING,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        const order2: LimitOrder = {
          id: `test_order_2_${Date.now()}`,
          params: {
            userId: testUserId,
            tokenMint: 'other_token',
            orderType: OrderType.SELL,
            amount: 200,
            price: 1.0
          } as LimitOrderParams,
          status: OrderStatus.FILLED,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        await repository.create(order1);
        await repository.create(order2);

        // Act
        const orders = await repository.findByUserId(testUserId);

        // Assert
        expect(orders).toHaveLength(2);
        expect(orders.some(o => o.id === order1.id)).toBe(true);
        expect(orders.some(o => o.id === order2.id)).toBe(true);
      });

      it('должен находить ордера по статусу', async () => {
        // Arrange
        const pendingOrder: LimitOrder = {
          id: `test_pending_${Date.now()}`,
          params: {
            userId: testUserId,
            tokenMint: testTokenMint,
            orderType: OrderType.BUY,
            amount: 100,
            price: 0.5
          } as LimitOrderParams,
          status: OrderStatus.PENDING,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        const filledOrder: LimitOrder = {
          id: `test_filled_${Date.now()}`,
          params: {
            userId: testUserId,
            tokenMint: testTokenMint,
            orderType: OrderType.SELL,
            amount: 200,
            price: 1.0
          } as LimitOrderParams,
          status: OrderStatus.FILLED,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        await repository.create(pendingOrder);
        await repository.create(filledOrder);

        // Act
        const pendingOrders = await repository.findByStatus(OrderStatus.PENDING);

        // Assert
        expect(pendingOrders.length).toBeGreaterThan(0);
        expect(pendingOrders.some(o => o.id === pendingOrder.id)).toBe(true);
      });
    });

    describe('Связанные ордера (Take Profit)', () => {
      it('должен создать buy ордер с take profit в транзакции', async () => {
        // Arrange
        const buyOrder: LimitOrder = {
          id: `test_buy_${Date.now()}`,
          params: {
            userId: testUserId,
            tokenMint: testTokenMint,
            orderType: OrderType.BUY,
            amount: 100,
            price: 0.5
          } as LimitOrderParams,
          status: OrderStatus.PENDING,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        const takeProfitOrder: LimitOrder = {
          id: `test_tp_${Date.now()}`,
          params: {
            userId: testUserId,
            tokenMint: testTokenMint,
            orderType: OrderType.SELL,
            amount: 100,
            price: 0.75 // 50% profit
          } as LimitOrderParams,
          status: OrderStatus.INACTIVE,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        // Act
        const result = await repository.createBuyOrderWithTakeProfit(buyOrder, takeProfitOrder);

        // Assert
        expect(result.buyOrderId).toBe(buyOrder.id);
        expect(result.takeProfitOrderId).toBe(takeProfitOrder.id);

        const buyFromDb = await repository.findById(buyOrder.id);
        const tpFromDb = await repository.findById(takeProfitOrder.id);

        expect(buyFromDb?.linkedTakeProfitOrderId).toBe(takeProfitOrder.id);
        expect(tpFromDb?.linkedBuyOrderId).toBe(buyOrder.id);
      });

      it('должен обновлять связанные ордера в транзакции', async () => {
        // Arrange
        const buyOrder: LimitOrder = {
          id: `test_buy_${Date.now()}`,
          params: {
            userId: testUserId,
            tokenMint: testTokenMint,
            orderType: OrderType.BUY,
            amount: 100,
            price: 0.5
          } as LimitOrderParams,
          status: OrderStatus.PENDING,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        const takeProfitOrder: LimitOrder = {
          id: `test_tp_${Date.now()}`,
          params: {
            userId: testUserId,
            tokenMint: testTokenMint,
            orderType: OrderType.SELL,
            amount: 100,
            price: 0.75
          } as LimitOrderParams,
          status: OrderStatus.INACTIVE,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        await repository.createBuyOrderWithTakeProfit(buyOrder, takeProfitOrder);

        // Act
        await repository.updateLinkedOrdersInTransaction(
          buyOrder.id,
          takeProfitOrder.id,
          {
            buyOrder: {
              status: OrderStatus.FILLED,
              filledPrice: 0.52,
              filledAmount: 100
            },
            takeProfitOrder: {
              status: OrderStatus.PENDING
            }
          }
        );

        // Assert
        const updatedBuy = await repository.findById(buyOrder.id);
        const updatedTp = await repository.findById(takeProfitOrder.id);

        expect(updatedBuy?.status).toBe(OrderStatus.FILLED);
        expect(updatedBuy?.filledPrice).toBe(0.52);
        expect(updatedTp?.status).toBe(OrderStatus.PENDING);
      });

      it('должен отменять связанные ордера в транзакции', async () => {
        // Arrange
        const buyOrder: LimitOrder = {
          id: `test_buy_${Date.now()}`,
          params: {
            userId: testUserId,
            tokenMint: testTokenMint,
            orderType: OrderType.BUY,
            amount: 100,
            price: 0.5
          } as LimitOrderParams,
          status: OrderStatus.PENDING,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        const takeProfitOrder: LimitOrder = {
          id: `test_tp_${Date.now()}`,
          params: {
            userId: testUserId,
            tokenMint: testTokenMint,
            orderType: OrderType.SELL,
            amount: 100,
            price: 0.75
          } as LimitOrderParams,
          status: OrderStatus.INACTIVE,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        await repository.createBuyOrderWithTakeProfit(buyOrder, takeProfitOrder);

        // Act
        await repository.cancelLinkedOrdersInTransaction(buyOrder.id, takeProfitOrder.id);

        // Assert
        const cancelledBuy = await repository.findById(buyOrder.id);
        const cancelledTp = await repository.findById(takeProfitOrder.id);

        expect(cancelledBuy?.status).toBe(OrderStatus.CANCELLED);
        expect(cancelledTp?.status).toBe(OrderStatus.CANCELLED);
      });
    });

    describe('Статистика и мониторинг', () => {
      it('должен возвращать корректную статистику', async () => {
        // Arrange
        const pendingOrder: LimitOrder = {
          id: `test_pending_${Date.now()}`,
          params: {
            userId: testUserId,
            tokenMint: testTokenMint,
            orderType: OrderType.BUY,
            amount: 100,
            price: 0.5
          } as LimitOrderParams,
          status: OrderStatus.PENDING,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        const filledOrder: LimitOrder = {
          id: `test_filled_${Date.now()}`,
          params: {
            userId: testUserId,
            tokenMint: testTokenMint,
            orderType: OrderType.SELL,
            amount: 200,
            price: 1.0
          } as LimitOrderParams,
          status: OrderStatus.FILLED,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        await repository.create(pendingOrder);
        await repository.create(filledOrder);

        // Act
        const stats = await repository.getStats();

        // Assert
        expect(stats).toBeDefined();
        expect(stats.pending).toBeGreaterThanOrEqual(1);
        expect(stats.filled).toBeGreaterThanOrEqual(1);
        expect(stats.total).toBeGreaterThanOrEqual(2);
      });

      it('должен возвращать ордера для мониторинга', async () => {
        // Arrange
        const pendingOrder: LimitOrder = {
          id: `test_monitor_${Date.now()}`,
          params: {
            userId: testUserId,
            tokenMint: testTokenMint,
            orderType: OrderType.BUY,
            amount: 100,
            price: 0.5
          } as LimitOrderParams,
          status: OrderStatus.PENDING,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        await repository.create(pendingOrder);

        // Act
        const monitoringOrders = await repository.getOrdersForMonitoring();

        // Assert
        expect(monitoringOrders.length).toBeGreaterThan(0);
        expect(monitoringOrders.some(o => o.status === OrderStatus.PENDING || o.status === OrderStatus.ACTIVE)).toBe(true);
      });
    });

    describe('Кэширование', () => {
      it('должен использовать кэш для findById', async () => {
        // Arrange
        const order: LimitOrder = {
          id: `test_cache_${Date.now()}`,
          params: {
            userId: testUserId,
            tokenMint: testTokenMint,
            orderType: OrderType.BUY,
            amount: 100,
            price: 0.5
          } as LimitOrderParams,
          status: OrderStatus.PENDING,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        await repository.create(order);

        // Act - первый вызов (из БД)
        const firstCall = await repository.findById(order.id);
        
        // Act - второй вызов (из кэша)
        const secondCall = await repository.findById(order.id);

        // Assert
        expect(firstCall).toEqual(secondCall);
        expect(repository.getCacheSize()).toBeGreaterThan(0);
      });

      it('должен инвалидировать кэш при обновлении', async () => {
        // Arrange
        const order: LimitOrder = {
          id: `test_cache_invalidate_${Date.now()}`,
          params: {
            userId: testUserId,
            tokenMint: testTokenMint,
            orderType: OrderType.BUY,
            amount: 100,
            price: 0.5
          } as LimitOrderParams,
          status: OrderStatus.PENDING,
          createdAt: Date.now(),
          updatedAt: Date.now()
        };

        await repository.create(order);
        await repository.findById(order.id); // Загружаем в кэш

        // Act
        order.status = OrderStatus.FILLED;
        await repository.update(order);

        // Assert - кэш должен быть очищен
        const cacheSize = repository.getCacheSize();
        expect(cacheSize).toBe(0);
      });
    });
  });

  describe('StateManager Integration', () => {
    describe('CRUD операций состояний', () => {
      it('должен создать, получить и удалить состояние', async () => {
        // Arrange
        const state: UserPanelState = {
          user_id: testUserId,
          message_id: 123456,
          token_address: testTokenMint,
          mode: 'buy',
          token_data: { symbol: 'TEST', price: 100 },
          user_data: { balance: 1000 },
          action_data: { step: 'amount' },
          activeLimitOrderId: undefined,
          created_at: Date.now(),
          closed: false,
          waiting_for: 'amount'
        };

        // Act - Create
        await stateManager.setState(testUserId, state);

        // Assert - Get
        const retrievedState = await stateManager.getState(testUserId);
        expect(retrievedState).not.toBeNull();
        expect(retrievedState?.user_id).toBe(testUserId);
        expect(retrievedState?.token_address).toBe(testTokenMint);
        expect(retrievedState?.mode).toBe('buy');

        // Act - Delete
        await stateManager.deleteState(testUserId);

        // Assert - Verify deletion
        const deletedState = await stateManager.getState(testUserId);
        expect(deletedState).toBeNull();
      });

      it('должен обновлять существующее состояние', async () => {
        // Arrange
        const initialState: UserPanelState = {
          user_id: testUserId,
          message_id: 123456,
          token_address: testTokenMint,
          mode: 'buy',
          token_data: { symbol: 'TEST', price: 100 },
          user_data: { balance: 1000 },
          action_data: { step: 'amount' },
          activeLimitOrderId: undefined,
          created_at: Date.now(),
          closed: false,
          waiting_for: 'amount'
        };

        await stateManager.setState(testUserId, initialState);

        // Act
        await stateManager.updateTokenData(testUserId, { price: 150 });
        await stateManager.updateUserData(testUserId, { balance: 950 });
        await stateManager.updateActionData(testUserId, { step: 'confirmation' });

        // Assert
        const updatedState = await stateManager.getState(testUserId);
        expect(updatedState?.token_data.price).toBe(150);
        expect(updatedState?.user_data.balance).toBe(950);
        expect(updatedState?.action_data.step).toBe('confirmation');
      });
    });

    describe('Кэширование состояний', () => {
      it('должен использовать кэш для getState', async () => {
        // Arrange
        const state: UserPanelState = {
          user_id: testUserId,
          message_id: 123456,
          token_address: testTokenMint,
          mode: 'buy',
          token_data: { symbol: 'TEST' },
          user_data: {},
          action_data: {},
          activeLimitOrderId: undefined,
          created_at: Date.now(),
          closed: false,
          waiting_for: undefined
        };

        await stateManager.setState(testUserId, state);

        // Act - первый вызов (из кэша после setState)
        const firstCall = await stateManager.getState(testUserId);
        
        // Act - второй вызов (из кэша)
        const secondCall = await stateManager.getState(testUserId);

        // Assert
        expect(firstCall).toEqual(secondCall);
      });

      it('должен инвалидировать кэш при обновлении', async () => {
        // Arrange
        const state: UserPanelState = {
          user_id: testUserId,
          message_id: 123456,
          token_address: testTokenMint,
          mode: 'buy',
          token_data: { symbol: 'TEST', price: 100 },
          user_data: {},
          action_data: {},
          activeLimitOrderId: undefined,
          created_at: Date.now(),
          closed: false,
          waiting_for: undefined
        };

        await stateManager.setState(testUserId, state);
        await stateManager.getState(testUserId); // Загружаем в кэш

        // Act
        await stateManager.updateTokenData(testUserId, { price: 200 });

        // Assert - следующий getState должен обратиться к БД
        const updatedState = await stateManager.getState(testUserId);
        expect(updatedState?.token_data.price).toBe(200);
      });
    });

    describe('Получение всех состояний', () => {
      it('должен возвращать все открытые состояния', async () => {
        // Arrange
        const state1: UserPanelState = {
          user_id: testUserId,
          message_id: 123456,
          token_address: testTokenMint,
          mode: 'buy',
          token_data: {},
          user_data: {},
          action_data: {},
          activeLimitOrderId: undefined,
          created_at: Date.now(),
          closed: false,
          waiting_for: undefined
        };

        const state2: UserPanelState = {
          user_id: testUserId + 1,
          message_id: 789012,
          token_address: 'other_token',
          mode: 'sell',
          token_data: {},
          user_data: {},
          action_data: {},
          activeLimitOrderId: undefined,
          created_at: Date.now(),
          closed: false,
          waiting_for: undefined
        };

        await stateManager.setState(testUserId, state1);
        await stateManager.setState(testUserId + 1, state2);

        // Act
        const allStates = await stateManager.getAllStates();

        // Assert
        expect(allStates.length).toBeGreaterThanOrEqual(2);
        expect(allStates.some(s => s.user_id === testUserId)).toBe(true);
        expect(allStates.some(s => s.user_id === testUserId + 1)).toBe(true);
      });
    });
  });

  describe('Интеграция между компонентами', () => {
    it('должен работать с ордерами и состояниями пользователя', async () => {
      // Arrange
      const state: UserPanelState = {
        user_id: testUserId,
        message_id: 123456,
        token_address: testTokenMint,
        mode: 'limit',
        token_data: { symbol: 'TEST' },
        user_data: { balance: 1000 },
        action_data: { step: 'confirmation' },
        activeLimitOrderId: undefined,
        created_at: Date.now(),
        closed: false,
        waiting_for: undefined
      };

      const order: LimitOrder = {
        id: `test_integrated_${Date.now()}`,
        params: {
          userId: testUserId,
          tokenMint: testTokenMint,
          orderType: OrderType.BUY,
          amount: 100,
          price: 0.5
        } as LimitOrderParams,
        status: OrderStatus.PENDING,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      // Act
      await stateManager.setState(testUserId, state);
      await repository.create(order);

      // Update state with order ID
      state.activeLimitOrderId = order.id;
      await stateManager.setState(testUserId, state);

      // Assert
      const retrievedState = await stateManager.getState(testUserId);
      const retrievedOrder = await repository.findById(order.id);

      expect(retrievedState?.activeLimitOrderId).toBe(order.id);
      expect(retrievedOrder?.id).toBe(order.id);
      expect(retrievedOrder?.params.userId).toBe(testUserId);
    });

    it('должен обрабатывать сценарий с take profit ордерами', async () => {
      // Arrange
      const state: UserPanelState = {
        user_id: testUserId,
        message_id: 123456,
        token_address: testTokenMint,
        mode: 'limit',
        token_data: { symbol: 'TEST' },
        user_data: { balance: 1000 },
        action_data: { step: 'confirmation' },
        activeLimitOrderId: undefined,
        created_at: Date.now(),
        closed: false,
        waiting_for: undefined
      };

      const buyOrder: LimitOrder = {
        id: `test_tp_buy_${Date.now()}`,
        params: {
          userId: testUserId,
          tokenMint: testTokenMint,
          orderType: OrderType.BUY,
          amount: 100,
          price: 0.5
        } as LimitOrderParams,
        status: OrderStatus.PENDING,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      const takeProfitOrder: LimitOrder = {
        id: `test_tp_sell_${Date.now()}`,
        params: {
          userId: testUserId,
          tokenMint: testTokenMint,
          orderType: OrderType.SELL,
          amount: 100,
          price: 0.75
        } as LimitOrderParams,
        status: OrderStatus.INACTIVE,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      // Act
      await repository.createBuyOrderWithTakeProfit(buyOrder, takeProfitOrder);
      state.activeLimitOrderId = buyOrder.id;
      await stateManager.setState(testUserId, state);

      // Assert
      const retrievedState = await stateManager.getState(testUserId);
      const retrievedBuy = await repository.findById(buyOrder.id);
      const retrievedTp = await repository.findById(takeProfitOrder.id);

      expect(retrievedState?.activeLimitOrderId).toBe(buyOrder.id);
      expect(retrievedBuy?.linkedTakeProfitOrderId).toBe(takeProfitOrder.id);
      expect(retrievedTp?.linkedBuyOrderId).toBe(buyOrder.id);
    });
  });

  describe('SupabaseDirectClient Integration', () => {
    it('должен выполнять транзакции корректно', async () => {
      // Arrange
      const order: LimitOrder = {
        id: `test_transaction_${Date.now()}`,
        params: {
          userId: testUserId,
          tokenMint: testTokenMint,
          orderType: OrderType.BUY,
          amount: 100,
          price: 0.5
        } as LimitOrderParams,
        status: OrderStatus.PENDING,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      // Act
      await repository.create(order);

      // Assert
      const result = await repository.findById(order.id);
      expect(result).not.toBeNull();
    });

    it('должен обрабатывать ошибки подключения', async () => {
      // Arrange
      const invalidClient = new SupabaseDirectClient('invalid-project', 'invalid-connection-string');

      // Act & Assert
      const connected = await invalidClient.testConnection();
      expect(connected).toBe(false);

      await invalidClient.close();
    });

    it('должен возвращать статистику пула соединений', async () => {
      // Act
      const stats = directClient.getPoolStats();

      // Assert
      expect(stats).toBeDefined();
      expect(stats).toHaveProperty('totalCount');
      expect(stats).toHaveProperty('idleCount');
      expect(stats).toHaveProperty('waitingCount');
    });
  });
});
