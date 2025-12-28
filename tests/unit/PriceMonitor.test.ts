import { PriceMonitor } from '../../src/trading/managers/PriceMonitor';
import { Connection, Keypair } from '@solana/web3.js';
import { PumpFunStrategy } from '../../src/trading/strategies/solana/PumpFunStrategy';
import { UnifiedPriceService } from '../../src/services/UnifiedPriceService';
import { TokenTypeDetector } from '../../src/trading/managers/TokenTypeDetector';
import { MigrationTracker } from '../../src/trading/managers/MigrationTracker';
import { SolanaProvider } from '../../src/chains/SolanaProvider';

// Mock dependencies
jest.mock('../../src/trading/strategies/solana/PumpFunStrategy');
jest.mock('../../src/services/UnifiedPriceService');
jest.mock('../../src/trading/managers/TokenTypeDetector');
jest.mock('../../src/trading/managers/MigrationTracker');

describe('PriceMonitor (Phase 2)', () => {
  let priceMonitor: PriceMonitor;
  let mockConnection: Connection;
  let mockSolanaProvider: SolanaProvider;
  let mockPumpFunStrategy: jest.Mocked<PumpFunStrategy>;
  let mockUnifiedPriceService: jest.Mocked<UnifiedPriceService>;
  let mockTokenTypeDetector: jest.Mocked<TokenTypeDetector>;
  let mockMigrationTracker: jest.Mocked<MigrationTracker>;
  let testWallet: Keypair;

  beforeEach(() => {
    mockConnection = new Connection('https://api.mainnet-beta.solana.com');
    mockSolanaProvider = new SolanaProvider('https://api.mainnet-beta.solana.com');
    testWallet = Keypair.generate();
    
    // Create mock PumpFunStrategy with correct constructor signature
    mockPumpFunStrategy = new PumpFunStrategy(mockSolanaProvider, testWallet) as jest.Mocked<PumpFunStrategy>;
    mockUnifiedPriceService = new UnifiedPriceService() as jest.Mocked<UnifiedPriceService>;
    mockTokenTypeDetector = new TokenTypeDetector(mockUnifiedPriceService) as jest.Mocked<TokenTypeDetector>;
    mockMigrationTracker = new MigrationTracker() as jest.Mocked<MigrationTracker>;

    priceMonitor = new PriceMonitor(mockConnection, mockPumpFunStrategy);

    // Replace internal instances with mocks
    (priceMonitor as any).unifiedPriceService = mockUnifiedPriceService;
    (priceMonitor as any).tokenTypeDetector = mockTokenTypeDetector;
    (priceMonitor as any).migrationTracker = mockMigrationTracker;

    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    priceMonitor.stopAllMonitoring();
  });

  describe('startMonitoring', () => {
    it('should detect token types for all tokens', async () => {
      const tokenMints = ['token-1', 'token-2', 'token-3'];
      const priceCallback = jest.fn();

      mockTokenTypeDetector.detectType
        .mockResolvedValueOnce('DEX_POOL')
        .mockResolvedValueOnce('BONDING_CURVE')
        .mockResolvedValueOnce('DEX_POOL');

      mockUnifiedPriceService.getAllPrices.mockResolvedValue(new Map());

      await priceMonitor.startMonitoring(tokenMints, priceCallback);

      expect(mockTokenTypeDetector.detectType).toHaveBeenCalledTimes(3);
      expect(mockTokenTypeDetector.detectType).toHaveBeenCalledWith('token-1');
      expect(mockTokenTypeDetector.detectType).toHaveBeenCalledWith('token-2');
      expect(mockTokenTypeDetector.detectType).toHaveBeenCalledWith('token-3');
    });

    it('should start DEX monitoring for DEX tokens', async () => {
      const tokenMints = ['dex-token-1', 'dex-token-2'];
      const priceCallback = jest.fn();

      mockTokenTypeDetector.detectType.mockResolvedValue('DEX_POOL');
      mockUnifiedPriceService.getDEXPrices.mockResolvedValue(
        new Map([
          ['dex-token-1', 1.0],
          ['dex-token-2', 2.0]
        ])
      );
      mockUnifiedPriceService.getAllPrices.mockResolvedValue(
        new Map([
          ['dex-token-1', {
            price: 1.0,
            source: 'JUPITER',
            tokenType: 'DEX_POOL',
            tokenMint: 'dex-token-1'
          }],
          ['dex-token-2', {
            price: 2.0,
            source: 'JUPITER',
            tokenType: 'DEX_POOL',
            tokenMint: 'dex-token-2'
          }]
        ])
      );

      await priceMonitor.startMonitoring(tokenMints, priceCallback);

      jest.advanceTimersByTime(3000);

      expect(mockUnifiedPriceService.getDEXPrices).toHaveBeenCalledWith(tokenMints);
      expect(priceCallback).toHaveBeenCalledWith('dex-token-1', 1.0);
      expect(priceCallback).toHaveBeenCalledWith('dex-token-2', 2.0);
    });

    it('should start bonding curve monitoring for bonding curve tokens', async () => {
      const tokenMints = ['bonding-token-1', 'bonding-token-2'];
      const priceCallback = jest.fn();

      mockTokenTypeDetector.detectType.mockResolvedValue('BONDING_CURVE');
      mockUnifiedPriceService.getBondingCurvePrices.mockResolvedValue(
        new Map([
          ['bonding-token-1', 1.0],
          ['bonding-token-2', 2.0]
        ])
      );
      mockUnifiedPriceService.getAllPrices.mockResolvedValue(
        new Map([
          ['bonding-token-1', {
            price: 1.0,
            source: 'PUMP_FUN',
            tokenType: 'BONDING_CURVE',
            tokenMint: 'bonding-token-1'
          }],
          ['bonding-token-2', {
            price: 2.0,
            source: 'PUMP_FUN',
            tokenType: 'BONDING_CURVE',
            tokenMint: 'bonding-token-2'
          }]
        ])
      );

      await priceMonitor.startMonitoring(tokenMints, priceCallback);

      jest.advanceTimersByTime(2000);

      expect(mockUnifiedPriceService.getBondingCurvePrices).toHaveBeenCalledWith(tokenMints);
      expect(priceCallback).toHaveBeenCalledWith('bonding-token-1', 1.0);
      expect(priceCallback).toHaveBeenCalledWith('bonding-token-2', 2.0);
    });

    it('should check migration for bonding curve tokens', async () => {
      const tokenMints = ['bonding-token-1'];
      const priceCallback = jest.fn();

      mockTokenTypeDetector.detectType.mockResolvedValue('BONDING_CURVE');
      mockUnifiedPriceService.getBondingCurvePrices.mockResolvedValue(
        new Map([['bonding-token-1', 1.0]])
      );
      mockUnifiedPriceService.getAllPrices.mockResolvedValue(
        new Map([['bonding-token-1', {
          price: 1.0,
          source: 'PUMP_FUN',
          tokenType: 'BONDING_CURVE',
          tokenMint: 'bonding-token-1'
        }]])
      );
      mockMigrationTracker.checkMigration.mockResolvedValue(false);

      await priceMonitor.startMonitoring(tokenMints, priceCallback);

      // Проверяем, что мониторинг запущен
      expect(priceMonitor.isMonitoring('bonding-token-1')).toBe(true);

      // Проверяем, что токен добавлен в bonding curve мониторинг
      const monitoredTokens = priceMonitor.getMonitoredTokens();
      expect(monitoredTokens.bondingCurve).toContain('bonding-token-1');
      expect(monitoredTokens.dex).toHaveLength(0);
    });

    it('should register migration callback if provided', async () => {
      const tokenMints = ['bonding-token-1'];
      const priceCallback = jest.fn();
      const migrationCallback = jest.fn();

      mockTokenTypeDetector.detectType.mockResolvedValue('BONDING_CURVE');
      mockUnifiedPriceService.getBondingCurvePrices.mockResolvedValue(
        new Map([['bonding-token-1', 1.0]])
      );
      mockUnifiedPriceService.getAllPrices.mockResolvedValue(
        new Map([['bonding-token-1', {
          price: 1.0,
          source: 'PUMP_FUN',
          tokenType: 'BONDING_CURVE',
          tokenMint: 'bonding-token-1'
        }]])
      );

      await priceMonitor.startMonitoring(tokenMints, priceCallback, {
        onMigration: migrationCallback
      });

      expect(mockMigrationTracker.onMigration).toHaveBeenCalledWith('bonding-token-1', migrationCallback);
    });

    it('should fetch initial prices immediately', async () => {
      const tokenMints = ['token-1'];
      const priceCallback = jest.fn();

      mockTokenTypeDetector.detectType.mockResolvedValue('DEX_POOL');
      mockUnifiedPriceService.getAllPrices.mockResolvedValue(
        new Map([
          ['token-1', {
            price: 1.0,
            source: 'JUPITER',
            tokenType: 'DEX_POOL',
            tokenMint: 'token-1'
          }]
        ])
      );

      await priceMonitor.startMonitoring(tokenMints, priceCallback);

      expect(mockUnifiedPriceService.getAllPrices).toHaveBeenCalledWith(tokenMints);
      expect(priceCallback).toHaveBeenCalledWith('token-1', 1.0);
    });

    it('should handle custom intervals', async () => {
      const tokenMints = ['dex-token-1'];
      const priceCallback = jest.fn();

      mockTokenTypeDetector.detectType.mockResolvedValue('DEX_POOL');
      mockUnifiedPriceService.getDEXPrices.mockResolvedValue(
        new Map([['dex-token-1', 1.0]])
      );
      mockUnifiedPriceService.getAllPrices.mockResolvedValue(
        new Map([['dex-token-1', {
          price: 1.0,
          source: 'JUPITER',
          tokenType: 'DEX_POOL',
          tokenMint: 'dex-token-1'
        }]])
      );

      await priceMonitor.startMonitoring(tokenMints, priceCallback, {
        dexInterval: 5000
      });

      jest.advanceTimersByTime(3000);
      expect(mockUnifiedPriceService.getDEXPrices).not.toHaveBeenCalled();

      jest.advanceTimersByTime(2000);
      expect(mockUnifiedPriceService.getDEXPrices).toHaveBeenCalled();
    });
  });

  describe('getCurrentPrice', () => {
    it('should return cached price if valid', async () => {
      mockUnifiedPriceService.getPrice.mockResolvedValue({
        price: 1.5,
        source: 'JUPITER',
        tokenType: 'DEX_POOL'
      });

      // First call - cache
      await priceMonitor.getCurrentPrice('test-mint');

      // Second call - should use cache
      const price = await priceMonitor.getCurrentPrice('test-mint');

      expect(price).toBe(1.5);
      expect(mockUnifiedPriceService.getPrice).toHaveBeenCalledTimes(1);
    });

    it('should fetch fresh price if cache expired', async () => {
      mockUnifiedPriceService.getPrice.mockResolvedValue({
        price: 1.5,
        source: 'JUPITER',
        tokenType: 'DEX_POOL'
      });

      // First call - cache
      await priceMonitor.getCurrentPrice('test-mint');

      // Expire cache
      const cache = (priceMonitor as any).prices;
      const cached = cache.get('test-mint');
      if (cached) {
        cached.timestamp = Date.now() - 6000; // 6 seconds ago (TTL is 5s)
      }

      // Second call - should fetch fresh price
      const price = await priceMonitor.getCurrentPrice('test-mint');

      expect(price).toBe(1.5);
      expect(mockUnifiedPriceService.getPrice).toHaveBeenCalledTimes(2);
    });

    it('should validate price before caching', async () => {
      mockUnifiedPriceService.getPrice.mockResolvedValue({
        price: NaN,
        source: 'JUPITER',
        tokenType: 'DEX_POOL'
      });

      await expect(priceMonitor.getCurrentPrice('test-mint')).rejects.toThrow('Invalid price');
    });

    it('should validate non-positive prices', async () => {
      mockUnifiedPriceService.getPrice.mockResolvedValue({
        price: -1.0,
        source: 'JUPITER',
        tokenType: 'DEX_POOL'
      });

      await expect(priceMonitor.getCurrentPrice('test-mint')).rejects.toThrow('Invalid price');
    });
  });

  describe('getCurrentPriceWithDetails', () => {
    it('should return price with source', async () => {
      mockUnifiedPriceService.getPrice.mockResolvedValue({
        price: 1.5,
        source: 'JUPITER',
        tokenType: 'DEX_POOL'
      });

      const result = await priceMonitor.getCurrentPriceWithDetails('test-mint');

      expect(result.price).toBe(1.5);
      expect(result.source).toBe('JUPITER');
      expect(result.tokenType).toBe('DEX_POOL');
    });

    it('should validate cached prices', async () => {
      mockUnifiedPriceService.getPrice.mockResolvedValue({
        price: 1.5,
        source: 'JUPITER',
        tokenType: 'DEX_POOL'
      });

      // Cache invalid price
      const cache = (priceMonitor as any).prices;
      cache.set('test-mint', {
        price: -1.0,
        timestamp: Date.now(),
        source: 'JUPITER'
      });

      // Should fetch fresh price
      const result = await priceMonitor.getCurrentPriceWithDetails('test-mint');

      expect(result.price).toBe(1.5);
      expect(mockUnifiedPriceService.getPrice).toHaveBeenCalled();
    });
  });

  describe('stopMonitoring', () => {
    it('should stop monitoring for specific token', async () => {
      const tokenMints = ['token-1', 'token-2'];
      const priceCallback = jest.fn();

      mockTokenTypeDetector.detectType.mockResolvedValue('DEX_POOL');
      mockUnifiedPriceService.getDEXPrices.mockResolvedValue(new Map());
      mockUnifiedPriceService.getAllPrices.mockResolvedValue(new Map());

      await priceMonitor.startMonitoring(tokenMints, priceCallback);
      expect(priceMonitor.isMonitoring('token-1')).toBe(true);

      priceMonitor.stopMonitoring('token-1');
      expect(priceMonitor.isMonitoring('token-1')).toBe(false);
      expect(priceMonitor.isMonitoring('token-2')).toBe(true);
    });
  });

  describe('stopAllMonitoring', () => {
    it('should stop all monitoring intervals', async () => {
      const tokenMints = ['token-1', 'token-2'];
      const priceCallback = jest.fn();

      mockTokenTypeDetector.detectType.mockResolvedValue('DEX_POOL');
      mockUnifiedPriceService.getDEXPrices.mockResolvedValue(new Map());
      mockUnifiedPriceService.getAllPrices.mockResolvedValue(new Map());

      await priceMonitor.startMonitoring(tokenMints, priceCallback);
      expect(priceMonitor.isMonitoring('token-1')).toBe(true);
      expect(priceMonitor.isMonitoring('token-2')).toBe(true);

      priceMonitor.stopAllMonitoring();

      expect(priceMonitor.isMonitoring('token-1')).toBe(false);
      expect(priceMonitor.isMonitoring('token-2')).toBe(false);
    });
  });

  describe('isMonitoring', () => {
    it('should return true for monitored tokens', async () => {
      const tokenMints = ['token-1'];
      const priceCallback = jest.fn();

      mockTokenTypeDetector.detectType.mockResolvedValue('DEX_POOL');
      mockUnifiedPriceService.getDEXPrices.mockResolvedValue(new Map());
      mockUnifiedPriceService.getAllPrices.mockResolvedValue(new Map());

      await priceMonitor.startMonitoring(tokenMints, priceCallback);

      expect(priceMonitor.isMonitoring('token-1')).toBe(true);
      expect(priceMonitor.isMonitoring('token-2')).toBe(false);
    });
  });

  describe('getMonitoredTokens', () => {
    it('should return list of monitored tokens by type', async () => {
      const tokenMints = ['dex-token-1', 'dex-token-2', 'bonding-token-1'];
      const priceCallback = jest.fn();

      mockTokenTypeDetector.detectType
        .mockResolvedValueOnce('DEX_POOL')
        .mockResolvedValueOnce('DEX_POOL')
        .mockResolvedValueOnce('BONDING_CURVE');

      mockUnifiedPriceService.getAllPrices.mockResolvedValue(new Map());

      await priceMonitor.startMonitoring(tokenMints, priceCallback);

      const monitored = priceMonitor.getMonitoredTokens();

      expect(monitored.dex).toHaveLength(2);
      expect(monitored.dex).toContain('dex-token-1');
      expect(monitored.dex).toContain('dex-token-2');
      expect(monitored.bondingCurve).toHaveLength(1);
      expect(monitored.bondingCurve).toContain('bonding-token-1');
    });
  });

  describe('clearCache', () => {
    it('should clear price cache', async () => {
      mockUnifiedPriceService.getPrice.mockResolvedValue({
        price: 1.5,
        source: 'JUPITER',
        tokenType: 'DEX_POOL'
      });

      await priceMonitor.getCurrentPrice('test-mint');
      expect((priceMonitor as any).prices.size).toBe(1);

      priceMonitor.clearCache();

      expect((priceMonitor as any).prices.size).toBe(0);
      expect(mockTokenTypeDetector.clearCache).toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('should return monitoring statistics', async () => {
      const tokenMints = ['dex-token-1', 'bonding-token-1'];
      const priceCallback = jest.fn();

      mockTokenTypeDetector.detectType
        .mockResolvedValueOnce('DEX_POOL')
        .mockResolvedValueOnce('BONDING_CURVE');

      mockUnifiedPriceService.getAllPrices.mockResolvedValue(
        new Map([
          ['dex-token-1', {
            price: 1.0,
            source: 'JUPITER',
            tokenType: 'DEX_POOL',
            tokenMint: 'dex-token-1'
          }],
          ['bonding-token-1', {
            price: 2.0,
            source: 'PUMP_FUN',
            tokenType: 'BONDING_CURVE',
            tokenMint: 'bonding-token-1'
          }]
        ])
      );

      await priceMonitor.startMonitoring(tokenMints, priceCallback);

      const stats = priceMonitor.getStats();

      expect(stats.dexTokens).toBe(1);
      expect(stats.bondingCurveTokens).toBe(1);
      expect(stats.cacheSize).toBe(2);
      expect(stats.cacheEntries).toHaveLength(2);
    });
  });

  describe('clearAllCaches', () => {
    it('should clear all caches', async () => {
      mockUnifiedPriceService.getPrice.mockResolvedValue({
        price: 1.5,
        source: 'JUPITER',
        tokenType: 'DEX_POOL'
      });

      await priceMonitor.getCurrentPrice('test-mint');

      priceMonitor.clearAllCaches();

      expect((priceMonitor as any).prices.size).toBe(0);
      expect(mockTokenTypeDetector.clearCache).toHaveBeenCalled();
      expect(mockMigrationTracker.clearMigrationCache).toHaveBeenCalled();
      expect(mockUnifiedPriceService.clearAllCaches).toHaveBeenCalled();
    });
  });

  describe('getCacheInfo', () => {
    it('should return cache information', async () => {
      mockUnifiedPriceService.getPrice.mockResolvedValue({
        price: 1.5,
        source: 'JUPITER',
        tokenType: 'DEX_POOL'
      });

      await priceMonitor.getCurrentPrice('test-mint');

      mockTokenTypeDetector.getCacheSize.mockReturnValue(5);
      mockMigrationTracker.getCacheInfo.mockReturnValue({ size: 3, entries: [] });
      mockUnifiedPriceService.getCacheInfo.mockReturnValue({
        jupiterCacheSize: 10,
        pumpFunCacheSize: 5,
        totalCacheSize: 15
      });

      const info = priceMonitor.getCacheInfo();

      expect(info.monitorCacheSize).toBe(1);
      expect(info.tokenTypeDetectorCacheSize).toBe(5);
      expect(info.migrationTrackerCacheSize).toBe(3);
      expect(info.unifiedCacheInfo.totalCacheSize).toBe(15);
    });
  });

  describe('clearExpiredCaches', () => {
    it('should clear expired cache entries', async () => {
      mockUnifiedPriceService.getPrice.mockResolvedValue({
        price: 1.5,
        source: 'JUPITER',
        tokenType: 'DEX_POOL'
      });

      // Cache a price
      await priceMonitor.getCurrentPrice('test-mint');

      // Expire cache
      const cache = (priceMonitor as any).prices;
      const cached = cache.get('test-mint');
      if (cached) {
        cached.timestamp = Date.now() - 6000;
      }

      priceMonitor.clearExpiredCaches();

      expect((priceMonitor as any).prices.size).toBe(0);
      expect(mockTokenTypeDetector.clearExpiredCache).toHaveBeenCalled();
      expect(mockMigrationTracker.clearExpiredCache).toHaveBeenCalled();
      expect(mockUnifiedPriceService.clearExpiredCaches).toHaveBeenCalled();
    });
  });

  describe('getTokensPerSOL', () => {
    it('should return tokens per SOL from price', async () => {
      mockUnifiedPriceService.getPrice.mockResolvedValue({
        price: 0.5,
        source: 'JUPITER',
        tokenType: 'DEX_POOL'
      });

      const tokensPerSOL = await priceMonitor.getTokensPerSOL('test-mint');

      expect(tokensPerSOL).toBe(2.0); // 1 / 0.5
    });

    it('should use cached price if valid', async () => {
      mockUnifiedPriceService.getPrice.mockResolvedValue({
        price: 0.5,
        source: 'JUPITER',
        tokenType: 'DEX_POOL'
      });

      await priceMonitor.getTokensPerSOL('test-mint');
      await priceMonitor.getTokensPerSOL('test-mint');

      expect(mockUnifiedPriceService.getPrice).toHaveBeenCalledTimes(1);
    });

    it('should fallback to PumpFunStrategy if unified fails', async () => {
      mockUnifiedPriceService.getPrice.mockRejectedValue(new Error('API Error'));
      mockPumpFunStrategy.getQuote.mockResolvedValue({
        outputAmount: 2_000_000_000, // 2 tokens
        inputAmount: 1_000_000_000, // 1 SOL
        priceImpact: 0,
        fee: 0,
        route: 'PumpFun Bonding Curve'
      });

      const tokensPerSOL = await priceMonitor.getTokensPerSOL('test-mint');

      expect(tokensPerSOL).toBe(2.0);
      expect(mockPumpFunStrategy.getQuote).toHaveBeenCalled();
    });
  });

  describe('getTokenTypeDetector', () => {
    it('should return TokenTypeDetector instance', () => {
      const detector = priceMonitor.getTokenTypeDetector();

      expect(detector).toBe(mockTokenTypeDetector);
    });
  });

  describe('getMigrationTracker', () => {
    it('should return MigrationTracker instance', () => {
      const tracker = priceMonitor.getMigrationTracker();

      expect(tracker).toBe(mockMigrationTracker);
    });
  });
});
