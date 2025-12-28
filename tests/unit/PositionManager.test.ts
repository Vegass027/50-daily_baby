/**
 * Unit Tests для PositionManager
 * Тестирует управление торговыми позициями
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PositionManager, Position, CreatePositionParams, ClosePositionParams } from '../../src/trading/managers/PositionManager';
import { prisma } from '../../src/services/PrismaClient';

// Mock Prisma client
vi.mock('../../src/services/PrismaClient', () => ({
  prisma: {
    position: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    },
    trade: {
      create: vi.fn()
    },
    linkedOrder: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn()
    }
  }
}));

describe('PositionManager', () => {
  let positionManager: PositionManager;

  beforeEach(() => {
    positionManager = new PositionManager();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createPosition', () => {
    it('должен создать новую позицию', async () => {
      // Arrange
      const userId = 123;
      const params: CreatePositionParams = {
        tokenMint: 'TestTokenMint12345678901234567890',
        tokenType: 'DEX_POOL',
        entryPrice: 0.0005,
        size: 1000,
        openTxSignature: 'tx_signature_123',
        orderType: 'MARKET_BUY'
      };

      const mockDbPosition = {
        id: 'pos_123',
        userId: BigInt(userId),
        tokenAddress: params.tokenMint,
        entryPrice: params.entryPrice,
        size: params.size,
        tokenType: params.tokenType,
        orderType: params.orderType,
        status: 'OPEN',
        openTxSignature: params.openTxSignature,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      (prisma.position.findUnique as any).mockResolvedValue(null);
      (prisma.position.create as any).mockResolvedValue(mockDbPosition);

      // Act
      const result = await positionManager.createPosition(userId, params);

      // Assert
      expect(result.id).toBe('pos_123');
      expect(result.userId).toBe(userId);
      expect(result.tokenMint).toBe(params.tokenMint);
      expect(result.entryPrice).toBe(params.entryPrice);
      expect(result.size).toBe(params.size);
      expect(result.status).toBe('OPEN');
      expect(result.orderType).toBe(params.orderType);
      expect(result.openTxSignature).toBe(params.openTxSignature);
      expect(prisma.position.findUnique).toHaveBeenCalledWith({
        where: {
          userId_tokenAddress: {
            userId: BigInt(userId),
            tokenAddress: params.tokenMint
          }
        }
      });
      expect(prisma.position.create).toHaveBeenCalledWith({
        data: {
          userId: BigInt(userId),
          tokenAddress: params.tokenMint,
          tokenType: params.tokenType,
          entryPrice: params.entryPrice,
          size: params.size,
          status: 'OPEN',
          orderType: params.orderType,
          openTxSignature: params.openTxSignature
        }
      });
    });

    it('должен обновить существующую позицию', async () => {
      // Arrange
      const userId = 123;
      const params: CreatePositionParams = {
        tokenMint: 'TestTokenMint12345678901234567890',
        tokenType: 'DEX_POOL',
        entryPrice: 0.0006,
        size: 500,
        openTxSignature: 'tx_signature_456',
        orderType: 'MARKET_BUY'
      };

      const existingPosition = {
        id: 'pos_456',
        userId: BigInt(userId),
        tokenAddress: params.tokenMint,
        entryPrice: 0.0005,
        size: 1000,
        tokenType: 'DEX_POOL',
        orderType: 'MARKET_BUY',
        status: 'OPEN',
        openTxSignature: 'old_tx',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const updatedPosition = {
        ...existingPosition,
        size: 1500, // 1000 + 500
        entryPrice: 0.0005333333333333333, // (0.0005*1000 + 0.0006*500) / 1500
        updatedAt: new Date()
      };

      (prisma.position.findUnique as any).mockResolvedValue(existingPosition);
      (prisma.position.update as any).mockResolvedValue(updatedPosition);

      // Act
      const result = await positionManager.createPosition(userId, params);

      // Assert
      expect(result.size).toBe(1500);
      expect(result.entryPrice).toBeCloseTo(0.000533, 6);
      expect(prisma.position.update).toHaveBeenCalledWith({
        where: { id: 'pos_456' },
        data: {
          size: 1500,
          entryPrice: expect.any(Number),
          tokenType: params.tokenType,
          updatedAt: expect.any(Date)
        }
      });
    });

    it('должен создавать позицию для bonding curve токена', async () => {
      // Arrange
      const userId = 456;
      const params: CreatePositionParams = {
        tokenMint: 'PumpFunTokenMint1234567890',
        tokenType: 'BONDING_CURVE',
        entryPrice: 0.0001,
        size: 5000,
        openTxSignature: 'tx_signature_789',
        orderType: 'LIMIT_BUY'
      };

      const mockDbPosition = {
        id: 'pos_789',
        userId: BigInt(userId),
        tokenAddress: params.tokenMint,
        tokenType: params.tokenType,
        orderType: params.orderType,
        status: 'OPEN',
        entryPrice: params.entryPrice,
        size: params.size,
        openTxSignature: params.openTxSignature,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      (prisma.position.findUnique as any).mockResolvedValue(null);
      (prisma.position.create as any).mockResolvedValue(mockDbPosition);

      // Act
      const result = await positionManager.createPosition(userId, params);

      // Assert
      expect(result.tokenType).toBe('BONDING_CURVE');
      expect(result.orderType).toBe('LIMIT_BUY');
    });
  });

  describe('closePosition', () => {
    it('должен закрыть позицию и создать запись в trade history', async () => {
      // Arrange
      const positionId = 'pos_123';
      const params: ClosePositionParams = {
        exitPrice: 0.00075,
        exitTxSignature: 'sell_tx_123',
        realizedPnL: 0.5,
        realizedPnLPercent: 50
      };

      const mockPosition = {
        id: positionId,
        userId: BigInt(123),
        tokenAddress: 'TestTokenMint12345678901234567890',
        tokenType: 'DEX_POOL',
        orderType: 'MARKET_BUY',
        status: 'OPEN',
        entryPrice: 0.0005,
        size: 1000,
        openTxSignature: 'buy_tx_123',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      (prisma.position.findUnique as any).mockResolvedValue(mockPosition);
      (prisma.position.update as any).mockResolvedValue({
        ...mockPosition,
        status: 'CLOSED',
        exitPrice: params.exitPrice,
        closedAt: new Date(),
        exitTxSignature: params.exitTxSignature,
        realizedPnL: params.realizedPnL,
        realizedPnLPercent: params.realizedPnLPercent,
        updatedAt: new Date()
      });
      (prisma.trade.create as any).mockResolvedValue({ id: 'trade_123' });

      // Act
      await positionManager.closePosition(positionId, params);

      // Assert
      expect(prisma.position.findUnique).toHaveBeenCalledWith({ where: { id: positionId } });
      expect(prisma.position.update).toHaveBeenCalledWith({
        where: { id: positionId },
        data: {
          status: 'CLOSED',
          exitPrice: params.exitPrice,
          closedAt: expect.any(Date),
          exitTxSignature: params.exitTxSignature,
          realizedPnL: params.realizedPnL,
          realizedPnLPercent: params.realizedPnLPercent,
          updatedAt: expect.any(Date)
        }
      });
      expect(prisma.trade.create).toHaveBeenCalledWith({
        data: {
          positionId: positionId,
          type: 'SELL',
          price: params.exitPrice,
          size: mockPosition.size,
          timestamp: expect.any(Date)
        }
      });
    });

    it('должен выбросить ошибку если позиция не найдена', async () => {
      // Arrange
      const positionId = 'non_existent_pos';
      const params: ClosePositionParams = {
        exitPrice: 0.00075,
        exitTxSignature: 'sell_tx_456',
        realizedPnL: 0.5,
        realizedPnLPercent: 50
      };

      (prisma.position.findUnique as any).mockResolvedValue(null);

      // Act & Assert
      await expect(positionManager.closePosition(positionId, params))
        .rejects.toThrow('not found');
    });
  });

  describe('getPosition', () => {
    it('должен вернуть позицию по ID', async () => {
      // Arrange
      const positionId = 'pos_123';
      const mockDbPosition = {
        id: positionId,
        userId: BigInt(123),
        tokenAddress: 'TestTokenMint12345678901234567890',
        tokenType: 'DEX_POOL',
        orderType: 'MARKET_BUY',
        status: 'OPEN',
        entryPrice: 0.0005,
        size: 1000,
        openTxSignature: 'tx_123',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      (prisma.position.findUnique as any).mockResolvedValue(mockDbPosition);

      // Act
      const result = await positionManager.getPosition(positionId);

      // Assert
      expect(result).not.toBeNull();
      expect(result?.id).toBe(positionId);
      expect(result?.userId).toBe(123);
      expect(result?.tokenMint).toBe(mockDbPosition.tokenAddress);
      expect(prisma.position.findUnique).toHaveBeenCalledWith({ where: { id: positionId } });
    });

    it('должен вернуть null если позиция не найдена', async () => {
      // Arrange
      const positionId = 'non_existent_pos';

      (prisma.position.findUnique as any).mockResolvedValue(null);

      // Act
      const result = await positionManager.getPosition(positionId);

      // Assert
      expect(result).toBeNull();
    });
  });

  describe('getPositionByToken', () => {
    it('должен вернуть позицию по токену', async () => {
      // Arrange
      const userId = 123;
      const tokenMint = 'TestTokenMint12345678901234567890';
      const mockDbPosition = {
        id: 'pos_123',
        userId: BigInt(userId),
        tokenAddress: tokenMint,
        tokenType: 'DEX_POOL',
        orderType: 'MARKET_BUY',
        status: 'OPEN',
        entryPrice: 0.0005,
        size: 1000,
        openTxSignature: 'tx_123',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      (prisma.position.findUnique as any).mockResolvedValue(mockDbPosition);

      // Act
      const result = await positionManager.getPositionByToken(userId, tokenMint);

      // Assert
      expect(result).not.toBeNull();
      expect(result?.tokenMint).toBe(tokenMint);
      expect(prisma.position.findUnique).toHaveBeenCalledWith({
        where: {
          userId_tokenAddress: {
            userId: BigInt(userId),
            tokenAddress: tokenMint
          }
        }
      });
    });
  });

  describe('getOpenPositions', () => {
    it('должен вернуть только открытые позиции пользователя', async () => {
      // Arrange
      const userId = 123;
      const mockDbPositions = [
        {
          id: 'pos_1',
          userId: BigInt(userId),
          tokenAddress: 'Token1',
          tokenType: 'DEX_POOL',
          orderType: 'MARKET_BUY',
          status: 'OPEN',
          entryPrice: 0.0005,
          size: 1000,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: 'pos_2',
          userId: BigInt(userId),
          tokenAddress: 'Token2',
          tokenType: 'DEX_POOL',
          orderType: 'MARKET_BUY',
          status: 'OPEN',
          entryPrice: 0.001,
          size: 500,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: 'pos_3',
          userId: BigInt(userId),
          tokenAddress: 'Token3',
          tokenType: 'DEX_POOL',
          orderType: 'MARKET_BUY',
          status: 'CLOSED',
          entryPrice: 0.0002,
          size: 200,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      (prisma.position.findMany as any).mockResolvedValue(mockDbPositions.filter(p => p.status === 'OPEN'));

      // Act
      const result = await positionManager.getOpenPositions(userId);

      // Assert
      expect(result).toHaveLength(2); // Только 2 открытые позиции
      expect(result.every(p => p.status === 'OPEN')).toBe(true);
      expect(prisma.position.findMany).toHaveBeenCalledWith({
        where: {
          userId: BigInt(userId),
          status: 'OPEN'
        },
        orderBy: {
          createdAt: 'desc'
        }
      });
    });

    it('должен вернуть пустой массив если нет открытых позиций', async () => {
      // Arrange
      const userId = 999;

      (prisma.position.findMany as any).mockResolvedValue([]);

      // Act
      const result = await positionManager.getOpenPositions(userId);

      // Assert
      expect(result).toHaveLength(0);
    });
  });

  describe('getAllPositions', () => {
    it('должен вернуть все позиции пользователя', async () => {
      // Arrange
      const userId = 123;
      const mockDbPositions = [
        {
          id: 'pos_1',
          userId: BigInt(userId),
          tokenAddress: 'Token1',
          tokenType: 'DEX_POOL',
          orderType: 'MARKET_BUY',
          status: 'OPEN',
          entryPrice: 0.0005,
          size: 1000,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: 'pos_2',
          userId: BigInt(userId),
          tokenAddress: 'Token2',
          tokenType: 'DEX_POOL',
          orderType: 'MARKET_BUY',
          status: 'CLOSED',
          entryPrice: 0.001,
          size: 500,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      (prisma.position.findMany as any).mockResolvedValue(mockDbPositions);

      // Act
      const result = await positionManager.getAllPositions(userId);

      // Assert
      expect(result).toHaveLength(2);
      expect(prisma.position.findMany).toHaveBeenCalledWith({
        where: {
          userId: BigInt(userId)
        },
        orderBy: {
          createdAt: 'desc'
        }
      });
    });
  });

  describe('getAllOpenPositions', () => {
    it('должен вернуть все открытые позиции для всех пользователей', async () => {
      // Arrange
      const mockDbPositions = [
        {
          id: 'pos_1',
          userId: BigInt(123),
          tokenAddress: 'Token1',
          tokenType: 'DEX_POOL',
          orderType: 'MARKET_BUY',
          status: 'OPEN',
          entryPrice: 0.0005,
          size: 1000,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: 'pos_2',
          userId: BigInt(456),
          tokenAddress: 'Token2',
          tokenType: 'DEX_POOL',
          orderType: 'MARKET_BUY',
          status: 'OPEN',
          entryPrice: 0.001,
          size: 500,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      (prisma.position.findMany as any).mockResolvedValue(mockDbPositions);

      // Act
      const result = await positionManager.getAllOpenPositions();

      // Assert
      expect(result).toHaveLength(2);
      expect(prisma.position.findMany).toHaveBeenCalledWith({
        where: {
          status: 'OPEN'
        },
        orderBy: {
          createdAt: 'desc'
        }
      });
    });
  });

  describe('linkOrderToPosition', () => {
    it('должен создать связь ордера с позицией', async () => {
      // Arrange
      const positionId = 'pos_123';
      const orderId = 'order_123';
      const orderType = 'TAKE_PROFIT' as const;

      (prisma.linkedOrder.findUnique as any).mockResolvedValue(null);
      (prisma.linkedOrder.create as any).mockResolvedValue({ id: 'linked_123' });

      // Act
      await positionManager.linkOrderToPosition(positionId, orderId, orderType);

      // Assert
      expect(prisma.linkedOrder.findUnique).toHaveBeenCalledWith({ where: { positionId } });
      expect(prisma.linkedOrder.create).toHaveBeenCalledWith({
        data: {
          positionId,
          tpOrderId: orderId,
          orderType: 'jupiter'
        }
      });
    });

    it('должен обновить существующую связь', async () => {
      // Arrange
      const positionId = 'pos_456';
      const orderId = 'order_456';
      const orderType = 'STOP_LOSS' as const;

      const existingLinkedOrder = {
        id: 'linked_456',
        positionId,
        tpOrderId: 'old_tp_order',
        orderType: 'jupiter'
      };

      (prisma.linkedOrder.findUnique as any).mockResolvedValue(existingLinkedOrder);
      (prisma.linkedOrder.update as any).mockResolvedValue(existingLinkedOrder);

      // Act
      await positionManager.linkOrderToPosition(positionId, orderId, orderType);

      // Assert
      expect(prisma.linkedOrder.update).toHaveBeenCalledWith({
        where: { positionId },
        data: { slOrderId: orderId }
      });
    });
  });

  describe('getLinkedOrders', () => {
    it('должен вернуть связанные ордера для позиции', async () => {
      // Arrange
      const positionId = 'pos_123';
      const mockLinkedOrder = {
        id: 'linked_123',
        positionId,
        tpOrderId: 'tp_123',
        slOrderId: 'sl_123',
        orderType: 'jupiter'
      };

      (prisma.linkedOrder.findUnique as any).mockResolvedValue(mockLinkedOrder);

      // Act
      const result = await positionManager.getLinkedOrders(positionId);

      // Assert
      expect(result.tpOrderId).toBe('tp_123');
      expect(result.slOrderId).toBe('sl_123');
    });

    it('должен вернуть undefined если нет связанных ордеров', async () => {
      // Arrange
      const positionId = 'pos_456';

      (prisma.linkedOrder.findUnique as any).mockResolvedValue(null);

      // Act
      const result = await positionManager.getLinkedOrders(positionId);

      // Assert
      expect(result.tpOrderId).toBeUndefined();
      expect(result.slOrderId).toBeUndefined();
    });
  });

  describe('unlinkOrderFromPosition', () => {
    it('должен удалить связь ордера с позицией', async () => {
      // Arrange
      const positionId = 'pos_123';
      const orderType = 'TAKE_PROFIT' as const;

      (prisma.linkedOrder.update as any).mockResolvedValue({ id: 'linked_123' });

      // Act
      await positionManager.unlinkOrderFromPosition(positionId, orderType);

      // Assert
      expect(prisma.linkedOrder.update).toHaveBeenCalledWith({
        where: { positionId },
        data: { tpOrderId: null }
      });
    });
  });
});
