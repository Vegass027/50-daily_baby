import { PriorityFeeManager } from '../../src/trading/managers/PriorityFeeManager';
import { Connection } from '@solana/web3.js';

// Mock Connection
const mockConnection = {
  getRecentPrioritizationFees: jest.fn(),
} as any;

describe('PriorityFeeManager', () => {
  let manager: PriorityFeeManager;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new PriorityFeeManager(mockConnection);
  });

  describe('getOptimalFee', () => {
    it('should return cached fee if available', async () => {
      (mockConnection.getRecentPrioritizationFees as jest.Mock).mockResolvedValue([
        { prioritizationFee: 1000 },
        { prioritizationFee: 2000 },
        { prioritizationFee: 3000 },
      ]);

      // First call - should fetch from RPC
      const fee1 = await manager.getOptimalFee(undefined, 'normal');
      expect(fee1).toBeGreaterThan(0);
      expect(mockConnection.getRecentPrioritizationFees).toHaveBeenCalledTimes(1);

      // Second call within cache TTL - should use cache
      const fee2 = await manager.getOptimalFee(undefined, 'normal');
      expect(fee2).toBe(fee1);
      expect(mockConnection.getRecentPrioritizationFees).toHaveBeenCalledTimes(1);
    });

    it('should calculate low strategy fee correctly', async () => {
      (mockConnection.getRecentPrioritizationFees as jest.Mock).mockResolvedValue([
        { prioritizationFee: 1000 },
        { prioritizationFee: 2000 },
        { prioritizationFee: 3000 },
      ]);

      const fee = await manager.getOptimalFee(undefined, 'low');
      expect(fee).toBeGreaterThanOrEqual(2000); // median * 1.0
    });

    it('should calculate normal strategy fee correctly', async () => {
      (mockConnection.getRecentPrioritizationFees as jest.Mock).mockResolvedValue([
        { prioritizationFee: 1000 },
        { prioritizationFee: 2000 },
        { prioritizationFee: 3000 },
      ]);

      const fee = await manager.getOptimalFee(undefined, 'normal');
      expect(fee).toBeGreaterThanOrEqual(2300); // median * 1.15
    });

    it('should calculate aggressive strategy fee correctly', async () => {
      (mockConnection.getRecentPrioritizationFees as jest.Mock).mockResolvedValue([
        { prioritizationFee: 1000 },
        { prioritizationFee: 2000 },
        { prioritizationFee: 3000 },
        { prioritizationFee: 4000 },
        { prioritizationFee: 5000 },
        { prioritizationFee: 6000 },
        { prioritizationFee: 7000 },
        { prioritizationFee: 8000 },
        { prioritizationFee: 9000 },
        { prioritizationFee: 10000 },
      ]);

      const fee = await manager.getOptimalFee(undefined, 'aggressive');
      expect(fee).toBeGreaterThanOrEqual(9000); // top 10%
    });

    it('should return fallback fee on error', async () => {
      (mockConnection.getRecentPrioritizationFees as jest.Mock).mockRejectedValue(
        new Error('RPC error')
      );

      const fee = await manager.getOptimalFee(undefined, 'normal');
      expect(fee).toBe(10000); // fallback for normal
    });

    it('should return fallback fee on empty response', async () => {
      (mockConnection.getRecentPrioritizationFees as jest.Mock).mockResolvedValue([]);

      const fee = await manager.getOptimalFee(undefined, 'normal');
      expect(fee).toBe(10000); // fallback for normal
    });

    it('should apply minimum fee', async () => {
      (mockConnection.getRecentPrioritizationFees as jest.Mock).mockResolvedValue([
        { prioritizationFee: 0 },
        { prioritizationFee: 0 },
        { prioritizationFee: 0 },
      ]);

      const fee = await manager.getOptimalFee(undefined, 'normal');
      expect(fee).toBeGreaterThanOrEqual(1000); // minimum fee
    });
  });

  describe('clearCache', () => {
    it('should clear the cache', async () => {
      (mockConnection.getRecentPrioritizationFees as jest.Mock).mockResolvedValue([
        { prioritizationFee: 1000 },
      ]);

      await manager.getOptimalFee(undefined, 'normal');
      expect(mockConnection.getRecentPrioritizationFees).toHaveBeenCalledTimes(1);

      manager.clearCache();

      await manager.getOptimalFee(undefined, 'normal');
      expect(mockConnection.getRecentPrioritizationFees).toHaveBeenCalledTimes(2);
    });
  });

  describe('getCacheStats', () => {
    it('should return cache statistics', async () => {
      (mockConnection.getRecentPrioritizationFees as jest.Mock).mockResolvedValue([
        { prioritizationFee: 1000 },
      ]);

      await manager.getOptimalFee(undefined, 'normal');
      await manager.getOptimalFee(undefined, 'low');

      const stats = manager.getCacheStats();
      expect(stats.size).toBe(2);
      expect(stats.entries).toHaveLength(2);
      expect(stats.entries[0].key).toBe('undefined_normal');
      expect(stats.entries[1].key).toBe('undefined_low');
    });
  });
});
