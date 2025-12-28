import { UnifiedPriceService } from '../../src/services/UnifiedPriceService';
import { JupiterPriceService } from '../../src/services/JupiterPriceService';
import { PumpFunPriceService } from '../../src/services/PumpFunPriceService';

// Mock dependencies
jest.mock('../../src/services/JupiterPriceService');
jest.mock('../../src/services/PumpFunPriceService');

describe('UnifiedPriceService', () => {
  let unifiedPriceService: UnifiedPriceService;
  let mockJupiterService: jest.Mocked<JupiterPriceService>;
  let mockPumpFunService: jest.Mocked<PumpFunPriceService>;

  beforeEach(() => {
    mockJupiterService = new JupiterPriceService() as jest.Mocked<JupiterPriceService>;
    mockPumpFunService = new PumpFunPriceService() as jest.Mocked<PumpFunPriceService>;

    unifiedPriceService = new UnifiedPriceService();
    (unifiedPriceService as any).jupiterService = mockJupiterService;
    (unifiedPriceService as any).pumpFunService = mockPumpFunService;

    jest.clearAllMocks();
  });

  describe('getDEXPrices', () => {
    it('should fetch DEX prices in batches', async () => {
      const tokenMints = Array.from({ length: 150 }, (_, i) => `token-${i}`);
      const prices = new Map<string, number>();
      tokenMints.forEach(mint => prices.set(mint, Math.random() * 10));

      mockJupiterService.getPrices.mockImplementation(async (mints) => {
        const result = new Map<string, number>();
        mints.forEach(mint => {
          if (prices.has(mint)) {
            result.set(mint, prices.get(mint)!);
          }
        });
        return result;
      });

      const result = await unifiedPriceService.getDEXPrices(tokenMints);

      expect(result.size).toBe(150);
      expect(mockJupiterService.getPrices).toHaveBeenCalledTimes(2); // 150 tokens / 100 batch size = 2 calls
    });

    it('should handle empty token list', async () => {
      mockJupiterService.getPrices.mockResolvedValue(new Map());

      const result = await unifiedPriceService.getDEXPrices([]);

      expect(result.size).toBe(0);
      expect(mockJupiterService.getPrices).not.toHaveBeenCalled();
    });

    it('should handle API errors gracefully', async () => {
      mockJupiterService.getPrices.mockRejectedValue(new Error('API Error'));

      const result = await unifiedPriceService.getDEXPrices(['token-1', 'token-2']);

      expect(result.size).toBe(0);
    });

    it('should merge batch results', async () => {
      const tokenMints = ['token-1', 'token-2', 'token-3'];

      mockJupiterService.getPrices.mockImplementation(async (mints) => {
        const result = new Map<string, number>();
        mints.forEach(mint => {
          result.set(mint, parseFloat(mint.split('-')[1]));
        });
        return result;
      });

      const result = await unifiedPriceService.getDEXPrices(tokenMints);

      expect(result.get('token-1')).toBe(1);
      expect(result.get('token-2')).toBe(2);
      expect(result.get('token-3')).toBe(3);
    });
  });

  describe('getBondingCurvePrices', () => {
    it('should fetch bonding curve prices in parallel chunks', async () => {
      const tokenMints = Array.from({ length: 25 }, (_, i) => `token-${i}`);

      mockPumpFunService.getPrice.mockImplementation(async (mint) => {
        return parseFloat(mint.split('-')[1]);
      });

      const result = await unifiedPriceService.getBondingCurvePrices(tokenMints);

      expect(result.size).toBe(25);
      expect(mockPumpFunService.getPrice).toHaveBeenCalledTimes(25);
    });

    it('should handle empty token list', async () => {
      const result = await unifiedPriceService.getBondingCurvePrices([]);

      expect(result.size).toBe(0);
      expect(mockPumpFunService.getPrice).not.toHaveBeenCalled();
    });

    it('should handle individual API errors gracefully', async () => {
      const tokenMints = ['token-1', 'token-2', 'token-3'];

      mockPumpFunService.getPrice
        .mockResolvedValueOnce(1)
        .mockRejectedValueOnce(new Error('API Error'))
        .mockResolvedValueOnce(3);

      const result = await unifiedPriceService.getBondingCurvePrices(tokenMints);

      expect(result.size).toBe(2);
      expect(result.get('token-1')).toBe(1);
      expect(result.get('token-2')).toBeUndefined();
      expect(result.get('token-3')).toBe(3);
    });

    it('should respect chunk size limit', async () => {
      const tokenMints = Array.from({ length: 30 }, (_, i) => `token-${i}`);

      mockPumpFunService.getPrice.mockImplementation(async (mint) => {
        return parseFloat(mint.split('-')[1]);
      });

      await unifiedPriceService.getBondingCurvePrices(tokenMints);

      // Should make calls in chunks of 10
      expect(mockPumpFunService.getPrice).toHaveBeenCalledTimes(30);
    });
  });

  describe('getAllPrices', () => {
    it('should fetch DEX prices first, then bonding curve for missing', async () => {
      const tokenMints = ['dex-token-1', 'dex-token-2', 'bonding-token-1'];

      mockJupiterService.getPrices.mockResolvedValue(
        new Map([
          ['dex-token-1', 1.0],
          ['dex-token-2', 2.0]
        ])
      );

      mockPumpFunService.getPrice.mockResolvedValue(3.0);

      const result = await unifiedPriceService.getAllPrices(tokenMints);

      expect(result.size).toBe(3);
      expect(result.get('dex-token-1')).toEqual({
        price: 1.0,
        source: 'JUPITER',
        tokenType: 'DEX_POOL',
        tokenMint: 'dex-token-1'
      });
      expect(result.get('dex-token-2')).toEqual({
        price: 2.0,
        source: 'JUPITER',
        tokenType: 'DEX_POOL',
        tokenMint: 'dex-token-2'
      });
      expect(result.get('bonding-token-1')).toEqual({
        price: 3.0,
        source: 'PUMP_FUN',
        tokenType: 'BONDING_CURVE',
        tokenMint: 'bonding-token-1'
      });

      expect(mockJupiterService.getPrices).toHaveBeenCalledWith(tokenMints);
      expect(mockPumpFunService.getPrice).toHaveBeenCalledWith('bonding-token-1');
    });

    it('should only call PumpFun for tokens not in Jupiter', async () => {
      const tokenMints = ['dex-token-1', 'dex-token-2'];

      mockJupiterService.getPrices.mockResolvedValue(
        new Map([
          ['dex-token-1', 1.0],
          ['dex-token-2', 2.0]
        ])
      );

      const result = await unifiedPriceService.getAllPrices(tokenMints);

      expect(result.size).toBe(2);
      expect(mockPumpFunService.getPrice).not.toHaveBeenCalled();
    });

    it('should handle all bonding curve tokens', async () => {
      const tokenMints = ['bonding-token-1', 'bonding-token-2'];

      mockJupiterService.getPrices.mockResolvedValue(new Map());

      mockPumpFunService.getPrice
        .mockResolvedValueOnce(1.0)
        .mockResolvedValueOnce(2.0);

      const result = await unifiedPriceService.getAllPrices(tokenMints);

      expect(result.size).toBe(2);
      expect(mockJupiterService.getPrices).toHaveBeenCalledWith(tokenMints);
      expect(mockPumpFunService.getPrice).toHaveBeenCalledTimes(2);
    });

    it('should handle empty token list', async () => {
      mockJupiterService.getPrices.mockResolvedValue(new Map());

      const result = await unifiedPriceService.getAllPrices([]);

      expect(result.size).toBe(0);
    });

    it('should handle bonding curve API errors gracefully', async () => {
      const tokenMints = ['dex-token-1', 'bonding-token-1'];

      mockJupiterService.getPrices.mockResolvedValue(
        new Map([['dex-token-1', 1.0]])
      );

      mockPumpFunService.getPrice.mockRejectedValue(new Error('API Error'));

      const result = await unifiedPriceService.getAllPrices(tokenMints);

      expect(result.size).toBe(1);
      expect(result.has('bonding-token-1')).toBe(false);
    });
  });

  describe('chunkArray', () => {
    it('should split array into chunks', () => {
      const array = [1, 2, 3, 4, 5, 6, 7];
      const chunks = (unifiedPriceService as any).chunkArray(array, 3);

      expect(chunks).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    });

    it('should handle empty array', () => {
      const chunks = (unifiedPriceService as any).chunkArray([], 3);

      expect(chunks).toEqual([]);
    });

    it('should handle array smaller than chunk size', () => {
      const array = [1, 2];
      const chunks = (unifiedPriceService as any).chunkArray(array, 5);

      expect(chunks).toEqual([[1, 2]]);
    });

    it('should handle array exactly divisible by chunk size', () => {
      const array = [1, 2, 3, 4, 5, 6];
      const chunks = (unifiedPriceService as any).chunkArray(array, 3);

      expect(chunks).toEqual([[1, 2, 3], [4, 5, 6]]);
    });
  });

  describe('existing methods', () => {
    it('should get price from Jupiter', async () => {
      mockJupiterService.getPrice.mockResolvedValue(1.5);

      const result = await unifiedPriceService.getPrice('test-mint');

      expect(result.price).toBe(1.5);
      expect(result.source).toBe('JUPITER');
      expect(result.tokenType).toBe('DEX_POOL');
      expect(mockJupiterService.getPrice).toHaveBeenCalledWith('test-mint');
    });

    it('should fallback to PumpFun if Jupiter fails', async () => {
      mockJupiterService.getPrice.mockRejectedValue(new Error('Not found'));
      mockPumpFunService.getPrice.mockResolvedValue(2.5);

      const result = await unifiedPriceService.getPrice('test-mint');

      expect(result.price).toBe(2.5);
      expect(result.source).toBe('PUMP_FUN');
      expect(result.tokenType).toBe('BONDING_CURVE');
      expect(mockJupiterService.getPrice).toHaveBeenCalledWith('test-mint');
      expect(mockPumpFunService.getPrice).toHaveBeenCalledWith('test-mint');
    });

    it('should get token type', async () => {
      mockJupiterService.isTokenSupported.mockResolvedValue(true);

      const type = await unifiedPriceService.getTokenType('test-mint');

      expect(type).toBe('DEX_POOL');
      expect(mockJupiterService.isTokenSupported).toHaveBeenCalledWith('test-mint');
    });

    it('should clear all caches', () => {
      unifiedPriceService.clearAllCaches();

      expect(mockJupiterService.clearCache).toHaveBeenCalled();
      expect(mockPumpFunService.clearCache).toHaveBeenCalled();
    });

    it('should get cache info', () => {
      mockJupiterService.getCacheSize.mockReturnValue(5);
      mockPumpFunService.getCacheSize.mockReturnValue(3);

      const info = unifiedPriceService.getCacheInfo();

      expect(info.jupiterCacheSize).toBe(5);
      expect(info.pumpFunCacheSize).toBe(3);
      expect(info.totalCacheSize).toBe(8);
    });

    it('should get Jupiter service', () => {
      const service = unifiedPriceService.getJupiterService();

      expect(service).toBe(mockJupiterService);
    });

    it('should get PumpFun service', () => {
      const service = unifiedPriceService.getPumpFunService();

      expect(service).toBe(mockPumpFunService);
    });
  });
});
