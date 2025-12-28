import { AlchemyRpcService } from '../../src/services/AlchemyRpcService';
import { Connection, Transaction, PublicKey } from '@solana/web3.js';

// Mock @solana/web3.js
jest.mock('@solana/web3.js', () => {
  const actual = jest.requireActual('@solana/web3.js');
  return {
    ...actual,
    Connection: jest.fn().mockImplementation(() => ({
      sendRawTransaction: jest.fn(),
      confirmTransaction: jest.fn(),
      simulateTransaction: jest.fn(),
      getBalance: jest.fn(),
      getLatestBlockhash: jest.fn(),
    })),
    Transaction: jest.fn().mockImplementation(() => ({
      serialize: jest.fn().mockReturnValue(Buffer.from('mock-transaction')),
    })),
    PublicKey: jest.fn().mockImplementation(() => ({})),
  };
});

describe('AlchemyRpcService', () => {
  let alchemyService: AlchemyRpcService;
  let mockConnection: jest.Mocked<Connection>;
  let mockTransaction: jest.Mocked<Transaction>;

  beforeEach(() => {
    // Create service with test API key
    alchemyService = new AlchemyRpcService('test-api-key');
    
    // Get mock connection
    mockConnection = (alchemyService as any).connection as jest.Mocked<Connection>;
    
    // Create mock transaction
    mockTransaction = new Transaction() as jest.Mocked<Transaction>;
  });

  describe('Constructor', () => {
    it('should initialize with correct RPC URL', () => {
      const service = new AlchemyRpcService('my-api-key');
      expect(service.getRpcUrl()).toBe('https://solana-mainnet.g.alchemy.com/v2/my-api-key');
    });

    it('should create Connection instance', () => {
      expect(Connection).toHaveBeenCalledWith(
        'https://solana-mainnet.g.alchemy.com/v2/test-api-key',
        'confirmed'
      );
    });

    it('should provide access to Connection', () => {
      const connection = alchemyService.getConnection();
      expect(connection).toBe(mockConnection);
    });
  });

  describe('sendTransaction', () => {
    it('should send transaction with default options', async () => {
      const mockSignature = 'test-signature';
      mockConnection.sendRawTransaction.mockResolvedValue(mockSignature);

      const signature = await alchemyService.sendTransaction(mockTransaction);

      expect(signature).toBe(mockSignature);
      expect(mockConnection.sendRawTransaction).toHaveBeenCalledWith(
        Buffer.from('mock-transaction'),
        {
          skipPreflight: false,
          maxRetries: 3
        }
      );
    });

    it('should send transaction with custom options', async () => {
      const mockSignature = 'test-signature';
      mockConnection.sendRawTransaction.mockResolvedValue(mockSignature);

      const signature = await alchemyService.sendTransaction(mockTransaction, {
        skipPreflight: true,
        maxRetries: 5
      });

      expect(signature).toBe(mockSignature);
      expect(mockConnection.sendRawTransaction).toHaveBeenCalledWith(
        Buffer.from('mock-transaction'),
        {
          skipPreflight: true,
          maxRetries: 5
        }
      );
    });

    it('should throw error on send failure', async () => {
      const mockError = new Error('RPC error');
      mockConnection.sendRawTransaction.mockRejectedValue(mockError);

      await expect(alchemyService.sendTransaction(mockTransaction))
        .rejects.toThrow('Alchemy send transaction error: Error: RPC error');
    });

    it('should serialize transaction before sending', async () => {
      const mockSignature = 'test-signature';
      mockConnection.sendRawTransaction.mockResolvedValue(mockSignature);

      await alchemyService.sendTransaction(mockTransaction);

      expect(mockTransaction.serialize).toHaveBeenCalled();
    });
  });

  describe('confirmTransaction', () => {
    it('should confirm transaction with default commitment', async () => {
      mockConnection.confirmTransaction.mockResolvedValue({
        context: { slot: 123456 },
        value: { err: null }
      });

      const result = await alchemyService.confirmTransaction('test-signature');

      expect(result).toBe(true);
      expect(mockConnection.confirmTransaction).toHaveBeenCalledWith(
        'test-signature',
        'confirmed'
      );
    });

    it('should confirm transaction with finalized commitment', async () => {
      mockConnection.confirmTransaction.mockResolvedValue({
        context: { slot: 123456 },
        value: { err: null }
      });

      const result = await alchemyService.confirmTransaction(
        'test-signature',
        'finalized'
      );

      expect(result).toBe(true);
      expect(mockConnection.confirmTransaction).toHaveBeenCalledWith(
        'test-signature',
        'finalized'
      );
    });

    it('should return false on transaction error', async () => {
      mockConnection.confirmTransaction.mockResolvedValue({
        context: { slot: 123456 },
        value: { err: 'Transaction failed' }
      });

      const result = await alchemyService.confirmTransaction('test-signature');

      expect(result).toBe(false);
    });

    it('should throw error on confirm failure', async () => {
      const mockError = new Error('Confirm error');
      mockConnection.confirmTransaction.mockRejectedValue(mockError);

      await expect(alchemyService.confirmTransaction('test-signature'))
        .rejects.toThrow('Alchemy confirm transaction error: Error: Confirm error');
    });
  });

  describe('simulateTransaction', () => {
    it('should simulate successful transaction', async () => {
      mockConnection.simulateTransaction.mockResolvedValue({
        context: { slot: 123456 },
        value: {
          err: null,
          logs: ['log1', 'log2']
        }
      });

      const result = await alchemyService.simulateTransaction(mockTransaction);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.logs).toEqual(['log1', 'log2']);
    });

    it('should simulate failed transaction', async () => {
      mockConnection.simulateTransaction.mockResolvedValue({
        context: { slot: 123456 },
        value: {
          err: 'Insufficient funds',
          logs: ['error log']
        }
      });

      const result = await alchemyService.simulateTransaction(mockTransaction);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Insufficient funds');
      expect(result.logs).toEqual(['error log']);
    });

    it('should handle simulation error', async () => {
      const mockError = new Error('Simulation failed');
      mockConnection.simulateTransaction.mockRejectedValue(mockError);

      const result = await alchemyService.simulateTransaction(mockTransaction);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Simulation error: Error: Simulation failed');
      expect(result.logs).toBeUndefined();
    });

    it('should handle undefined logs', async () => {
      mockConnection.simulateTransaction.mockResolvedValue({
        context: { slot: 123456 },
        value: {
          err: null,
          logs: null
        }
      });

      const result = await alchemyService.simulateTransaction(mockTransaction);

      expect(result.success).toBe(true);
      expect(result.logs).toBeUndefined();
    });
  });

  describe('getBalance', () => {
    it('should get balance for public key', async () => {
      const mockBalance = 1000000000; // 1 SOL in lamports
      mockConnection.getBalance.mockResolvedValue(mockBalance);

      const balance = await alchemyService.getBalance('test-public-key');

      expect(balance).toBe(mockBalance);
      expect(mockConnection.getBalance).toHaveBeenCalledTimes(1);
    });

    it('should throw error on getBalance failure', async () => {
      const mockError = new Error('Invalid public key');
      mockConnection.getBalance.mockRejectedValue(mockError);

      await expect(alchemyService.getBalance('invalid-key'))
        .rejects.toThrow('Alchemy get balance error: Error: Invalid public key');
    });

    it('should handle zero balance', async () => {
      mockConnection.getBalance.mockResolvedValue(0);

      const balance = await alchemyService.getBalance('test-public-key');

      expect(balance).toBe(0);
    });
  });

  describe('getLatestBlockhash', () => {
    it('should get latest blockhash', async () => {
      const mockBlockhash = {
        blockhash: 'test-blockhash',
        lastValidBlockHeight: 123456
      };
      mockConnection.getLatestBlockhash.mockResolvedValue(mockBlockhash);

      const result = await alchemyService.getLatestBlockhash();

      expect(result).toEqual(mockBlockhash);
      expect(mockConnection.getLatestBlockhash).toHaveBeenCalled();
    });

    it('should throw error on getLatestBlockhash failure', async () => {
      const mockError = new Error('RPC timeout');
      mockConnection.getLatestBlockhash.mockRejectedValue(mockError);

      await expect(alchemyService.getLatestBlockhash())
        .rejects.toThrow('Alchemy get latest blockhash error: Error: RPC timeout');
    });
  });

  describe('getConnection', () => {
    it('should return the Connection instance', () => {
      const connection = alchemyService.getConnection();

      expect(connection).toBe(mockConnection);
    });

    it('should return same instance on multiple calls', () => {
      const connection1 = alchemyService.getConnection();
      const connection2 = alchemyService.getConnection();

      expect(connection1).toBe(connection2);
    });
  });

  describe('getRpcUrl', () => {
    it('should return correct RPC URL', () => {
      const service = new AlchemyRpcService('my-api-key');
      const url = service.getRpcUrl();

      expect(url).toBe('https://solana-mainnet.g.alchemy.com/v2/my-api-key');
    });

    it('should handle API key with special characters', () => {
      const service = new AlchemyRpcService('key-with-special-chars-123');
      const url = service.getRpcUrl();

      expect(url).toBe('https://solana-mainnet.g.alchemy.com/v2/key-with-special-chars-123');
    });
  });

  describe('Integration tests', () => {
    it('should handle full transaction flow', async () => {
      // Mock successful transaction flow
      mockConnection.simulateTransaction.mockResolvedValue({
        context: { slot: 123456 },
        value: { err: null, logs: ['simulation log'] }
      });

      const mockSignature = 'test-signature';
      mockConnection.sendRawTransaction.mockResolvedValue(mockSignature);

      mockConnection.confirmTransaction.mockResolvedValue({
        context: { slot: 123456 },
        value: { err: null }
      });

      // Simulate
      const simResult = await alchemyService.simulateTransaction(mockTransaction);
      expect(simResult.success).toBe(true);

      // Send
      const signature = await alchemyService.sendTransaction(mockTransaction);
      expect(signature).toBe(mockSignature);

      // Confirm
      const confirmed = await alchemyService.confirmTransaction(signature);
      expect(confirmed).toBe(true);
    });

    it('should handle transaction failure flow', async () => {
      // Mock failed simulation
      mockConnection.simulateTransaction.mockResolvedValue({
        context: { slot: 123456 },
        value: { err: 'Insufficient funds', logs: [] }
      });

      const simResult = await alchemyService.simulateTransaction(mockTransaction);
      expect(simResult.success).toBe(false);
      expect(simResult.error).toBe('Insufficient funds');

      // Should not attempt to send failed simulation
      expect(mockConnection.sendRawTransaction).not.toHaveBeenCalled();
    });
  });
});
