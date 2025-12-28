import { JupiterPriceService } from '../../src/services/JupiterPriceService';

// Mock global fetch
global.fetch = jest.fn();

describe('JupiterPriceService', () => {
  let jupiterService: JupiterPriceService;

  beforeEach(() => {
    jupiterService = new JupiterPriceService();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getPrice', () => {
    it('should fetch price for a single token', async () => {
      const mockResponse = {
        data: {
          'test-mint': {
            price: '1.5',
            id: 'test-mint',
            type: 'known'
          }
        }
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      const price = await jupiterService.getPrice('test-mint');

      expect(price).toBe(1.5);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.jup.ag/price/v1?ids=test-mint',
        {"headers": {}}
      );
    });

    it('should return cached price if within TTL', async () => {
      const mockResponse = {
        data: {
          'test-mint': {
            price: '1.5'
          }
        }
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      // First call - fetches from API
      const price1 = await jupiterService.getPrice('test-mint');
      expect(price1).toBe(1.5);
      expect(global.fetch).toHaveBeenCalledTimes(1);

      // Second call - should use cache
      const price2 = await jupiterService.getPrice('test-mint');
      expect(price2).toBe(1.5);
      expect(global.fetch).toHaveBeenCalledTimes(1); // No additional fetch
    });

    it('should fetch new price if cache expired', async () => {
      jest.useFakeTimers();

      const mockResponse1 = {
        data: {
          'test-mint': {
            price: '1.5'
          }
        }
      };

      const mockResponse2 = {
        data: {
          'test-mint': {
            price: '2.0'
          }
        }
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
      const price1 = await jupiterService.getPrice('test-mint');
      expect(price1).toBe(1.5);

      // Advance time past cache TTL (5 seconds)
      jest.advanceTimersByTime(6000);

      // Second call - should fetch new price
      const price2 = await jupiterService.getPrice('test-mint');
      expect(price2).toBe(2.0);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should throw error for 404 response', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      } as Response);

      await expect(jupiterService.getPrice('test-mint'))
        .rejects.toThrow('Jupiter API error: 404 Not Found');
    });

    it('should throw error for 500 response', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      } as Response);

      await expect(jupiterService.getPrice('test-mint'))
        .rejects.toThrow('Jupiter API error: 500 Internal Server Error');
    });

    it('should throw error if token not found in response', async () => {
      const mockResponse = {
        data: {
          'other-mint': {
            price: '1.5'
          }
        }
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      await expect(jupiterService.getPrice('test-mint'))
        .rejects.toThrow('Token test-mint not found in Jupiter');
    });

    it('should handle network errors', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValueOnce(
        new Error('Network error')
      );

      await expect(jupiterService.getPrice('test-mint'))
        .rejects.toThrow('Network error');
    });
  });

  describe('getPrices', () => {
    it('should fetch prices for multiple tokens', async () => {
      const mockResponse = {
        data: {
          'token-1': { price: '1.0' },
          'token-2': { price: '2.0' },
          'token-3': { price: '3.0' }
        }
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      const prices = await jupiterService.getPrices(['token-1', 'token-2', 'token-3']);

      expect(prices.size).toBe(3);
      expect(prices.get('token-1')).toBe(1.0);
      expect(prices.get('token-2')).toBe(2.0);
      expect(prices.get('token-3')).toBe(3.0);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.jup.ag/price/v1?ids=token-1,token-2,token-3',
        {"headers": {}}
      );
    });

    it('should handle partial results (some tokens not found)', async () => {
      const mockResponse = {
        data: {
          'token-1': { price: '1.0' },
          'token-3': { price: '3.0' }
        }
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      const prices = await jupiterService.getPrices(['token-1', 'token-2', 'token-3']);

      expect(prices.size).toBe(2);
      expect(prices.get('token-1')).toBe(1.0);
      expect(prices.get('token-2')).toBeUndefined();
      expect(prices.get('token-3')).toBe(3.0);
    });

    it('should handle empty token list', async () => {
      const mockResponse = {
        data: {}
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      const prices = await jupiterService.getPrices([]);

      expect(prices.size).toBe(0);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.jup.ag/price/v1?ids=',
        {"headers": {}}
      );
    });

    it('should throw error on API failure', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests'
      } as Response);

      await expect(jupiterService.getPrices(['token-1', 'token-2']))
        .rejects.toThrow('Jupiter API error: 429 Too Many Requests');
    });

    it('should cache prices after fetching', async () => {
      const mockResponse = {
        data: {
          'token-1': { price: '1.0' }
        }
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      await jupiterService.getPrices(['token-1']);
      expect(jupiterService.getCacheSize()).toBe(1);
    });
  });

  describe('isTokenSupported', () => {
    it('should return true for supported token', async () => {
      const mockResponse = {
        data: {
          'test-mint': {
            price: '1.5'
          }
        }
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      const isSupported = await jupiterService.isTokenSupported('test-mint');

      expect(isSupported).toBe(true);
    });

    it('should return false for unsupported token', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      } as Response);

      const isSupported = await jupiterService.isTokenSupported('test-mint');

      expect(isSupported).toBe(false);
    });

    it('should return false on network error', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValueOnce(
        new Error('Network error')
      );

      const isSupported = await jupiterService.isTokenSupported('test-mint');

      expect(isSupported).toBe(false);
    });
  });

  describe('getPriceDetails', () => {
    it('should fetch price details for a token', async () => {
      const mockResponse = {
        data: {
          'test-mint': {
            price: '1.5',
            id: 'test-mint',
            type: 'known'
          }
        }
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      const details = await jupiterService.getPriceDetails('test-mint');

      expect(details.price).toBe(1.5);
      expect(details.id).toBe('test-mint');
      expect(details.type).toBe('known');
    });

    it('should throw error if token not found', async () => {
      const mockResponse = {
        data: {}
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      await expect(jupiterService.getPriceDetails('test-mint'))
        .rejects.toThrow('Token test-mint not found in Jupiter');
    });
  });

  describe('Cache management', () => {
    it('should clear all cache', async () => {
      const mockResponse = {
        data: {
          'token-1': { price: '1.0' },
          'token-2': { price: '2.0' }
        }
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      await jupiterService.getPrices(['token-1', 'token-2']);
      expect(jupiterService.getCacheSize()).toBe(2);

      jupiterService.clearCache();
      expect(jupiterService.getCacheSize()).toBe(0);
    });

    it('should clear cache for specific token', async () => {
      const mockResponse = {
        data: {
          'token-1': { price: '1.0' },
          'token-2': { price: '2.0' }
        }
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      await jupiterService.getPrices(['token-1', 'token-2']);
      expect(jupiterService.getCacheSize()).toBe(2);

      jupiterService.clearTokenCache('token-1');
      expect(jupiterService.getCacheSize()).toBe(1);
    });

    it('should return cache size', async () => {
      expect(jupiterService.getCacheSize()).toBe(0);

      const mockResponse = {
        data: {
          'token-1': { price: '1.0' }
        }
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      await jupiterService.getPrice('token-1');
      expect(jupiterService.getCacheSize()).toBe(1);
    });

    it('should clear expired cache entries', async () => {
      jest.useFakeTimers();

      const mockResponse = {
        data: {
          'token-1': { price: '1.0' }
        }
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      await jupiterService.getPrice('token-1');
      expect(jupiterService.getCacheSize()).toBe(1);

      // Advance time past cache TTL
      jest.advanceTimersByTime(6000);

      jupiterService.clearExpiredCache();
      expect(jupiterService.getCacheSize()).toBe(0);
    });

    it('should keep valid cache entries when clearing expired', async () => {
      jest.useFakeTimers();

      const mockResponse = {
        data: {
          'token-1': { price: '1.0' }
        }
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse
      } as Response);

      await jupiterService.getPrice('token-1');
      expect(jupiterService.getCacheSize()).toBe(1);

      // Advance time but not past TTL
      jest.advanceTimersByTime(3000);

      jupiterService.clearExpiredCache();
      expect(jupiterService.getCacheSize()).toBe(1);
    });
  });

  describe('Rate limit handling', () => {
    it('should handle 429 rate limit error', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests'
      } as Response);

      await expect(jupiterService.getPrice('test-mint'))
        .rejects.toThrow('Jupiter API error: 429 Too Many Requests');
    });

    it('should handle rate limit in batch request', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests'
      } as Response);

      await expect(jupiterService.getPrices(['token-1', 'token-2']))
        .rejects.toThrow('Jupiter API error: 429 Too Many Requests');
    });
  });

  describe('Integration tests', () => {
    it('should handle complete price fetching workflow', async () => {
      const mockResponse1 = {
        data: {
          'token-1': { price: '1.0', id: 'token-1', type: 'known' }
        }
      };

      const mockResponse2 = {
        data: {
          'token-2': { price: '2.0', id: 'token-2', type: 'known' }
        }
      };

      const mockResponse3 = {
        data: {
          'token-1': { price: '1.0', id: 'token-1', type: 'known' },
          'token-2': { price: '2.0', id: 'token-2', type: 'known' }
        }
      };

      const mockResponse4 = {
        data: {
          'token-1': { price: '1.0', id: 'token-1', type: 'known' }
        }
      };

      (global.fetch as jest.MockedFunction<typeof fetch>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse1
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse2
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse3
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockResponse4
        } as Response);

      // Check if tokens are supported
      const isSupported1 = await jupiterService.isTokenSupported('token-1');
      const isSupported2 = await jupiterService.isTokenSupported('token-2');

      expect(isSupported1).toBe(true);
      expect(isSupported2).toBe(true);

      // Get prices (should use cache)
      const prices = await jupiterService.getPrices(['token-1', 'token-2']);

      expect(prices.get('token-1')).toBe(1.0);
      expect(prices.get('token-2')).toBe(2.0);
      expect(global.fetch).toHaveBeenCalledTimes(3); // Two for isTokenSupported + one for getPrices

      // Get price details (getPriceDetails makes its own request, doesn't check cache)
      const details = await jupiterService.getPriceDetails('token-1');

      expect(details.price).toBe(1.0);
      expect(details.id).toBe('token-1');
      expect(details.type).toBe('known');
      expect(global.fetch).toHaveBeenCalledTimes(4); // +1 for getPriceDetails
    });
  });
});
