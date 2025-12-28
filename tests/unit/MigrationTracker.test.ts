import { MigrationTracker } from '../../src/trading/managers/MigrationTracker';
import { PumpFunPriceService } from '../../src/services/PumpFunPriceService';
import { JupiterPriceService } from '../../src/services/JupiterPriceService';

// Mock dependencies
jest.mock('../../src/services/PumpFunPriceService');
jest.mock('../../src/services/JupiterPriceService');

describe('MigrationTracker', () => {
  let migrationTracker: MigrationTracker;
  let mockPumpFunService: jest.Mocked<PumpFunPriceService>;
  let mockJupiterService: jest.Mocked<JupiterPriceService>;

  beforeEach(() => {
    mockPumpFunService = new PumpFunPriceService() as jest.Mocked<PumpFunPriceService>;
    mockJupiterService = new JupiterPriceService() as jest.Mocked<JupiterPriceService>;

    migrationTracker = new MigrationTracker();
    (migrationTracker as any).pumpFunService = mockPumpFunService;
    (migrationTracker as any).jupiterPriceService = mockJupiterService;

    jest.clearAllMocks();
  });

  describe('onMigration', () => {
    it('should register callback for token migration', () => {
      const callback = jest.fn();

      migrationTracker.onMigration('test-mint', callback);

      expect(migrationTracker.getCallbackCount('test-mint')).toBe(1);
    });

    it('should register multiple callbacks for same token', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      migrationTracker.onMigration('test-mint', callback1);
      migrationTracker.onMigration('test-mint', callback2);

      expect(migrationTracker.getCallbackCount('test-mint')).toBe(2);
    });

    it('should register callbacks for different tokens', () => {
      const callback = jest.fn();

      migrationTracker.onMigration('test-mint-1', callback);
      migrationTracker.onMigration('test-mint-2', callback);

      expect(migrationTracker.getCallbackCount('test-mint-1')).toBe(1);
      expect(migrationTracker.getCallbackCount('test-mint-2')).toBe(1);
    });
  });

  describe('checkMigration', () => {
    it('should return false if token does not exist', async () => {
      mockPumpFunService.getTokenStatus.mockResolvedValue({
        exists: false,
        onBondingCurve: false,
        migrated: false,
        raydiumPool: null,
        marketCap: 0
      });

      const migrated = await migrationTracker.checkMigration('test-mint');

      expect(migrated).toBe(false);
      expect(mockPumpFunService.getTokenStatus).toHaveBeenCalledWith('test-mint');
    });

    it('should return false if token is on bonding curve but not migrated', async () => {
      mockPumpFunService.getTokenStatus.mockResolvedValue({
        exists: true,
        onBondingCurve: true,
        migrated: false,
        raydiumPool: null,
        marketCap: 500000
      });

      const migrated = await migrationTracker.checkMigration('test-mint');

      expect(migrated).toBe(false);
    });

    it('should return true and call callbacks when token migrates', async () => {
      const callback = jest.fn();
      migrationTracker.onMigration('test-mint', callback);

      mockPumpFunService.getTokenStatus.mockResolvedValue({
        exists: true,
        onBondingCurve: false,
        migrated: true,
        raydiumPool: 'pool-address',
        marketCap: 1000000
      });

      const migrated = await migrationTracker.checkMigration('test-mint');

      expect(migrated).toBe(true);
      expect(callback).toHaveBeenCalledWith('test-mint');
    });

    it('should call all registered callbacks', async () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();
      const callback3 = jest.fn();

      migrationTracker.onMigration('test-mint', callback1);
      migrationTracker.onMigration('test-mint', callback2);
      migrationTracker.onMigration('test-mint', callback3);

      mockPumpFunService.getTokenStatus.mockResolvedValue({
        exists: true,
        onBondingCurve: false,
        migrated: true,
        raydiumPool: 'pool-address',
        marketCap: 1000000
      });

      await migrationTracker.checkMigration('test-mint');

      expect(callback1).toHaveBeenCalledWith('test-mint');
      expect(callback2).toHaveBeenCalledWith('test-mint');
      expect(callback3).toHaveBeenCalledWith('test-mint');
    });

    it('should cache migration status', async () => {
      mockPumpFunService.getTokenStatus.mockResolvedValue({
        exists: true,
        onBondingCurve: false,
        migrated: true,
        raydiumPool: 'pool-address',
        marketCap: 1000000
      });

      // First call - should hit API
      await migrationTracker.checkMigration('test-mint');
      expect(mockPumpFunService.getTokenStatus).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      await migrationTracker.checkMigration('test-mint');
      expect(mockPumpFunService.getTokenStatus).toHaveBeenCalledTimes(1);
    });

    it('should handle callback errors gracefully', async () => {
      const errorCallback = jest.fn(() => {
        throw new Error('Callback error');
      });
      const successCallback = jest.fn();

      migrationTracker.onMigration('test-mint', errorCallback);
      migrationTracker.onMigration('test-mint', successCallback);

      mockPumpFunService.getTokenStatus.mockResolvedValue({
        exists: true,
        onBondingCurve: false,
        migrated: true,
        raydiumPool: 'pool-address',
        marketCap: 1000000
      });

      await migrationTracker.checkMigration('test-mint');

      expect(errorCallback).toHaveBeenCalled();
      expect(successCallback).toHaveBeenCalled();
    });

    it('should handle API errors gracefully', async () => {
      mockPumpFunService.getTokenStatus.mockRejectedValue(new Error('API Error'));

      const migrated = await migrationTracker.checkMigration('test-mint');

      expect(migrated).toBe(false);
    });

    it('should expire cache after TTL', async () => {
      mockPumpFunService.getTokenStatus.mockResolvedValue({
        exists: true,
        onBondingCurve: false,
        migrated: true,
        raydiumPool: 'pool-address',
        marketCap: 1000000
      });

      // First call - cache
      await migrationTracker.checkMigration('test-mint');
      expect(mockPumpFunService.getTokenStatus).toHaveBeenCalledTimes(1);

      // Expire cache (simulate by modifying cache timestamp)
      const cache = (migrationTracker as any).migrationCache;
      const cached = cache.get('test-mint');
      if (cached) {
        cached.timestamp = Date.now() - 40000; // 40 seconds ago (TTL is 30s)
      }

      // Second call - should hit API again
      await migrationTracker.checkMigration('test-mint');
      expect(mockPumpFunService.getTokenStatus).toHaveBeenCalledTimes(2);
    });
  });

  describe('getPoolAddress', () => {
    it('should return pool address for migrated token', async () => {
      mockPumpFunService.getTokenStatus.mockResolvedValue({
        exists: true,
        onBondingCurve: false,
        migrated: true,
        raydiumPool: 'pool-address',
        marketCap: 1000000
      });

      const poolAddress = await migrationTracker.getPoolAddress('test-mint');

      expect(poolAddress).toBe('pool-address');
      expect(mockPumpFunService.getTokenStatus).toHaveBeenCalledWith('test-mint');
    });

    it('should return null for non-migrated token', async () => {
      mockPumpFunService.getTokenStatus.mockResolvedValue({
        exists: true,
        onBondingCurve: true,
        migrated: false,
        raydiumPool: null,
        marketCap: 500000
      });

      const poolAddress = await migrationTracker.getPoolAddress('test-mint');

      expect(poolAddress).toBeNull();
    });

    it('should handle API errors gracefully', async () => {
      mockPumpFunService.getTokenStatus.mockRejectedValue(new Error('API Error'));

      const poolAddress = await migrationTracker.getPoolAddress('test-mint');

      expect(poolAddress).toBeNull();
    });
  });

  describe('offMigration', () => {
    it('should remove specific callback', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      migrationTracker.onMigration('test-mint', callback1);
      migrationTracker.onMigration('test-mint', callback2);

      expect(migrationTracker.getCallbackCount('test-mint')).toBe(2);

      migrationTracker.offMigration('test-mint', callback1);

      expect(migrationTracker.getCallbackCount('test-mint')).toBe(1);
    });

    it('should remove callback entry when last callback removed', () => {
      const callback = jest.fn();

      migrationTracker.onMigration('test-mint', callback);
      expect(migrationTracker.hasCallbacks('test-mint')).toBe(true);

      migrationTracker.offMigration('test-mint', callback);

      expect(migrationTracker.hasCallbacks('test-mint')).toBe(false);
    });

    it('should not affect other callbacks', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();
      const callback3 = jest.fn();

      migrationTracker.onMigration('test-mint', callback1);
      migrationTracker.onMigration('test-mint', callback2);
      migrationTracker.onMigration('test-mint', callback3);

      migrationTracker.offMigration('test-mint', callback2);

      expect(migrationTracker.getCallbackCount('test-mint')).toBe(2);
    });
  });

  describe('removeAllCallbacks', () => {
    it('should remove all callbacks for token', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();
      const callback3 = jest.fn();

      migrationTracker.onMigration('test-mint', callback1);
      migrationTracker.onMigration('test-mint', callback2);
      migrationTracker.onMigration('test-mint', callback3);

      expect(migrationTracker.getCallbackCount('test-mint')).toBe(3);

      migrationTracker.removeAllCallbacks('test-mint');

      expect(migrationTracker.hasCallbacks('test-mint')).toBe(false);
    });
  });

  describe('hasCallbacks', () => {
    it('should return true if callbacks exist', () => {
      const callback = jest.fn();
      migrationTracker.onMigration('test-mint', callback);

      expect(migrationTracker.hasCallbacks('test-mint')).toBe(true);
    });

    it('should return false if no callbacks exist', () => {
      expect(migrationTracker.hasCallbacks('test-mint')).toBe(false);
    });
  });

  describe('getCallbackCount', () => {
    it('should return correct count', () => {
      expect(migrationTracker.getCallbackCount('test-mint')).toBe(0);

      migrationTracker.onMigration('test-mint', jest.fn());
      migrationTracker.onMigration('test-mint', jest.fn());
      migrationTracker.onMigration('test-mint', jest.fn());

      expect(migrationTracker.getCallbackCount('test-mint')).toBe(3);
    });
  });

  describe('getTrackedTokens', () => {
    it('should return list of tracked tokens', () => {
      migrationTracker.onMigration('test-mint-1', jest.fn());
      migrationTracker.onMigration('test-mint-2', jest.fn());
      migrationTracker.onMigration('test-mint-3', jest.fn());

      const trackedTokens = migrationTracker.getTrackedTokens();

      expect(trackedTokens).toHaveLength(3);
      expect(trackedTokens).toContain('test-mint-1');
      expect(trackedTokens).toContain('test-mint-2');
      expect(trackedTokens).toContain('test-mint-3');
    });

    it('should return empty array if no tokens tracked', () => {
      const trackedTokens = migrationTracker.getTrackedTokens();

      expect(trackedTokens).toHaveLength(0);
    });
  });

  describe('clearMigrationCache', () => {
    it('should clear cache for specific token', async () => {
      mockPumpFunService.getTokenStatus.mockResolvedValue({
        exists: true,
        onBondingCurve: false,
        migrated: true,
        raydiumPool: 'pool-address',
        marketCap: 1000000
      });

      // Cache migration status
      await migrationTracker.checkMigration('test-mint');

      const cacheInfo1 = migrationTracker.getCacheInfo();
      expect(cacheInfo1.size).toBe(1);

      // Clear cache for specific token
      migrationTracker.clearMigrationCache('test-mint');

      const cacheInfo2 = migrationTracker.getCacheInfo();
      expect(cacheInfo2.size).toBe(0);
    });

    it('should clear all cache if no token specified', async () => {
      mockPumpFunService.getTokenStatus.mockResolvedValue({
        exists: true,
        onBondingCurve: false,
        migrated: true,
        raydiumPool: 'pool-address',
        marketCap: 1000000
      });

      // Cache migration status for multiple tokens
      await migrationTracker.checkMigration('test-mint-1');
      await migrationTracker.checkMigration('test-mint-2');

      const cacheInfo1 = migrationTracker.getCacheInfo();
      expect(cacheInfo1.size).toBe(2);

      // Clear all cache
      migrationTracker.clearMigrationCache();

      const cacheInfo2 = migrationTracker.getCacheInfo();
      expect(cacheInfo2.size).toBe(0);
    });
  });

  describe('clearExpiredCache', () => {
    it('should clear only expired entries', async () => {
      mockPumpFunService.getTokenStatus.mockResolvedValue({
        exists: true,
        onBondingCurve: false,
        migrated: true,
        raydiumPool: 'pool-address',
        marketCap: 1000000
      });

      // Cache entries with different timestamps
      await migrationTracker.checkMigration('test-mint-1');
      await migrationTracker.checkMigration('test-mint-2');

      // Expire first entry
      const cache = (migrationTracker as any).migrationCache;
      const cached1 = cache.get('test-mint-1');
      if (cached1) {
        cached1.timestamp = Date.now() - 40000;
      }

      // Clear expired
      migrationTracker.clearExpiredCache();

      const cacheInfo = migrationTracker.getCacheInfo();
      expect(cacheInfo.size).toBe(1);
      expect(cacheInfo.entries[0].mint).toBe('test-mint-2');
    });

    it('should not log if no expired entries', async () => {
      mockPumpFunService.getTokenStatus.mockResolvedValue({
        exists: true,
        onBondingCurve: false,
        migrated: true,
        raydiumPool: 'pool-address',
        marketCap: 1000000
      });

      await migrationTracker.checkMigration('test-mint');

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      migrationTracker.clearExpiredCache();

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('getCacheInfo', () => {
    it('should return cache information', async () => {
      mockPumpFunService.getTokenStatus.mockResolvedValue({
        exists: true,
        onBondingCurve: false,
        migrated: true,
        raydiumPool: 'pool-address',
        marketCap: 1000000
      });

      await migrationTracker.checkMigration('test-mint');

      const info = migrationTracker.getCacheInfo();

      expect(info.size).toBe(1);
      expect(info.entries).toHaveLength(1);
      expect(info.entries[0].mint).toBe('test-mint');
      expect(info.entries[0].migrated).toBe(true);
      expect(info.entries[0].age).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      migrationTracker.onMigration('test-mint-1', callback1);
      migrationTracker.onMigration('test-mint-1', callback2);
      migrationTracker.onMigration('test-mint-2', callback1);

      const stats = migrationTracker.getStats();

      expect(stats.trackedTokens).toBe(2);
      expect(stats.totalCallbacks).toBe(3);
      expect(stats.cacheSize).toBe(0);
      expect(stats.migratedTokens).toBe(0);
    });
  });

  describe('reset', () => {
    it('should clear all callbacks and cache', () => {
      migrationTracker.onMigration('test-mint-1', jest.fn());
      migrationTracker.onMigration('test-mint-2', jest.fn());

      expect(migrationTracker.getTrackedTokens()).toHaveLength(2);

      migrationTracker.reset();

      expect(migrationTracker.getTrackedTokens()).toHaveLength(0);
      expect(migrationTracker.getCacheInfo().size).toBe(0);
    });
  });
});
