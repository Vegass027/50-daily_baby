/**
 * Unit Tests для PositionTracker
 * Тестирует управление торговыми позициями через Prisma.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PositionTracker } from '../../src/services/PositionTracker';
import { prisma } from '../../src/services/PrismaClient';
import { Position, Trade } from '@prisma/client';

// Mock Prisma client
vi.mock('../../src/services/PrismaClient', () => ({
  prisma: {
    position: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    trade: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

describe('PositionTracker', () => {
  let positionTracker: PositionTracker;

  beforeEach(() => {
    positionTracker = new PositionTracker();
    vi.clearAllMocks();
    
    // Mock the transaction implementation
    (prisma.$transaction as any).mockImplementation(async (callback: any) => {
        const mockTx = {
            position: {
                findUnique: prisma.position.findUnique,
                create: prisma.position.create,
                update: prisma.position.update,
            },
            trade: {
                create: prisma.trade.create,
            },
        };
        return await callback(mockTx);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('recordTrade', () => {
    it('должен создать новую позицию при первой покупке', async () => {
      // Arrange
      const userId = 1;
      const tokenAddress = 'token_address_new';
      const price = 100;
      const size = 10;

      const mockPosition = {
        id: 'pos_1',
        userId: BigInt(userId),
        tokenAddress,
        entryPrice: 0,
        size: 0,
      };
      const mockCreatedPosition = { ...mockPosition, id: 'pos_created_1' };
      const mockUpdatedPosition = { ...mockCreatedPosition, size: size, entryPrice: price };
      
      (prisma.position.findUnique as any).mockResolvedValue(null);
      (prisma.position.create as any).mockResolvedValue(mockCreatedPosition);
      (prisma.position.update as any).mockResolvedValue(mockUpdatedPosition);
      (prisma.trade.create as any).mockResolvedValue({});

      // Act
      const result = await positionTracker.recordTrade(userId, tokenAddress, 'BUY', price, size);

      // Assert
      expect(prisma.position.findUnique).toHaveBeenCalledWith({ where: { userId_tokenAddress: { userId: BigInt(userId), tokenAddress } } });
      expect(prisma.position.create).toHaveBeenCalled();
      expect(prisma.position.update).toHaveBeenCalledWith({
          where: { id: mockCreatedPosition.id },
          data: { size: size, entryPrice: price },
      });
      expect(prisma.trade.create).toHaveBeenCalled();
      expect(result.size).toBe(size);
      expect(result.entryPrice).toBe(price);
    });

    it('должен обновить существующую позицию при покупке', async () => {
        // Arrange
        const userId = 2;
        const tokenAddress = 'token_address_existing';
        const price = 120;
        const size = 5;
  
        const existingPosition = {
          id: 'pos_2',
          userId: BigInt(userId),
          tokenAddress,
          entryPrice: 100,
          size: 10,
        };

        const expectedNewSize = 15;
        const expectedNewEntryPrice = (100 * 10 + 120 * 5) / 15;
  
        (prisma.position.findUnique as any).mockResolvedValue(existingPosition);
        (prisma.position.update as any).mockResolvedValue({ ...existingPosition, size: expectedNewSize, entryPrice: expectedNewEntryPrice });
        (prisma.trade.create as any).mockResolvedValue({});
  
        // Act
        const result = await positionTracker.recordTrade(userId, tokenAddress, 'BUY', price, size);
  
        // Assert
        expect(prisma.position.findUnique).toHaveBeenCalled();
        expect(prisma.position.create).not.toHaveBeenCalled();
        expect(prisma.position.update).toHaveBeenCalledWith({
            where: { id: existingPosition.id },
            data: { size: expectedNewSize, entryPrice: expectedNewEntryPrice },
        });
        expect(result.size).toBe(expectedNewSize);
        expect(result.entryPrice).toBeCloseTo(expectedNewEntryPrice);
      });

      it('должен обновить позицию при продаже', async () => {
        // Arrange
        const userId = 3;
        const tokenAddress = 'token_address_sell';
        const price = 110;
        const size = 5;
  
        const existingPosition = {
          id: 'pos_3',
          userId: BigInt(userId),
          tokenAddress,
          entryPrice: 100,
          size: 10,
        };

        const expectedNewSize = 5;
  
        (prisma.position.findUnique as any).mockResolvedValue(existingPosition);
        (prisma.position.update as any).mockResolvedValue({ ...existingPosition, size: expectedNewSize });
        (prisma.trade.create as any).mockResolvedValue({});
  
        // Act
        const result = await positionTracker.recordTrade(userId, tokenAddress, 'SELL', price, size);
  
        // Assert
        expect(prisma.position.update).toHaveBeenCalledWith({
            where: { id: existingPosition.id },
            data: { size: expectedNewSize, entryPrice: existingPosition.entryPrice },
        });
        expect(result.size).toBe(expectedNewSize);
      });

      it('должен выбросить ошибку при попытке продать больше, чем есть в позиции', async () => {
        // Arrange
        const userId = 4;
        const tokenAddress = 'token_address_oversell';
        const price = 110;
        const size = 15; // Попытка продать больше, чем есть
  
        const existingPosition = {
          id: 'pos_4',
          userId: BigInt(userId),
          tokenAddress,
          entryPrice: 100,
          size: 10,
        };
  
        (prisma.position.findUnique as any).mockResolvedValue(existingPosition);
  
        // Act & Assert
        await expect(positionTracker.recordTrade(userId, tokenAddress, 'SELL', price, size))
          .rejects.toThrow('Cannot sell 15 tokens. You only have 10.');
      });
  });

  describe('getAllUserPositions', () => {
    it('должен возвращать все открытые позиции пользователя', async () => {
      // Arrange
      const userId = 5;
      const mockDbPositions = [
        { id: 'pos_5_1', userId: BigInt(userId), tokenAddress: 'token1', size: 10, entryPrice: 100 },
        { id: 'pos_5_2', userId: BigInt(userId), tokenAddress: 'token2', size: 0, entryPrice: 200 }, // Закрытая позиция
        { id: 'pos_5_3', userId: BigInt(userId), tokenAddress: 'token3', size: 5, entryPrice: 300 },
      ];

      (prisma.position.findMany as any).mockResolvedValue(mockDbPositions.filter(p => p.size > 0));

      // Act
      const result = await positionTracker.getAllUserPositions(userId);

      // Assert
      expect(prisma.position.findMany).toHaveBeenCalledWith({
        where: { userId: BigInt(userId), size: { gt: 0 } },
      });
      expect(result).toHaveLength(2);
      expect(result.every(p => p.size > 0)).toBe(true);
    });
  });
});