import { PumpFunPriceService } from '../../src/services/PumpFunPriceService';

// Mock global fetch
global.fetch = jest.fn();

describe('PumpFunPriceService', () => {
  let pumpFunService: PumpFunPriceService;

  beforeEach(() => {
    pumpFunService = new PumpFunPriceService();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getTokenData', () => {
    it('should fetch token data', async () => {
      const mockResponse = {
        mint: 'test-mint',
        name: 'Test Token',
        symbol: 'TEST',
        complete: false,
        virtual_sol_reserves: 1000000000,
        virtual_token_reserves: 1000000000000,
        market_cap: 50000,
        raydium_pool: null,
        bonding_curve: 'bonding-curve-address',
        created_at: '2024-01-01T00:00:00Z'
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      const data = await pumpFunService.getTokenData('test-mint');

      expect(data.mint).toBe('test-mint');
      expect(data.name).toBe('Test Token');
      expect(data.complete).toBe(false);
      expect(data.market_cap).toBe(50000);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://frontend-api.pump.fun/coins/test-mint'
      );
    });

    it('should return cached data if within TTL', async () => {
      const mockResponse = {
        mint: 'test-mint',
        name: 'Test Token',
        complete: false,
        virtual_sol_reserves: 1000000000,
        virtual_token_reserves: 1000000000000,
        market_cap: 50000,
        raydium_pool: null,
        bonding_curve: 'bonding-curve-address',
        created_at: '2024-01-01T00:00:00Z'
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      // First call - fetches from API
      const data1 = await pumpFunService.getTokenData('test-mint');
      expect(data1.name).toBe('Test Token');
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      const data2 = await pumpFunService.getTokenData('test-mint');
      expect(data2.name).toBe('Test Token');
      expect(global.fetch).toHaveBeenCalledTimes(1); // No additional fetch
    });

    it('should fetch new data if cache expired', async () => {
      jest.useFakeTimers();

      const mockResponse1 = {
        mint: 'test-mint',
        name: 'Test Token',
        complete: false,
        virtual_sol_reserves: 1000000000,
        virtual_token_reserves: 1000000000000,
        market_cap: 50000,
        raydium_pool: null,
        bonding_curve: 'bonding-curve-address',
        created_at: '2024-01-01T00:00:00Z'
      };

      const mockResponse2 = {
        mint: 'test-mint',
        name: 'Test Token Updated',
        complete: false,
        virtual_sol_reserves: 2000000000,
        virtual_token_reserves: 2000000000000,
        market_cap: 60000,
        raydium_pool: null,
        bonding_curve: 'bonding-curve-address',
        created_at: '2024-01-01T00:00:00Z'
      };

      (global.fetch as jest.MockedFunction<typeof fetch>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse1
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse2
        } as Response);

      // First call
      const data1 = await pumpFunService.getTokenData('test-mint');
      expect(data1.market_cap).toBe(50000);

      // Advance time past cache TTL (3 seconds)
      jest.advanceTimersByTime(4000);

      // Second call - should fetch new data
      const data2 = await pumpFunService.getTokenData('test-mint');
      expect(data2.market_cap).toBe(60000);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should throw error for 404 response', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      } as Response);

      await expect(pumpFunService.getTokenData('test-mint'))
        .rejects.toThrow('Token test-mint not found on Pump.fun');
    });

    it('should throw error for 500 response', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      } as Response);

      await expect(pumpFunService.getTokenData('test-mint'))
        .rejects.toThrow('Pump.fun API error: 500 Internal Server Error');
    });

    it('should handle network errors', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValueOnce(
        new Error('Network error')
      );

      await expect(pumpFunService.getTokenData('test-mint'))
        .rejects.toThrow('Network error');
    });
  });

  describe('getPrice', () => {
    it('should calculate price from bonding curve', async () => {
      const mockResponse = {
        mint: 'test-mint',
        complete: false,
        virtual_sol_reserves: 1000000000, // 1 SOL
        virtual_token_reserves: 1000000000000, // 1000 tokens
        market_cap: 50000,
        raydium_pool: null,
        bonding_curve: 'bonding-curve-address',
        created_at: '2024-01-01T00:00:00Z'
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      const price = await pumpFunService.getPrice('test-mint');

      expect(price).toBe(0.001); // 1 SOL / 1000 tokens = 0.001 SOL per token
    });

    it('should throw error if token has migrated to DEX', async () => {
      const mockResponse = {
        mint: 'test-mint',
        complete: true, // Token has migrated
        virtual_sol_reserves: 1000000000,
        virtual_token_reserves: 1000000000000,
        market_cap: 70000,
        raydium_pool: 'raydium-pool-address',
        bonding_curve: 'bonding-curve-address',
        created_at: '2024-01-01T00:00:00Z'
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      await expect(pumpFunService.getPrice('test-mint'))
        .rejects.toThrow('Token test-mint has migrated to DEX');
    });
  });

  describe('getTokenStatus', () => {
    it('should return status for token on bonding curve', async () => {
      const mockResponse = {
        mint: 'test-mint',
        complete: false,
        virtual_sol_reserves: 1000000000,
        virtual_token_reserves: 1000000000000,
        market_cap: 50000,
        raydium_pool: null,
        bonding_curve: 'bonding-curve-address',
        created_at: '2024-01-01T00:00:00Z'
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      const status = await pumpFunService.getTokenStatus('test-mint');

      expect(status.exists).toBe(true);
      expect(status.onBondingCurve).toBe(true);
      expect(status.migrated).toBe(false);
      expect(status.raydiumPool).toBe(null);
      expect(status.marketCap).toBe(50000);
    });

    it('should return status for migrated token', async () => {
      const mockResponse = {
        mint: 'test-mint',
        complete: true,
        virtual_sol_reserves: 1000000000,
        virtual_token_reserves: 1000000000000,
        market_cap: 70000,
        raydium_pool: 'raydium-pool-address',
        bonding_curve: 'bonding-curve-address',
        created_at: '2024-01-01T00:00:00Z'
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      const status = await pumpFunService.getTokenStatus('test-mint');

      expect(status.exists).toBe(true);
      expect(status.onBondingCurve).toBe(false);
      expect(status.migrated).toBe(true);
      expect(status.raydiumPool).toBe('raydium-pool-address');
      expect(status.marketCap).toBe(70000);
    });

    it('should return status for non-existent token', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      } as Response);

      const status = await pumpFunService.getTokenStatus('test-mint');

      expect(status.exists).toBe(false);
      expect(status.onBondingCurve).toBe(false);
      expect(status.migrated).toBe(false);
      expect(status.raydiumPool).toBe(null);
      expect(status.marketCap).toBe(0);
    });

    it('should throw error on API failure', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValueOnce(
        new Error('Network error')
      );

      await expect(pumpFunService.getTokenStatus('test-mint'))
        .rejects.toThrow('Network error');
    });
  });

  describe('getMigrationProgress', () => {
    it('should calculate migration progress', async () => {
      const mockResponse = {
        mint: 'test-mint',
        complete: false,
        virtual_sol_reserves: 1000000000,
        virtual_token_reserves: 1000000000000,
        market_cap: 34500, // 50% of 69000
        raydium_pool: null,
        bonding_curve: 'bonding-curve-address',
        created_at: '2024-01-01T00:00:00Z'
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      const progress = await pumpFunService.getMigrationProgress('test-mint');

      expect(progress).toBe(50); // (34500 / 69000) * 100 = 50%
    });

    it('should return 100% for migrated token', async () => {
      const mockResponse = {
        mint: 'test-mint',
        complete: true,
        virtual_sol_reserves: 1000000000,
        virtual_token_reserves: 1000000000000,
        market_cap: 70000,
        raydium_pool: 'raydium-pool-address',
        bonding_curve: 'bonding-curve-address',
        created_at: '2024-01-01T00:00:00Z'
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      const progress = await pumpFunService.getMigrationProgress('test-mint');

      expect(progress).toBe(100);
    });

    it('should cap progress at 100%', async () => {
      const mockResponse = {
        mint: 'test-mint',
        complete: false,
        virtual_sol_reserves: 1000000000,
        virtual_token_reserves: 1000000000000,
        market_cap: 100000, // Over 69000
        raydium_pool: null,
        bonding_curve: 'bonding-curve-address',
        created_at: '2024-01-01T00:00:00Z'
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      const progress = await pumpFunService.getMigrationProgress('test-mint');

      expect(progress).toBe(100); // Should be capped at 100
    });
  });

  describe('getTokenAmountForSol', () => {
    it('should calculate token amount for SOL', async () => {
      const mockResponse = {
        mint: 'test-mint',
        complete: false,
        virtual_sol_reserves: 1000000000, // 1 SOL
        virtual_token_reserves: 1000000000000, // 1000 tokens
        market_cap: 50000,
        raydium_pool: null,
        bonding_curve: 'bonding-curve-address',
        created_at: '2024-01-01T00:00:00Z'
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      const tokenAmount = await pumpFunService.getTokenAmountForSol('test-mint', 1); // 1 SOL

      expect(tokenAmount).toBe(1000); // 1 SOL should get 1000 tokens
    });

    it('should throw error if token has migrated', async () => {
      const mockResponse = {
        mint: 'test-mint',
        complete: true,
        virtual_sol_reserves: 1000000000,
        virtual_token_reserves: 1000000000000,
        market_cap: 70000,
        raydium_pool: 'raydium-pool-address',
        bonding_curve: 'bonding-curve-address',
        created_at: '2024-01-01T00:00:00Z'
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      await expect(pumpFunService.getTokenAmountForSol('test-mint', 1))
        .rejects.toThrow('Token test-mint has migrated to DEX');
    });
  });

  describe('getSolAmountForTokens', () => {
    it('should calculate SOL amount for tokens', async () => {
      const mockResponse = {
        mint: 'test-mint',
        complete: false,
        virtual_sol_reserves: 1000000000, // 1 SOL
        virtual_token_reserves: 1000000000000, // 1000 tokens
        market_cap: 50000,
        raydium_pool: null,
        bonding_curve: 'bonding-curve-address',
        created_at: '2024-01-01T00:00:00Z'
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      const solAmount = await pumpFunService.getSolAmountForTokens('test-mint', 1000); // 1000 tokens

      expect(solAmount).toBe(1); // 1000 tokens should get 1 SOL
    });

    it('should throw error if token has migrated', async () => {
      const mockResponse = {
        mint: 'test-mint',
        complete: true,
        virtual_sol_reserves: 1000000000,
        virtual_token_reserves: 1000000000000,
        market_cap: 70000,
        raydium_pool: 'raydium-pool-address',
        bonding_curve: 'bonding-curve-address',
        created_at: '2024-01-01T00:00:00Z'
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      await expect(pumpFunService.getSolAmountForTokens('test-mint', 1000))
        .rejects.toThrow('Token test-mint has migrated to DEX');
    });
  });

  describe('Cache management', () => {
    it('should clear all cache', async () => {
      const mockResponse = {
        mint: 'token-1',
        complete: false,
        virtual_sol_reserves: 1000000000,
        virtual_token_reserves: 1000000000000,
        market_cap: 50000,
        raydium_pool: null,
        bonding_curve: 'bonding-curve-address',
        created_at: '2024-01-01T00:00:00Z'
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      await pumpFunService.getTokenData('token-1');
      expect(pumpFunService.getCacheSize()).toBe(1);

      pumpFunService.clearCache();
      expect(pumpFunService.getCacheSize()).toBe(0);
    });

    it('should clear cache for specific token', async () => {
      const mockResponse = {
        mint: 'token-1',
        complete: false,
        virtual_sol_reserves: 1000000000,
        virtual_token_reserves: 1000000000000,
        market_cap: 50000,
        raydium_pool: null,
        bonding_curve: 'bonding-curve-address',
        created_at: '2024-01-01T00:00:00Z'
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      await pumpFunService.getTokenData('token-1');
      expect(pumpFunService.getCacheSize()).toBe(1);

      pumpFunService.clearTokenCache('token-1');
      expect(pumpFunService.getCacheSize()).toBe(0);
    });

    it('should return cache size', async () => {
      expect(pumpFunService.getCacheSize()).toBe(0);

      const mockResponse = {
        mint: 'token-1',
        complete: false,
        virtual_sol_reserves: 1000000000,
        virtual_token_reserves: 1000000000000,
        market_cap: 50000,
        raydium_pool: null,
        bonding_curve: 'bonding-curve-address',
        created_at: '2024-01-01T00:00:00Z'
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      await pumpFunService.getTokenData('token-1');
      expect(pumpFunService.getCacheSize()).toBe(1);
    });

    it('should clear expired cache entries', async () => {
      jest.useFakeTimers();

      const mockResponse = {
        mint: 'token-1',
        complete: false,
        virtual_sol_reserves: 1000000000,
        virtual_token_reserves: 1000000000000,
        market_cap: 50000,
        raydium_pool: null,
        bonding_curve: 'bonding-curve-address',
        created_at: '2024-01-01T00:00:00Z'
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      await pumpFunService.getTokenData('token-1');
      expect(pumpFunService.getCacheSize()).toBe(1);

      // Advance time past cache TTL (3 seconds)
      jest.advanceTimersByTime(4000);

      pumpFunService.clearExpiredCache();
      expect(pumpFunService.getCacheSize()).toBe(0);
    });

    it('should keep valid cache entries when clearing expired', async () => {
      jest.useFakeTimers();

      const mockResponse = {
        mint: 'token-1',
        complete: false,
        virtual_sol_reserves: 1000000000,
        virtual_token_reserves: 1000000000000,
        market_cap: 50000,
        raydium_pool: null,
        bonding_curve: 'bonding-curve-address',
        created_at: '2024-01-01T00:00:00Z'
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      await pumpFunService.getTokenData('token-1');
      expect(pumpFunService.getCacheSize()).toBe(1);

      // Advance time but not past TTL
      jest.advanceTimersByTime(2000);

      pumpFunService.clearExpiredCache();
      expect(pumpFunService.getCacheSize()).toBe(1);
    });
  });

  describe('Integration tests', () => {
    it('should handle complete token workflow', async () => {
      const mockResponse = {
        mint: 'test-mint',
        name: 'Test Token',
        symbol: 'TEST',
        complete: false,
        virtual_sol_reserves: 1000000000,
        virtual_token_reserves: 1000000000000,
        market_cap: 34500,
        raydium_pool: null,
        bonding_curve: 'bonding-curve-address',
        created_at: '2024-01-01T00:00:00Z'
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      // Get token data
      const data = await pumpFunService.getTokenData('test-mint');
      expect(data.name).toBe('Test Token');

      // Get price (should use cache)
      const price = await pumpFunService.getPrice('test-mint');
      expect(price).toBe(0.001);

      // Get status (should use cache)
      const status = await pumpFunService.getTokenStatus('test-mint');
      expect(status.exists).toBe(true);
      expect(status.onBondingCurve).toBe(true);

      // Get migration progress (should use cache)
      const progress = await pumpFunService.getMigrationProgress('test-mint');
      expect(progress).toBe(50);

      expect(global.fetch).toHaveBeenCalledTimes(1); // Only one API call due to cache
    });
  });
});
