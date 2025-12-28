import { PriceMonitor } from '../../src/trading/managers/PriceMonitor';
import { Connection, Keypair } from '@solana/web3.js';
import { PumpFunStrategy } from '../../src/trading/strategies/solana/PumpFunStrategy';
import { TokenTypeDetector } from '../../src/trading/managers/TokenTypeDetector';
import { MigrationTracker } from '../../src/trading/managers/MigrationTracker';
import { UnifiedPriceService } from '../../src/services/UnifiedPriceService';
import { SolanaProvider } from '../../src/chains/SolanaProvider';

describe('Phase 2: Price Monitoring Optimization', () => {
  let priceMonitor: PriceMonitor;
  let connection: Connection;
  let solanaProvider: SolanaProvider;
  let pumpFunStrategy: PumpFunStrategy;
  let testWallet: Keypair;

  beforeAll(() => {
    // Инициализация для интеграционных тестов
    connection = new Connection(
      process.env.ALCHEMY_SOLANA_RPC || 'https://api.mainnet-beta.solana.com'
    );
    
    // Создаем SolanaProvider
    solanaProvider = new SolanaProvider(
      process.env.ALCHEMY_SOLANA_RPC || 'https://api.mainnet-beta.solana.com',
      process.env.ALCHEMY_API_KEY
    );
    
    // Создаем тестовый кошелек
    testWallet = Keypair.generate();
    
    pumpFunStrategy = new PumpFunStrategy(solanaProvider, testWallet);
    priceMonitor = new PriceMonitor(connection, pumpFunStrategy);
  });

  afterAll(() => {
    priceMonitor.stopAllMonitoring();
  });

  describe('Batch Price Requests', () => {
    it('should monitor DEX tokens with batch requests', async () => {
      const unifiedService = new UnifiedPriceService();

      // SOL и USDC - известные DEX токены
      const dexTokens = [
        'So11111111111111111111111111111111111111111112', // SOL
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGk92wy' // USDC
      ];

      const prices = await unifiedService.getDEXPrices(dexTokens);

      expect(prices.size).toBeGreaterThan(0);
      expect(prices.has('So11111111111111111111111111111111111111111112')).toBe(true);
    });

    it('should handle large batch requests', async () => {
      const unifiedService = new UnifiedPriceService();

      // Создаем список из 150 токенов (больше чем batch size)
      const tokenMints = Array.from({ length: 150 }, (_, i) =>
        `So11111111111111111111111111111111111111111112` // SOL (для теста)
      );

      const prices = await unifiedService.getDEXPrices(tokenMints);

      expect(prices.size).toBeGreaterThan(0);
    });

    it('should get prices for multiple token types', async () => {
      const unifiedService = new UnifiedPriceService();

      const tokenMints = [
        'So11111111111111111111111111111111111111111112', // SOL (DEX)
        // Можно добавить реальные bonding curve токены для теста
      ];

      const prices = await unifiedService.getAllPrices(tokenMints);

      expect(prices.size).toBeGreaterThan(0);
    });
  });

  describe('Token Type Detection', () => {
    it('should detect DEX_POOL token type', async () => {
      const unifiedService = new UnifiedPriceService();
      const tokenTypeDetector = new TokenTypeDetector(unifiedService);

      const type = await tokenTypeDetector.detectType(
        'So11111111111111111111111111111111111111111112' // SOL
      );

      expect(type).toBe('DEX_POOL');
    });

    it('should cache token type', async () => {
      const unifiedService = new UnifiedPriceService();
      const tokenTypeDetector = new TokenTypeDetector(unifiedService);

      // First call
      await tokenTypeDetector.detectType(
        'So11111111111111111111111111111111111111111112'
      );

      const cacheSize1 = tokenTypeDetector.getCacheSize();
      expect(cacheSize1).toBeGreaterThan(0);

      // Second call - should use cache
      await tokenTypeDetector.detectType(
        'So11111111111111111111111111111111111111111112'
      );

      const cacheSize2 = tokenTypeDetector.getCacheSize();
      expect(cacheSize2).toBe(cacheSize1);
    });

    it('should force update token type', async () => {
      const unifiedService = new UnifiedPriceService();
      const tokenTypeDetector = new TokenTypeDetector(unifiedService);

      // Cache a type
      await tokenTypeDetector.detectType(
        'So11111111111111111111111111111111111111111112'
      );

      // Force update
      await tokenTypeDetector.forceUpdateType(
        'So11111111111111111111111111111111111111111112'
      );

      expect(tokenTypeDetector.getCacheSize()).toBeGreaterThan(0);
    });
  });

  describe('Migration Tracking', () => {
    it('should register migration callbacks', () => {
      const migrationTracker = new MigrationTracker();
      const callback = jest.fn();

      migrationTracker.onMigration('test-mint', callback);

      expect(migrationTracker.getCallbackCount('test-mint')).toBe(1);
    });

    it('should remove migration callbacks', () => {
      const migrationTracker = new MigrationTracker();
      const callback = jest.fn();

      migrationTracker.onMigration('test-mint', callback);
      expect(migrationTracker.getCallbackCount('test-mint')).toBe(1);

      migrationTracker.offMigration('test-mint', callback);
      expect(migrationTracker.hasCallbacks('test-mint')).toBe(false);
    });

    it('should get tracked tokens', () => {
      const migrationTracker = new MigrationTracker();

      migrationTracker.onMigration('token-1', jest.fn());
      migrationTracker.onMigration('token-2', jest.fn());
      migrationTracker.onMigration('token-3', jest.fn());

      const trackedTokens = migrationTracker.getTrackedTokens();

      expect(trackedTokens).toHaveLength(3);
    });

    it('should provide migration statistics', () => {
      const migrationTracker = new MigrationTracker();

      migrationTracker.onMigration('token-1', jest.fn());
      migrationTracker.onMigration('token-2', jest.fn());

      const stats = migrationTracker.getStats();

      expect(stats.trackedTokens).toBe(2);
      expect(stats.totalCallbacks).toBe(2);
    });
  });

  describe('Price Monitoring with Different Token Types', () => {
    it('should monitor DEX tokens', async () => {
      const priceCallback = jest.fn();

      await priceMonitor.startMonitoring(
        ['So11111111111111111111111111111111111111111112'], // SOL
        priceCallback
      );

      // Wait for initial price fetch
      await new Promise(resolve => setTimeout(resolve, 1000));

      expect(priceMonitor.isMonitoring(
        'So11111111111111111111111111111111111111111112'
      )).toBe(true);

      priceMonitor.stopMonitoring(
        'So11111111111111111111111111111111111111111112'
      );
    });

    it('should handle price updates', async () => {
      const priceCallback = jest.fn();

      await priceMonitor.startMonitoring(
        ['So11111111111111111111111111111111111111111112'],
        priceCallback
      );

      // Wait for initial price fetch
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Price callback should have been called at least once
      expect(priceCallback).toHaveBeenCalled();

      priceMonitor.stopMonitoring(
        'So11111111111111111111111111111111111111111112'
      );
    });

    it('should get monitored tokens by type', async () => {
      const priceCallback = jest.fn();

      await priceMonitor.startMonitoring(
        ['So11111111111111111111111111111111111111111112'],
        priceCallback
      );

      // Wait for initialization
      await new Promise(resolve => setTimeout(resolve, 1000));

      const monitored = priceMonitor.getMonitoredTokens();

      expect(monitored.dex.length + monitored.bondingCurve.length).toBeGreaterThan(0);

      priceMonitor.stopAllMonitoring();
    });

    it('should get monitoring statistics', async () => {
      const priceCallback = jest.fn();

      await priceMonitor.startMonitoring(
        ['So11111111111111111111111111111111111111111112'],
        priceCallback
      );

      // Wait for initialization
      await new Promise(resolve => setTimeout(resolve, 1000));

      const stats = priceMonitor.getStats();

      expect(stats.dexTokens + stats.bondingCurveTokens).toBeGreaterThan(0);
      expect(stats.cacheSize).toBeGreaterThan(0);

      priceMonitor.stopAllMonitoring();
    });
  });

  describe('Cache Management', () => {
    it('should clear price cache', async () => {
      await priceMonitor.getCurrentPrice(
        'So11111111111111111111111111111111111111111112'
      );

      const stats1 = priceMonitor.getStats();
      expect(stats1.cacheSize).toBeGreaterThan(0);

      priceMonitor.clearCache();

      const stats2 = priceMonitor.getStats();
      expect(stats2.cacheSize).toBe(0);
    });

    it('should clear all caches', async () => {
      await priceMonitor.getCurrentPrice(
        'So11111111111111111111111111111111111111111112'
      );

      const cacheInfo1 = priceMonitor.getCacheInfo();
      expect(cacheInfo1.monitorCacheSize).toBeGreaterThan(0);

      priceMonitor.clearAllCaches();

      const cacheInfo2 = priceMonitor.getCacheInfo();
      expect(cacheInfo2.monitorCacheSize).toBe(0);
    });

    it('should clear expired cache entries', async () => {
      await priceMonitor.getCurrentPrice(
        'So11111111111111111111111111111111111111111112'
      );

      const stats1 = priceMonitor.getStats();
      expect(stats1.cacheSize).toBeGreaterThan(0);

      priceMonitor.clearExpiredCaches();

      const stats2 = priceMonitor.getStats();
      // Cache should be cleared if entries expired
      expect(stats2.cacheSize).toBeLessThanOrEqual(stats1.cacheSize);
    });

    it('should get cache info', async () => {
      await priceMonitor.getCurrentPrice(
        'So11111111111111111111111111111111111111111112'
      );

      const cacheInfo = priceMonitor.getCacheInfo();

      expect(cacheInfo.monitorCacheSize).toBeGreaterThan(0);
      expect(cacheInfo.tokenTypeDetectorCacheSize).toBeGreaterThanOrEqual(0);
      expect(cacheInfo.migrationTrackerCacheSize).toBeGreaterThanOrEqual(0);
      expect(cacheInfo.unifiedCacheInfo.totalCacheSize).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Rate Limit Protection', () => {
    it('should respect batch size limits', async () => {
      const unifiedService = new UnifiedPriceService();

      // Create 200 tokens (more than Jupiter batch size of 100)
      const tokenMints = Array.from({ length: 200 }, (_, i) =>
        `So11111111111111111111111111111111111111111112`
      );

      const startTime = Date.now();
      const prices = await unifiedService.getDEXPrices(tokenMints);
      const duration = Date.now() - startTime;

      expect(prices.size).toBeGreaterThan(0);
      // Should complete in reasonable time (batch requests are efficient)
      expect(duration).toBeLessThan(10000); // 10 seconds max
    });

    it('should handle parallel requests gracefully', async () => {
      const unifiedService = new UnifiedPriceService();

      const tokenMints = Array.from({ length: 30 }, (_, i) =>
        `So11111111111111111111111111111111111111111112`
      );

      // Make multiple parallel requests
      const promises = [
        unifiedService.getDEXPrices(tokenMints),
        unifiedService.getDEXPrices(tokenMints),
        unifiedService.getDEXPrices(tokenMints)
      ];

      const results = await Promise.all(promises);

      expect(results.length).toBe(3);
      results.forEach(result => {
        expect(result.size).toBeGreaterThan(0);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid token addresses gracefully', async () => {
      const unifiedService = new UnifiedPriceService();

      await expect(
        unifiedService.getPrice('invalid-token-address')
      ).rejects.toThrow();
    });

    it('should handle empty token lists', async () => {
      const unifiedService = new UnifiedPriceService();

      const prices = await unifiedService.getDEXPrices([]);

      expect(prices.size).toBe(0);
    });

    it('should continue monitoring after errors', async () => {
      const priceCallback = jest.fn();

      // Mix of valid and potentially invalid tokens
      const tokenMints = [
        'So11111111111111111111111111111111111111111112', // SOL (valid)
        'invalid-token-1',
        'invalid-token-2'
      ];

      await priceMonitor.startMonitoring(tokenMints, priceCallback);

      // Wait for initial attempts
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Should still monitor valid tokens
      expect(priceMonitor.isMonitoring(
        'So11111111111111111111111111111111111111111112'
      )).toBe(true);

      priceMonitor.stopAllMonitoring();
    });
  });

  describe('Performance', () => {
    it('should fetch prices quickly with batch requests', async () => {
      const unifiedService = new UnifiedPriceService();

      const tokenMints = Array.from({ length: 50 }, (_, i) =>
        `So11111111111111111111111111111111111111111112`
      );

      const startTime = Date.now();
      await unifiedService.getDEXPrices(tokenMints);
      const duration = Date.now() - startTime;

      // Batch requests should be fast (< 5 seconds for 50 tokens)
      expect(duration).toBeLessThan(5000);
    });

    it('should handle multiple monitoring intervals', async () => {
      const priceCallback = jest.fn();

      await priceMonitor.startMonitoring(
        ['So11111111111111111111111111111111111111111112'],
        priceCallback,
        {
          dexInterval: 1000,
          bondingCurveInterval: 500
        }
      );

      // Wait for multiple updates
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Should have received multiple updates
      expect(priceCallback.mock.calls.length).toBeGreaterThan(1);

      priceMonitor.stopAllMonitoring();
    });
  });
});
