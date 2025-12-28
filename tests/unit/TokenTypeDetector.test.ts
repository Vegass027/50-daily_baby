import { TokenTypeDetector } from '../../src/trading/managers/TokenTypeDetector';
import { UnifiedPriceService } from '../../src/services/UnifiedPriceService';
import { PumpFunPriceService } from '../../src/services/PumpFunPriceService';

// Mock dependencies
jest.mock('../../src/services/UnifiedPriceService');
jest.mock('../../src/services/PumpFunPriceService');

describe('TokenTypeDetector', () => {
  let tokenTypeDetector: TokenTypeDetector;
  let mockUnifiedPriceService: jest.Mocked<UnifiedPriceService>;
  let mockPumpFunService: jest.Mocked<PumpFunPriceService>;

  beforeEach(() => {
    mockUnifiedPriceService = new UnifiedPriceService() as jest.Mocked<UnifiedPriceService>;
    mockPumpFunService = new PumpFunPriceService() as jest.Mocked<PumpFunPriceService>;

    tokenTypeDetector = new TokenTypeDetector(mockUnifiedPriceService);
    (tokenTypeDetector as any).pumpFunPriceService = mockPumpFunService;

    jest.clearAllMocks();
  });

  describe('detectType', () => {
    it('should detect DEX_POOL token type', async () => {
      mockUnifiedPriceService.getTokenType.mockResolvedValue('DEX_POOL');

      const type = await tokenTypeDetector.detectType('test-mint');

      expect(type).toBe('DEX_POOL');
      expect(mockUnifiedPriceService.getTokenType).toHaveBeenCalledWith('test-mint');
    });

    it('should detect BONDING_CURVE token type', async () => {
      mockUnifiedPriceService.getTokenType.mockResolvedValue('BONDING_CURVE');

      const type = await tokenTypeDetector.detectType('test-mint');

      expect(type).toBe('BONDING_CURVE');
      expect(mockUnifiedPriceService.getTokenType).toHaveBeenCalledWith('test-mint');
    });

    it('should cache token type', async () => {
      mockUnifiedPriceService.getTokenType.mockResolvedValue('DEX_POOL');

      // First call - should hit API
      await tokenTypeDetector.detectType('test-mint');
      expect(mockUnifiedPriceService.getTokenType).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      await tokenTypeDetector.detectType('test-mint');
      expect(mockUnifiedPriceService.getTokenType).toHaveBeenCalledTimes(1);
    });

    it('should check migration for cached BONDING_CURVE tokens', async () => {
      mockUnifiedPriceService.getTokenType.mockResolvedValue('BONDING_CURVE');
      mockPumpFunService.getTokenStatus.mockResolvedValue({
        exists: true,
        onBondingCurve: true,
        migrated: true,
        raydiumPool: 'pool-address',
        marketCap: 1000000
      });

      // First call - cache as BONDING_CURVE
      await tokenTypeDetector.detectType('test-mint');

      // Second call - should check migration and update to DEX_POOL
      const type = await tokenTypeDetector.detectType('test-mint');

      expect(type).toBe('DEX_POOL');
      expect(mockPumpFunService.getTokenStatus).toHaveBeenCalledWith('test-mint');
    });

    it('should not check migration for DEX_POOL tokens', async () => {
      mockUnifiedPriceService.getTokenType.mockResolvedValue('DEX_POOL');

      // First call
      await tokenTypeDetector.detectType('test-mint');

      // Second call - should not check migration
      await tokenTypeDetector.detectType('test-mint');

      expect(mockPumpFunService.getTokenStatus).not.toHaveBeenCalled();
    });

    it('should handle migration check errors gracefully', async () => {
      mockUnifiedPriceService.getTokenType.mockResolvedValue('BONDING_CURVE');
      mockPumpFunService.getTokenStatus.mockRejectedValue(new Error('API Error'));

      // First call - cache as BONDING_CURVE
      const type1 = await tokenTypeDetector.detectType('test-mint');
      expect(type1).toBe('BONDING_CURVE');

      // Second call - should handle error and return cached type
      const type2 = await tokenTypeDetector.detectType('test-mint');
      expect(type2).toBe('BONDING_CURVE');
    });

    it('should expire cache after TTL', async () => {
      mockUnifiedPriceService.getTokenType.mockResolvedValue('DEX_POOL');

      // First call - cache
      await tokenTypeDetector.detectType('test-mint');

      // Wait for cache to expire (simulate by modifying cache timestamp)
      const cache = (tokenTypeDetector as any).cache;
      const cached = cache.get('test-mint');
      if (cached) {
        cached.timestamp = Date.now() - 70000; // 70 seconds ago (TTL is 60s)
      }

      // Second call - should hit API again
      await tokenTypeDetector.detectType('test-mint');
      expect(mockUnifiedPriceService.getTokenType).toHaveBeenCalledTimes(2);
    });
  });

  describe('forceUpdateType', () => {
    it('should clear cache and fetch fresh type', async () => {
      mockUnifiedPriceService.getTokenType.mockResolvedValue('DEX_POOL');

      // Cache a value
      await tokenTypeDetector.detectType('test-mint');
      expect(mockUnifiedPriceService.getTokenType).toHaveBeenCalledTimes(1);

      // Force update
      const type = await tokenTypeDetector.forceUpdateType('test-mint');
      expect(type).toBe('DEX_POOL');
      expect(mockUnifiedPriceService.getTokenType).toHaveBeenCalledTimes(2);
    });

    it('should log force update', async () => {
      mockUnifiedPriceService.getTokenType.mockResolvedValue('BONDING_CURVE');
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await tokenTypeDetector.forceUpdateType('test-mint');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Force updated type for')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('shouldUpdateType', () => {
    it('should return false for DEX_POOL tokens', async () => {
      mockPumpFunService.getTokenStatus.mockResolvedValue({
        exists: true,
        onBondingCurve: false,
        migrated: true,
        raydiumPool: 'pool-address',
        marketCap: 1000000
      });

      const shouldUpdate = await tokenTypeDetector.shouldUpdateType('test-mint', 'DEX_POOL');

      expect(shouldUpdate).toBe(false);
      expect(mockPumpFunService.getTokenStatus).not.toHaveBeenCalled();
    });

    it('should return true for migrated BONDING_CURVE tokens', async () => {
      mockPumpFunService.getTokenStatus.mockResolvedValue({
        exists: true,
        onBondingCurve: false,
        migrated: true,
        raydiumPool: 'pool-address',
        marketCap: 1000000
      });

      const shouldUpdate = await tokenTypeDetector.shouldUpdateType('test-mint', 'BONDING_CURVE');

      expect(shouldUpdate).toBe(true);
      expect(mockPumpFunService.getTokenStatus).toHaveBeenCalledWith('test-mint');
    });

    it('should return false for non-migrated BONDING_CURVE tokens', async () => {
      mockPumpFunService.getTokenStatus.mockResolvedValue({
        exists: true,
        onBondingCurve: true,
        migrated: false,
        raydiumPool: null,
        marketCap: 500000
      });

      const shouldUpdate = await tokenTypeDetector.shouldUpdateType('test-mint', 'BONDING_CURVE');

      expect(shouldUpdate).toBe(false);
    });

    it('should handle errors gracefully', async () => {
      mockPumpFunService.getTokenStatus.mockRejectedValue(new Error('API Error'));

      const shouldUpdate = await tokenTypeDetector.shouldUpdateType('test-mint', 'BONDING_CURVE');

      expect(shouldUpdate).toBe(false);
    });
  });

  describe('getCachedType', () => {
    it('should return cached type if exists and valid', async () => {
      mockUnifiedPriceService.getTokenType.mockResolvedValue('DEX_POOL');

      // Cache a value
      await tokenTypeDetector.detectType('test-mint');

      // Get cached type
      const cachedType = tokenTypeDetector.getCachedType('test-mint');
      expect(cachedType).toBe('DEX_POOL');
    });

    it('should return null if not in cache', () => {
      const cachedType = tokenTypeDetector.getCachedType('test-mint');
      expect(cachedType).toBeNull();
    });

    it('should return null if cache expired', async () => {
      mockUnifiedPriceService.getTokenType.mockResolvedValue('DEX_POOL');

      // Cache a value
      await tokenTypeDetector.detectType('test-mint');

      // Expire cache
      const cache = (tokenTypeDetector as any).cache;
      const cached = cache.get('test-mint');
      if (cached) {
        cached.timestamp = Date.now() - 70000;
      }

      // Get cached type
      const cachedType = tokenTypeDetector.getCachedType('test-mint');
      expect(cachedType).toBeNull();
    });
  });

  describe('hasInCache', () => {
    it('should return true if token is in cache', async () => {
      mockUnifiedPriceService.getTokenType.mockResolvedValue('DEX_POOL');

      await tokenTypeDetector.detectType('test-mint');

      expect(tokenTypeDetector.hasInCache('test-mint')).toBe(true);
    });

    it('should return false if token is not in cache', () => {
      expect(tokenTypeDetector.hasInCache('test-mint')).toBe(false);
    });
  });

  describe('clearCache', () => {
    it('should clear all cache entries', async () => {
      mockUnifiedPriceService.getTokenType.mockResolvedValue('DEX_POOL');

      // Cache some values
      await tokenTypeDetector.detectType('test-mint-1');
      await tokenTypeDetector.detectType('test-mint-2');

      expect(tokenTypeDetector.getCacheSize()).toBe(2);

      // Clear cache
      tokenTypeDetector.clearCache();

      expect(tokenTypeDetector.getCacheSize()).toBe(0);
    });

    it('should log cache clear', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      tokenTypeDetector.clearCache();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('TokenTypeDetector cache cleared')
      );

      consoleSpy.mockRestore();
    });
  });

  describe('clearExpiredCache', () => {
    it('should clear only expired entries', async () => {
      mockUnifiedPriceService.getTokenType.mockResolvedValue('DEX_POOL');

      // Cache values with different timestamps
      await tokenTypeDetector.detectType('test-mint-1');
      await tokenTypeDetector.detectType('test-mint-2');

      // Expire first entry
      const cache = (tokenTypeDetector as any).cache;
      const cached1 = cache.get('test-mint-1');
      if (cached1) {
        cached1.timestamp = Date.now() - 70000;
      }

      // Clear expired
      tokenTypeDetector.clearExpiredCache();

      expect(tokenTypeDetector.hasInCache('test-mint-1')).toBe(false);
      expect(tokenTypeDetector.hasInCache('test-mint-2')).toBe(true);
    });

    it('should not log if no expired entries', async () => {
      mockUnifiedPriceService.getTokenType.mockResolvedValue('DEX_POOL');

      await tokenTypeDetector.detectType('test-mint');

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      tokenTypeDetector.clearExpiredCache();

      expect(consoleSpy).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });
  });

  describe('getCacheSize', () => {
    it('should return correct cache size', async () => {
      mockUnifiedPriceService.getTokenType.mockResolvedValue('DEX_POOL');

      expect(tokenTypeDetector.getCacheSize()).toBe(0);

      await tokenTypeDetector.detectType('test-mint-1');
      await tokenTypeDetector.detectType('test-mint-2');
      await tokenTypeDetector.detectType('test-mint-3');

      expect(tokenTypeDetector.getCacheSize()).toBe(3);
    });
  });

  describe('getCacheInfo', () => {
    it('should return cache information', async () => {
      mockUnifiedPriceService.getTokenType.mockResolvedValue('DEX_POOL');

      await tokenTypeDetector.detectType('test-mint');

      const info = tokenTypeDetector.getCacheInfo();

      expect(info.size).toBe(1);
      expect(info.entries).toHaveLength(1);
      expect(info.entries[0].mint).toBe('test-mint');
      expect(info.entries[0].type).toBe('DEX_POOL');
      expect(info.entries[0].age).toBeGreaterThanOrEqual(0);
    });
  });
});
