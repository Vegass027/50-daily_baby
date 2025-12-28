/**
 * Integration Tests для State Workflow
 * Тестирует полный цикл работы с состояниями панелей
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { StateManager } from '../../src/services/StateManager';
import { UserPanelState } from '../../src/types/panel';
import { PanelMode } from '@prisma/client';

// Mock Prisma
jest.mock('../../src/services/PrismaClient', () => ({
  prisma: {
    userPanelState: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn()
    }
  }
}));

const { prisma } = require('../../src/services/PrismaClient');

describe('State Workflow Integration', () => {
  let stateManager: StateManager;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    stateManager = new StateManager();
  });

  afterEach(() => {
    stateManager.dispose();
    jest.useRealTimers();
  });

  describe('полный цикл состояния', () => {
    it('должен создать состояние, обновить и удалить', async () => {
      // Arrange
      const userId = 123;
      const state: UserPanelState = {
        user_id: userId,
        message_id: 456,
        token_address: 'token123',
        mode: 'trading',
        token_data: { symbol: 'TEST', price: 0.5 },
        user_data: { balance: 100 },
        action_data: { step: 'amount' },
        activeLimitOrderId: undefined,
        created_at: Date.now(),
        closed: false,
        waiting_for: 'amount'
      };

      prisma.userPanelState.upsert.mockResolvedValue({});

      // Act - создаем состояние
      await stateManager.setState(userId, state);

      // Assert
      expect(prisma.userPanelState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: BigInt(userId) },
          create: expect.objectContaining({
            userId: BigInt(userId),
            tokenAddress: 'token123',
            mode: PanelMode.TRADING
          })
        })
      );

      // Act - получаем состояние
      const mockDbState = {
        userId: BigInt(userId),
        messageId: BigInt(456),
        tokenAddress: 'token123',
        mode: PanelMode.TRADING,
        tokenData: JSON.stringify(state.token_data),
        userData: JSON.stringify(state.user_data),
        actionData: JSON.stringify(state.action_data),
        activeLimitOrderId: null,
        createdAt: new Date(state.created_at),
        closed: false,
        waitingFor: 'amount'
      };

      prisma.userPanelState.findUnique.mockResolvedValue(mockDbState);

      const loadedState = await stateManager.getState(userId);

      // Assert
      expect(loadedState).toBeDefined();
      expect(loadedState?.user_id).toBe(userId);
      expect(loadedState?.token_address).toBe('token123');

      // Act - обновляем состояние
      state.token_data = { symbol: 'TEST', price: 0.6 };
      state.user_data = { balance: 150 };
      await stateManager.updateTokenData(userId, { price: 0.6 });
      await stateManager.updateUserData(userId, { balance: 150 });

      // Assert
      expect(prisma.userPanelState.update).toHaveBeenCalledTimes(2);

      // Act - удаляем состояние
      prisma.userPanelState.delete.mockResolvedValue({});
      await stateManager.deleteState(userId);

      // Assert
      expect(prisma.userPanelState.delete).toHaveBeenCalledWith({
        where: { userId: BigInt(userId) }
      });
    });
  });

  describe('кэширование', () => {
    it('должен корректно использовать кэш в течение жизненного цикла', async () => {
      // Arrange
      const userId = 123;
      const state: UserPanelState = {
        user_id: userId,
        message_id: 456,
        token_address: 'token123',
        mode: 'trading',
        token_data: { symbol: 'TEST' },
        user_data: {},
        action_data: {},
        activeLimitOrderId: undefined,
        created_at: Date.now(),
        closed: false,
        waiting_for: undefined
      };

      const mockDbState = {
        userId: BigInt(userId),
        messageId: BigInt(456),
        tokenAddress: 'token123',
        mode: PanelMode.TRADING,
        tokenData: JSON.stringify(state.token_data),
        userData: JSON.stringify(state.user_data),
        actionData: JSON.stringify(state.action_data),
        activeLimitOrderId: null,
        createdAt: new Date(state.created_at),
        closed: false,
        waitingFor: null
      };

      prisma.userPanelState.findUnique.mockResolvedValue(mockDbState);

      // Act - первый вызов (из БД)
      const state1 = await stateManager.getState(userId);

      // Assert
      expect(prisma.userPanelState.findUnique).toHaveBeenCalledTimes(1);
      expect(state1?.token_address).toBe('token123');

      // Act - второй вызов (из кэша)
      const state2 = await stateManager.getState(userId);

      // Assert - не было нового запроса к БД
      expect(prisma.userPanelState.findUnique).toHaveBeenCalledTimes(1);
      expect(state2).toEqual(state1);

      // Act - обновляем состояние (кэш инвалидирован)
      await stateManager.updateTokenData(userId, { price: 0.6 });

      // Assert - следующий getState должен обратиться к БД
      prisma.userPanelState.findUnique.mockClear();
      const state3 = await stateManager.getState(userId);
      expect(prisma.userPanelState.findUnique).toHaveBeenCalledTimes(1);
    });

    it('должен обновлять кэш при истечении TTL', async () => {
      // Arrange
      const userId = 123;
      const mockDbState = {
        userId: BigInt(userId),
        messageId: BigInt(456),
        tokenAddress: 'token123',
        mode: PanelMode.TRADING,
        tokenData: JSON.stringify({}),
        userData: JSON.stringify({}),
        actionData: JSON.stringify({}),
        activeLimitOrderId: null,
        createdAt: new Date(),
        closed: false,
        waitingFor: null
      };

      prisma.userPanelState.findUnique.mockResolvedValue(mockDbState);

      // Act - первый вызов
      await stateManager.getState(userId);
      expect(prisma.userPanelState.findUnique).toHaveBeenCalledTimes(1);

      // Перематываем время на 6 секунд (TTL = 5 секунд)
      jest.advanceTimersByTime(6000);

      // Act - второй вызов (кэш истек)
      await stateManager.getState(userId);

      // Assert - должен быть новый вызов к БД
      expect(prisma.userPanelState.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  describe('множественные состояния', () => {
    it('должен корректно обрабатывать состояния нескольких пользователей', async () => {
      // Arrange
      const states: UserPanelState[] = [
        {
          user_id: 123,
          message_id: 456,
          token_address: 'token1',
          mode: 'trading',
          token_data: { symbol: 'TEST1' },
          user_data: {},
          action_data: {},
          activeLimitOrderId: undefined,
          created_at: Date.now(),
          closed: false,
          waiting_for: undefined
        },
        {
          user_id: 456,
          message_id: 789,
          token_address: 'token2',
          mode: 'trading',
          token_data: { symbol: 'TEST2' },
          user_data: {},
          action_data: {},
          activeLimitOrderId: undefined,
          created_at: Date.now(),
          closed: false,
          waiting_for: undefined
        }
      ];

      const mockDbStates = states.map(state => ({
        userId: BigInt(state.user_id),
        messageId: BigInt(state.message_id),
        tokenAddress: state.token_address,
        mode: PanelMode.TRADING,
        tokenData: JSON.stringify(state.token_data),
        userData: JSON.stringify(state.user_data),
        actionData: JSON.stringify(state.action_data),
        activeLimitOrderId: null,
        createdAt: new Date(state.created_at),
        closed: false,
        waitingFor: null
      }));

      prisma.userPanelState.findMany.mockResolvedValue(mockDbStates);

      // Act - получаем все состояния
      const allStates = await stateManager.getAllStates();

      // Assert
      expect(allStates).toHaveLength(2);
      expect(allStates[0].user_id).toBe(123);
      expect(allStates[1].user_id).toBe(456);

      // Act - получаем состояние первого пользователя
      prisma.userPanelState.findUnique.mockResolvedValue(mockDbStates[0]);
      const state1 = await stateManager.getState(123);

      // Assert
      expect(state1?.token_address).toBe('token1');

      // Act - получаем состояние второго пользователя
      prisma.userPanelState.findUnique.mockResolvedValue(mockDbStates[1]);
      const state2 = await stateManager.getState(456);

      // Assert
      expect(state2?.token_address).toBe('token2');
    });
  });

  describe('обновление полей', () => {
    it('должен корректно обновлять token_data', async () => {
      // Arrange
      const userId = 123;
      const mockDbState = {
        userId: BigInt(userId),
        messageId: BigInt(456),
        tokenAddress: 'token123',
        mode: PanelMode.TRADING,
        tokenData: JSON.stringify({ symbol: 'TEST', price: 0.5 }),
        userData: JSON.stringify({}),
        actionData: JSON.stringify({}),
        activeLimitOrderId: null,
        createdAt: new Date(),
        closed: false,
        waitingFor: null
      };

      prisma.userPanelState.findUnique.mockResolvedValue(mockDbState);
      prisma.userPanelState.update.mockResolvedValue({});

      // Act
      await stateManager.updateTokenData(userId, { price: 0.6 });

      // Assert
      expect(prisma.userPanelState.update).toHaveBeenCalledWith({
        where: { userId: BigInt(userId) },
        data: {
          tokenData: JSON.stringify({ symbol: 'TEST', price: 0.6 })
        }
      });
    });

    it('должен корректно обновлять user_data', async () => {
      // Arrange
      const userId = 123;
      const mockDbState = {
        userId: BigInt(userId),
        messageId: BigInt(456),
        tokenAddress: 'token123',
        mode: PanelMode.TRADING,
        tokenData: JSON.stringify({}),
        userData: JSON.stringify({ balance: 100 }),
        actionData: JSON.stringify({}),
        activeLimitOrderId: null,
        createdAt: new Date(),
        closed: false,
        waitingFor: null
      };

      prisma.userPanelState.findUnique.mockResolvedValue(mockDbState);
      prisma.userPanelState.update.mockResolvedValue({});

      // Act
      await stateManager.updateUserData(userId, { balance: 150 });

      // Assert
      expect(prisma.userPanelState.update).toHaveBeenCalledWith({
        where: { userId: BigInt(userId) },
        data: {
          userData: JSON.stringify({ balance: 150 })
        }
      });
    });

    it('должен корректно обновлять action_data', async () => {
      // Arrange
      const userId = 123;
      const mockDbState = {
        userId: BigInt(userId),
        messageId: BigInt(456),
        tokenAddress: 'token123',
        mode: PanelMode.TRADING,
        tokenData: JSON.stringify({}),
        userData: JSON.stringify({}),
        actionData: JSON.stringify({ step: 'amount' }),
        activeLimitOrderId: null,
        createdAt: new Date(),
        closed: false,
        waitingFor: null
      };

      prisma.userPanelState.findUnique.mockResolvedValue(mockDbState);
      prisma.userPanelState.update.mockResolvedValue({});

      // Act
      await stateManager.updateActionData(userId, { step: 'confirmation' });

      // Assert
      expect(prisma.userPanelState.update).toHaveBeenCalledWith({
        where: { userId: BigInt(userId) },
        data: {
          actionData: JSON.stringify({ step: 'confirmation' })
        }
      });
    });
  });

  describe('закрытые состояния', () => {
    it('должен возвращать null для закрытых состояний', async () => {
      // Arrange
      const userId = 123;
      const mockDbState = {
        userId: BigInt(userId),
        messageId: BigInt(456),
        tokenAddress: 'token123',
        mode: PanelMode.TRADING,
        tokenData: JSON.stringify({}),
        userData: JSON.stringify({}),
        actionData: JSON.stringify({}),
        activeLimitOrderId: null,
        createdAt: new Date(),
        closed: true,
        waitingFor: null
      };

      prisma.userPanelState.findUnique.mockResolvedValue(mockDbState);

      // Act
      const state = await stateManager.getState(userId);

      // Assert
      expect(state).toBeNull();
    });

    it('должен возвращать только открытые состояния в getAllStates', async () => {
      // Arrange
      const mockDbStates = [
        {
          userId: BigInt(123),
          messageId: BigInt(456),
          tokenAddress: 'token1',
          mode: PanelMode.TRADING,
          tokenData: JSON.stringify({}),
          userData: JSON.stringify({}),
          actionData: JSON.stringify({}),
          activeLimitOrderId: null,
          createdAt: new Date(),
          closed: false,
          waitingFor: null
        },
        {
          userId: BigInt(456),
          messageId: BigInt(789),
          tokenAddress: 'token2',
          mode: PanelMode.TRADING,
          tokenData: JSON.stringify({}),
          userData: JSON.stringify({}),
          actionData: JSON.stringify({}),
          activeLimitOrderId: null,
          createdAt: new Date(),
          closed: true,
          waitingFor: null
        }
      ];

      prisma.userPanelState.findMany.mockResolvedValue(mockDbStates);

      // Act
      const allStates = await stateManager.getAllStates();

      // Assert
      expect(allStates).toHaveLength(1);
      expect(allStates[0].user_id).toBe(123);
    });
  });

  describe('обработка ошибок', () => {
    it('должен корректно обрабатывать ошибки базы данных', async () => {
      // Arrange
      const userId = 123;
      const state: UserPanelState = {
        user_id: userId,
        message_id: 456,
        token_address: 'token123',
        mode: 'trading',
        token_data: {},
        user_data: {},
        action_data: {},
        activeLimitOrderId: undefined,
        created_at: Date.now(),
        closed: false,
        waiting_for: undefined
      };

      prisma.userPanelState.upsert.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(stateManager.setState(userId, state))
        .rejects.toThrow('Database error');
    });

    it('должен корректно обрабатывать ошибки при удалении', async () => {
      // Arrange
      const userId = 123;
      prisma.userPanelState.delete.mockRejectedValue(new Error('Delete error'));

      // Act & Assert
      await expect(stateManager.deleteState(userId))
        .rejects.toThrow('Delete error');
    });

    it('должен игнорировать ошибку если состояние не найдено при удалении', async () => {
      // Arrange
      const userId = 123;
      const error = new Error('Record not found');
      (error as any).code = 'P2025';
      prisma.userPanelState.delete.mockRejectedValue(error);

      // Act & Assert - не должно выбросить ошибку
      await expect(stateManager.deleteState(userId)).resolves.not.toThrow();
    });
  });

  describe('очистка ресурсов', () => {
    it('должен корректно очищать ресурсы при dispose', () => {
      // Arrange
      const userId = 123;
      const state: UserPanelState = {
        user_id: userId,
        message_id: 456,
        token_address: 'token123',
        mode: 'trading',
        token_data: {},
        user_data: {},
        action_data: {},
        activeLimitOrderId: undefined,
        created_at: Date.now(),
        closed: false,
        waiting_for: undefined
      };

      prisma.userPanelState.upsert.mockResolvedValue({});
      prisma.userPanelState.findUnique.mockResolvedValue({
        userId: BigInt(userId),
        messageId: BigInt(456),
        tokenAddress: 'token123',
        mode: PanelMode.TRADING,
        tokenData: JSON.stringify({}),
        userData: JSON.stringify({}),
        actionData: JSON.stringify({}),
        activeLimitOrderId: null,
        createdAt: new Date(),
        closed: false,
        waitingFor: null
      });

      // Act - создаем состояние и загружаем в кэш
      stateManager.setState(userId, state);
      stateManager.getState(userId);

      // Assert - кэш не пуст
      expect(prisma.userPanelState.findUnique).toHaveBeenCalled();

      // Act - очищаем ресурсы
      stateManager.dispose();

      // Assert - следующий getState должен обратиться к БД (кэш очищен)
      prisma.userPanelState.findUnique.mockClear();
      stateManager.getState(userId);
      expect(prisma.userPanelState.findUnique).toHaveBeenCalled();
    });
  });
});
