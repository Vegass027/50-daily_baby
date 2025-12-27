import { DisplayHelper } from '../../src/utils/DisplayHelper';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

describe('DisplayHelper', () => {
  describe('formatBalance', () => {
    it('should format Solana balance correctly', () => {
      const balance = 1_500_000_000; // 1.5 SOL
      const formatted = DisplayHelper.formatBalance('Solana', balance);
      
      expect(formatted).toBe('1.5000 SOL');
    });

    it('should format Ethereum balance correctly', () => {
      const balance = 2_000_000_000_000_000_000n; // 2 ETH
      const formatted = DisplayHelper.formatBalance('Ethereum', Number(balance));
      
      expect(formatted).toBe('2.0000 ETH');
    });

    it('should format BSC balance correctly', () => {
      const balance = 5_000_000_000_000_000_000n; // 5 BNB
      const formatted = DisplayHelper.formatBalance('BSC', Number(balance));
      
      expect(formatted).toBe('5.0000 BNB');
    });

    it('should handle custom decimals', () => {
      const balance = 1_234_567_890;
      const formatted = DisplayHelper.formatBalance('Solana', balance, 6);
      
      expect(formatted).toBe('1.234568 SOL');
    });
  });

  describe('formatTokenAmount', () => {
    it('should format token amount correctly', () => {
      const amount = 1_000_000_000;
      const formatted = DisplayHelper.formatTokenAmount(amount, 9);
      
      expect(formatted).toBe('1.000000000');
    });

    it('should add symbol if provided', () => {
      const amount = 500_000_000;
      const formatted = DisplayHelper.formatTokenAmount(amount, 6, 'USDC');
      
      expect(formatted).toBe('0.500000 USDC');
    });
  });

  describe('parseAmount', () => {
    it('should parse Solana amount correctly', () => {
      const amount = DisplayHelper.parseAmount('Solana', '1.5');
      
      expect(amount).toBe(1_500_000_000);
    });

    it('should parse amount with SOL suffix', () => {
      const amount = DisplayHelper.parseAmount('Solana', '0.5 SOL');
      
      expect(amount).toBe(500_000_000);
    });

    it('should parse Ethereum amount correctly', () => {
      const amount = DisplayHelper.parseAmount('Ethereum', '2.5');
      
      expect(amount).toBe(2_500_000_000_000_000_000);
    });

    it('should throw error for invalid amount', () => {
      expect(() => {
        DisplayHelper.parseAmount('Solana', 'invalid');
      }).toThrow('Invalid amount: invalid');
    });

    it('should throw error for negative amount', () => {
      expect(() => {
        DisplayHelper.parseAmount('Solana', '-1.0');
      }).toThrow('Invalid amount: -1.0');
    });

    it('should throw error for zero amount', () => {
      expect(() => {
        DisplayHelper.parseAmount('Solana', '0');
      }).toThrow('Invalid amount: 0');
    });
  });

  describe('formatPriceImpact', () => {
    it('should format low price impact', () => {
      const formatted = DisplayHelper.formatPriceImpact(0.05);
      
      expect(formatted).toBe('< 0.1%');
    });

    it('should format normal price impact', () => {
      const formatted = DisplayHelper.formatPriceImpact(2.5);
      
      expect(formatted).toBe('2.50%');
    });

    it('should format high price impact with warning', () => {
      const formatted = DisplayHelper.formatPriceImpact(15.5);
      
      expect(formatted).toBe('⚠️ 15.50% (high!)');
    });
  });

  describe('formatSignature', () => {
    it('should format signature correctly', () => {
      const signature = '5x42aA8B9z98E1B7C3D6F2G4H5I6J7K8L9M0N';
      const formatted = DisplayHelper.formatSignature(signature);
      
      expect(formatted).toBe('5x42aA8...9M0N');
    });

    it('should handle short signature', () => {
      const signature = 'abc123';
      const formatted = DisplayHelper.formatSignature(signature);
      
      expect(formatted).toBe('abc123');
    });
  });

  describe('getSolscanUrl', () => {
    it('should generate mainnet URL', () => {
      const signature = '5x42aA8B9z98E1B';
      const url = DisplayHelper.getSolscanUrl(signature);
      
      expect(url).toBe('https://solscan.io/tx/5x42aA8B9z98E1B');
    });

    it('should generate devnet URL', () => {
      const signature = '5x42aA8B9z98E1B';
      const url = DisplayHelper.getSolscanUrl(signature, 'devnet');
      
      expect(url).toBe('https://solscan.io/tx/5x42aA8B9z98E1B?cluster=devnet');
    });
  });

  describe('formatTimestamp', () => {
    it('should format timestamp correctly', () => {
      const timestamp = 1704800000000; // 2024-01-09 00:00:00
      const formatted = DisplayHelper.formatTimestamp(timestamp);
      
      expect(formatted).toContain('09.01.2024');
    });
  });

  describe('lamportsToSOL', () => {
    it('should convert lamports to SOL correctly', () => {
      const lamports = 1_500_000_000;
      const sol = DisplayHelper.lamportsToSOL(lamports);
      
      expect(sol).toBe(1.5);
    });

    it('should handle zero lamports', () => {
      const sol = DisplayHelper.lamportsToSOL(0);
      
      expect(sol).toBe(0);
    });
  });

  describe('solToLamports', () => {
    it('should convert SOL to lamports correctly', () => {
      const sol = 1.5;
      const lamports = DisplayHelper.solToLamports(sol);
      
      expect(lamports).toBe(1_500_000_000);
    });

    it('should handle zero SOL', () => {
      const lamports = DisplayHelper.solToLamports(0);
      
      expect(lamports).toBe(0);
    });

    it('should floor the result', () => {
      const sol = 1.5678;
      const lamports = DisplayHelper.solToLamports(sol);
      
      expect(lamports).toBe(1_567_800_000); // Floored
    });
  });
});
