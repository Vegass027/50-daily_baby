/**
 * Unit Tests для StateManager
 * Тестирует управление состоянием торговых панелей
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

describe('StateManager', () => {
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

  describe('constructor', () => {
    it('должен создать экземпляр с кэшем', () => {
      // Act & Assert
      expect(stateManager).toBeInstanceOf(StateManager);
    });

    it('должен запустить cleanup interval', () => {
      // Arrange
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      
      // Act
      const manager = new StateManager();
      
      // Assert
      expect(setIntervalSpy).toHaveBeenCalled();
      
      manager.dispose();
      setIntervalSpy.mockRestore();
    });
  });

  describe('getState', () => {
    it('должен вернуть состояние из базы данных', async () => {
      // Arrange
      const userId = 123;
      const mockDbState = {
        userId: BigInt(userId),
        messageId: BigInt(456),
        tokenAddress: 'token123',
        mode: PanelMode.TRADING,
        tokenData: JSON.stringify({ symbol: 'TEST' }),
        userData: JSON.stringify({ balance: 100 }),
        actionData: JSON.stringify({}),
        activeLimitOrderId: null,
        createdAt: new Date(),
        closed: false,
        waitingFor: null
      };

      prisma.userPanelState.findUnique.mockResolvedValue(mockDbState);

      // Act
      const state = await stateManager.getState(userId);

      // Assert
      expect(state).toBeDefined();
      expect(state?.user_id).toBe(userId);
      expect(state?.token_address).toBe('token123');
      expect(state?.mode).toBe('trading');
      expect(prisma.userPanelState.findUnique).toHaveBeenCalledWith({
        where: { userId: BigInt(userId) }
      });
    });

    it('должен вернуть null если состояние не найдено', async () => {
      // Arrange
      const userId = 123;
      prisma.userPanelState.findUnique.mockResolvedValue(null);

      // Act
      const state = await stateManager.getState(userId);

      // Assert
      expect(state).toBeNull();
    });

    it('должен вернуть null если состояние закрыто', async () => {
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

    it('должен использовать кэш', async () => {
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
      const state1 = await stateManager.getState(userId);
      
      // Assert - проверяем что был вызов к БД
      expect(prisma.userPanelState.findUnique).toHaveBeenCalledTimes(1);

      // Act - второй вызов (из кэша)
      const state2 = await stateManager.getState(userId);

      // Assert - не должно быть дополнительного вызова к БД
      expect(prisma.userPanelState.findUnique).toHaveBeenCalledTimes(1);
      expect(state1).toEqual(state2);
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
      
      // Перематываем время на 6 секунд (TTL = 5 секунд)
      jest.advanceTimersByTime(6000);
      
      // Act - второй вызов (кэш истек)
      await stateManager.getState(userId);

      // Assert - должен быть новый вызов к БД
      expect(prisma.userPanelState.findUnique).toHaveBeenCalledTimes(2);
    });
  });

  describe('setState', () => {
    it('должен создать новое состояние', async () => {
      // Arrange
      const userId = 123;
      const state: UserPanelState = {
        user_id: userId,
        message_id: 456,
        token_address: 'token123',
        mode: 'trading',
        token_data: { symbol: 'TEST' },
        user_data: { balance: 100 },
        action_data: {},
        activeLimitOrderId: undefined,
        created_at: Date.now(),
        closed: false,
        waiting_for: undefined
      };

      prisma.userPanelState.upsert.mockResolvedValue({});

      // Act
      await stateManager.setState(userId, state);

      // Assert
      expect(prisma.userPanelState.upsert).toHaveBeenCalledWith({
        where: { userId: BigInt(userId) },
        update: expect.objectContaining({
          messageId: 456,
          tokenAddress: 'token123',
          mode: PanelMode.TRADING
        }),
        create: expect.objectContaining({
          userId: BigInt(userId),
          messageId: 456,
          tokenAddress: 'token123',
          mode: PanelMode.TRADING
        })
      });
    });

    it('должен обновить существующее состояние', async () => {
      // Arrange
      const userId = 123;
      const state: UserPanelState = {
        user_id: userId,
        message_id: 456,
        token_address: 'token123',
        mode: 'trading',
        token_data: { symbol: 'TEST' },
        user_data: { balance: 100 },
        action_data: {},
        activeLimitOrderId: 'order123',
        created_at: Date.now(),
        closed: false,
        waiting_for: 'amount'
      };

      prisma.userPanelState.upsert.mockResolvedValue({});

      // Act
      await stateManager.setState(userId, state);

      // Assert
      expect(prisma.userPanelState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: BigInt(userId) },
          update: expect.objectContaining({
            activeLimitOrderId: 'order123',
            waitingFor: 'amount'
          })
        })
      );
    });

    it('должен обновлять кэш', async () => {
      // Arrange
      const userId = 123;
      const state: UserPanelState = {
        user_id: userId,
        message_id: 456,
        token_address: 'token123',
        mode: 'trading',
        token_data: { symbol: 'TEST' },
        user_data: { balance: 100 },
        action_data: {},
        activeLimitOrderId: undefined,
        created_at: Date.now(),
        closed: false,
        waiting_for: undefined
      };

      prisma.userPanelState.upsert.mockResolvedValue({});

      // Act
      await stateManager.setState(userId, state);

      // Assert - состояние должно быть в кэше
      const cachedState = await stateManager.getState(userId);
      expect(prisma.userPanelState.findUnique).not.toHaveBeenCalled();
    });

    it('должен обрабатывать ошибки', async () => {
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
      await expect(stateManager.setState(userId, state)).rejects.toThrow('Database error');
    });
  });

  describe('deleteState', () => {
    it('должен удалить состояние', async () => {
      // Arrange
      const userId = 123;
      prisma.userPanelState.delete.mockResolvedValue({});

      // Act
      await stateManager.deleteState(userId);

      // Assert
      expect(prisma.userPanelState.delete).toHaveBeenCalledWith({
        where: { userId: BigInt(userId) }
      });
    });

    it('должен очистить кэш', async () => {
      // Arrange
      const userId = 123;
      prisma.userPanelState.delete.mockResolvedValue({});

      // Act
      await stateManager.deleteState(userId);

      // Assert - следующий getState должен обратиться к БД
      prisma.userPanelState.findUnique.mockResolvedValue(null);
      await stateManager.getState(userId);
      expect(prisma.userPanelState.findUnique).toHaveBeenCalled();
    });

    it('должен игнорировать ошибку если состояние не найдено', async () => {
      // Arrange
      const userId = 123;
      const error = new Error('Record not found');
      (error as any).code = 'P2025';
      prisma.userPanelState.delete.mockRejectedValue(error);

      // Act & Assert - не должно выбросить ошибку
      await expect(stateManager.deleteState(userId)).resolves.not.toThrow();
    });

    it('должен выбросить ошибку при других ошибках', async () => {
      // Arrange
      const userId = 123;
      prisma.userPanelState.delete.mockRejectedValue(new Error('Other error'));

      // Act & Assert
      await expect(stateManager.deleteState(userId)).rejects.toThrow('Other error');
    });
  });

  describe('updateTokenData', () => {
    it('должен обновить token_data', async () => {
      // Arrange
      const userId = 123;
      const mockDbState = {
        tokenData: JSON.stringify({ symbol: 'OLD', price: 100 })
      };
      prisma.userPanelState.findUnique.mockResolvedValue(mockDbState);
      prisma.userPanelState.update.mockResolvedValue({});

      // Act
      await stateManager.updateTokenData(userId, { price: 200 });

      // Assert
      expect(prisma.userPanelState.update).toHaveBeenCalledWith({
        where: { userId: BigInt(userId) },
        data: {
          tokenData: JSON.stringify({ symbol: 'OLD', price: 200 })
        }
      });
    });

    it('должен очистить кэш', async () => {
      // Arrange
      const userId = 123;
      const mockDbState = {
        tokenData: JSON.stringify({})
      };
      prisma.userPanelState.findUnique.mockResolvedValue(mockDbState);
      prisma.userPanelState.update.mockResolvedValue({});

      // Act
      await stateManager.updateTokenData(userId, {});

      // Assert - следующий getState должен обратиться к БД
      prisma.userPanelState.findUnique.mockResolvedValue(null);
      await stateManager.getState(userId);
      expect(prisma.userPanelState.findUnique).toHaveBeenCalled();
    });
  });

  describe('updateUserData', () => {
    it('должен обновить user_data', async () => {
      // Arrange
      const userId = 123;
      const mockDbState = {
        userData: JSON.stringify({ balance: 100 })
      };
      prisma.userPanelState.findUnique.mockResolvedValue(mockDbState);
      prisma.userPanelState.update.mockResolvedValue({});

      // Act
      await stateManager.updateUserData(userId, { balance: 200 });

      // Assert
      expect(prisma.userPanelState.update).toHaveBeenCalledWith({
        where: { userId: BigInt(userId) },
        data: {
          userData: JSON.stringify({ balance: 200 })
        }
      });
    });
  });

  describe('updateActionData', () => {
    it('должен обновить action_data', async () => {
      // Arrange
      const userId = 123;
      const mockDbState = {
        actionData: JSON.stringify({ step: 'amount' })
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

  describe('getAllStates', () => {
    it('должен вернуть все открытые состояния', async () => {
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
          closed: false,
          waitingFor: null
        }
      ];

      prisma.userPanelState.findMany.mockResolvedValue(mockDbStates);

      // Act
      const states = await stateManager.getAllStates();

      // Assert
      expect(states).toHaveLength(2);
      expect(states[0].user_id).toBe(123);
      expect(states[1].user_id).toBe(456);
      expect(prisma.userPanelState.findMany).toHaveBeenCalledWith({
        where: { closed: false }
      });
    });

    it('должен конвертировать BigInt в number', async () => {
      // Arrange
      const mockDbState = {
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
      };

      prisma.userPanelState.findMany.mockResolvedValue([mockDbState]);

      // Act
      const states = await stateManager.getAllStates();

      // Assert
      expect(states[0].user_id).toBe(123);
      expect(typeof states[0].user_id).toBe('number');
    });
  });

  describe('cleanupInactiveStates', () => {
    it('должен удалить старые состояния', async () => {
      // Arrange
      prisma.userPanelState.deleteMany.mockResolvedValue({ count: 5 });

      // Act
      await stateManager['cleanupInactiveStates']();

      // Assert
      expect(prisma.userPanelState.deleteMany).toHaveBeenCalledWith({
        where: {
          createdAt: expect.any(Date)
        }
      });
    });

    it('должен логировать количество удаленных состояний', async () => {
      // Arrange
      prisma.userPanelState.deleteMany.mockResolvedValue({ count: 10 });

      // Act
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      await stateManager['cleanupInactiveStates']();

      // Assert
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Cleaned up 10 inactive states')
      );
      consoleSpy.mockRestore();
    });
  });

  describe('dispose', () => {
    it('должен очистить все ресурсы', () => {
      // Act
      stateManager.dispose();

      // Assert
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      stateManager.dispose();
      expect(consoleSpy).toHaveBeenCalledWith('[StateManager] Disposed');
      consoleSpy.mockRestore();
    });

    it('должен очистить кэш', () => {
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

      // Act
      stateManager.dispose();

      // Assert - после dispose кэш должен быть очищен
      prisma.userPanelState.findUnique.mockClear();
      const state = await stateManager.getState(userId);
      expect(prisma.userPanelState.findUnique).toHaveBeenCalled();
    });
  });

  describe('конвертация типов', () => {
    it('должен корректно конвертировать mode из DB в app', async () => {
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

      // Act
      const state = await stateManager.getState(userId);

      // Assert
      expect(state?.mode).toBe('trading');
    });

    it('должен корректно конвертировать mode из app в DB', async () => {
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

      // Act
      await stateManager.setState(userId, state);

      // Assert
      expect(prisma.userPanelState.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            mode: PanelMode.TRADING
          })
        })
      );
    });
  });
});
