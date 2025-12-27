import { PriceMonitor } from '../../src/trading/managers/PriceMonitor';
import { PumpFunStrategy } from '../../src/trading/strategies/solana/PumpFunStrategy';
import { Connection } from '@solana/web3.js';

// Mock PumpFunStrategy
const mockPumpFunStrategy = {
  getQuote: jest.fn().mockResolvedValue({
    inputAmount: 1_000_000_000,
    outputAmount: 100_000_000_000,
    priceImpact: 0.5,
    fee: 1000,
    route: 'PumpFun Bonding Curve',
  }),
} as any;

// Mock Connection
const mockConnection = {} as Connection;

describe('PriceMonitor', () => {
  let monitor: PriceMonitor;

  beforeEach(() => {
    jest.clearAllMocks();
    monitor = new PriceMonitor(mockConnection, mockPumpFunStrategy);
  });

  describe('getCurrentPrice', () => {
    it('should get price from strategy', async () => {
      const price = await monitor.getCurrentPrice('test_mint');
      
      expect(price).toBeGreaterThan(0);
      expect(mockPumpFunStrategy.getQuote).toHaveBeenCalledWith({
        tokenIn: 'So11111111111111111111111111111111111111111112',
        tokenOut: 'test_mint',
        amount: 1_000_000_000,
        slippage: 1.0,
        userWallet: null,
      });
    });

    it('should cache price', async () => {
      const price1 = await monitor.getCurrentPrice('test_mint');
      const price2 = await monitor.getCurrentPrice('test_mint');
      
      expect(price1).toBe(price2);
      expect(mockPumpFunStrategy.getQuote).toHaveBeenCalledTimes(1);
    });

    it('should refresh cache after TTL', async () => {
      jest.useFakeTimers();
      
      const price1 = await monitor.getCurrentPrice('test_mint');
      jest.advanceTimersByTime(11000); // 11 seconds (TTL = 10 seconds)
      
      const price2 = await monitor.getCurrentPrice('test_mint');
      
      expect(mockPumpFunStrategy.getQuote).toHaveBeenCalledTimes(2);
      jest.useRealTimers();
    });
  });

  describe('getTokensPerSOL', () => {
    it('should get tokens per SOL', async () => {
      const tokensPerSOL = await monitor.getTokensPerSOL('test_mint');
      
      expect(tokensPerSOL).toBeGreaterThan(0);
      expect(mockPumpFunStrategy.getQuote).toHaveBeenCalledWith({
        tokenIn: 'So11111111111111111111111111111111111111111112',
        tokenOut: 'test_mint',
        amount: 1_000_000_000,
        slippage: 1.0,
        userWallet: null,
      });
    });
  });

  describe('startMonitoring', () => {
    it('should start monitoring for multiple tokens', () => {
      jest.useFakeTimers();
      const callback = jest.fn();
      
      monitor.startMonitoring(
        ['mint1', 'mint2'],
        callback,
        30000
      );
      
      expect(monitor.isMonitoring('mint1')).toBe(true);
      expect(monitor.isMonitoring('mint2')).toBe(true);
      expect(callback).toHaveBeenCalledTimes(2); // Initial calls
      
      jest.advanceTimersByTime(30000);
      expect(callback).toHaveBeenCalledTimes(4); // +2 calls after 30s
      
      jest.useRealTimers();
    });

    it('should support multiple callbacks for same token', () => {
      jest.useFakeTimers();
      const callback1 = jest.fn();
      const callback2 = jest.fn();
      
      monitor.startMonitoring(['mint1'], callback1);
      monitor.startMonitoring(['mint1'], callback2);
      
      jest.advanceTimersByTime(30000);
      
      expect(callback1).toHaveBeenCalledTimes(2);
      expect(callback2).toHaveBeenCalledTimes(2);
      
      jest.useRealTimers();
    });
  });

  describe('stopMonitoring', () => {
    it('should stop monitoring for specific token', () => {
      jest.useFakeTimers();
      const callback = jest.fn();
      
      monitor.startMonitoring(['mint1', 'mint2'], callback);
      monitor.stopMonitoring('mint1');
      
      expect(monitor.isMonitoring('mint1')).toBe(false);
      expect(monitor.isMonitoring('mint2')).toBe(true);
      
      jest.advanceTimersByTime(30000);
      expect(callback).toHaveBeenCalledTimes(1); // Only mint2 callback
      
      jest.useRealTimers();
    });
  });

  describe('stopAllMonitoring', () => {
    it('should stop all monitoring', () => {
      jest.useFakeTimers();
      const callback = jest.fn();
      
      monitor.startMonitoring(['mint1', 'mint2'], callback);
      monitor.stopAllMonitoring();
      
      expect(monitor.isMonitoring('mint1')).toBe(false);
      expect(monitor.isMonitoring('mint2')).toBe(false);
      
      jest.advanceTimersByTime(30000);
      expect(callback).toHaveBeenCalledTimes(2); // Only initial calls
      
      jest.useRealTimers();
    });
  });

  describe('getMonitoredTokens', () => {
    it('should return list of monitored tokens', () => {
      monitor.startMonitoring(['mint1', 'mint2', 'mint3'], jest.fn());
      
      const tokens = monitor.getMonitoredTokens();
      
      expect(tokens).toHaveLength(3);
      expect(tokens).toContain('mint1');
      expect(tokens).toContain('mint2');
      expect(tokens).toContain('mint3');
    });
  });

  describe('clearCache', () => {
    it('should clear price cache', async () => {
      await monitor.getCurrentPrice('test_mint');
      
      monitor.clearCache();
      
      const stats = monitor.getCacheStats();
      expect(stats.size).toBe(0);
    });
  });

  describe('getCacheStats', () => {
    it('should return cache statistics', async () => {
      await monitor.getCurrentPrice('mint1');
      await monitor.getCurrentPrice('mint2');
      
      const stats = monitor.getCacheStats();
      
      expect(stats.size).toBe(2);
      expect(stats.entries).toHaveLength(2);
      expect(stats.entries[0].mint).toBe('mint1');
      expect(stats.entries[1].mint).toBe('mint2');
    });
  });
});
