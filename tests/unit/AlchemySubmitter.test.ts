import { AlchemySubmitter } from '../../src/services/AlchemySubmitter';
import { Connection, Transaction, Keypair, PublicKey } from '@solana/web3.js';

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
    Transaction: {
      from: jest.fn().mockReturnValue({
        serialize: jest.fn().mockReturnValue(Buffer.from('mock-transaction')),
        sign: jest.fn(),
      }),
    },
    Keypair: {
      generate: jest.fn(),
      fromSecretKey: jest.fn(),
    },
    PublicKey: jest.fn().mockImplementation(() => ({})),
  };
});

describe('AlchemySubmitter', () => {
  let alchemySubmitter: AlchemySubmitter;
  let mockConnection: jest.Mocked<Connection>;
  let mockTransaction: jest.Mocked<Transaction>;

  beforeEach(() => {
    const apiKey = 'test-api-key';
    alchemySubmitter = new AlchemySubmitter(apiKey);
    mockConnection = alchemySubmitter.getConnection() as jest.Mocked<Connection>;
    
    mockTransaction = {
      serialize: jest.fn().mockReturnValue(Buffer.from('mock-transaction')),
      sign: jest.fn(),
    } as unknown as jest.Mocked<Transaction>;
    
    jest.clearAllMocks();
  });

  describe('Constructor', () => {
    it('should initialize with API key', () => {
      const apiKey = 'test-api-key';
      const submitter = new AlchemySubmitter(apiKey);

      expect(submitter.getApiKey()).toBe(apiKey);
    });

    it('should create Connection with correct RPC URL', () => {
      const apiKey = 'test-api-key';
      const submitter = new AlchemySubmitter(apiKey);

      const expectedRpcUrl = `https://solana-mainnet.g.alchemy.com/v2/${apiKey}`;
      expect(submitter.getRpcUrl()).toBe(expectedRpcUrl);
    });

    it('should return same Connection instance', () => {
      const connection1 = alchemySubmitter.getConnection();
      const connection2 = alchemySubmitter.getConnection();

      expect(connection1).toBe(connection2);
    });
  });

  describe('sendTransaction', () => {
    it('should send transaction successfully', async () => {
      const mockSignature = 'test-signature';
      (mockConnection.sendRawTransaction as jest.Mock).mockResolvedValueOnce(mockSignature);

      const signature = await alchemySubmitter.sendTransaction(mockTransaction);

      expect(signature).toBe(mockSignature);
      expect(mockConnection.sendRawTransaction).toHaveBeenCalledWith(
        Buffer.from('mock-transaction'),
        {
          skipPreflight: false,
          maxRetries: 3
        }
      );
    });

    it('should use custom skipPreflight option', async () => {
      const mockSignature = 'test-signature';
      (mockConnection.sendRawTransaction as jest.Mock).mockResolvedValueOnce(mockSignature);

      await alchemySubmitter.sendTransaction(mockTransaction, {
        skipPreflight: true,
        maxRetries: 5
      });

      expect(mockConnection.sendRawTransaction).toHaveBeenCalledWith(
        Buffer.from('mock-transaction'),
        {
          skipPreflight: true,
          maxRetries: 5
        }
      );
    });

    it('should use custom maxRetries option', async () => {
      const mockSignature = 'test-signature';
      (mockConnection.sendRawTransaction as jest.Mock).mockResolvedValueOnce(mockSignature);

      await alchemySubmitter.sendTransaction(mockTransaction, {
        maxRetries: 10
      });

      expect(mockConnection.sendRawTransaction).toHaveBeenCalledWith(
        Buffer.from('mock-transaction'),
        {
          skipPreflight: false,
          maxRetries: 10
        }
      );
    });

    it('should throw error on send failure', async () => {
      (mockConnection.sendRawTransaction as jest.Mock).mockRejectedValueOnce(
        new Error('Network error')
      );

      await expect(
        alchemySubmitter.sendTransaction(mockTransaction)
      ).rejects.toThrow('Alchemy send transaction error');
    });

    it('should handle timeout errors', async () => {
      (mockConnection.sendRawTransaction as jest.Mock).mockRejectedValueOnce(
        new Error('Timeout')
      );

      await expect(
        alchemySubmitter.sendTransaction(mockTransaction)
      ).rejects.toThrow('Alchemy send transaction error');
    });
  });

  describe('confirmTransaction', () => {
    it('should confirm transaction successfully', async () => {
      const mockResult = {
        value: { err: null }
      };
      (mockConnection.confirmTransaction as jest.Mock).mockResolvedValueOnce(mockResult);

      const confirmed = await alchemySubmitter.confirmTransaction('test-signature');

      expect(confirmed).toBe(true);
      expect(mockConnection.confirmTransaction).toHaveBeenCalledWith(
        'test-signature',
        'confirmed'
      );
    });

    it('should use default commitment level', async () => {
      const mockResult = {
        value: { err: null }
      };
      (mockConnection.confirmTransaction as jest.Mock).mockResolvedValueOnce(mockResult);

      await alchemySubmitter.confirmTransaction('test-signature');

      expect(mockConnection.confirmTransaction).toHaveBeenCalledWith(
        'test-signature',
        'confirmed'
      );
    });

    it('should use custom commitment level', async () => {
      const mockResult = {
        value: { err: null }
      };
      (mockConnection.confirmTransaction as jest.Mock).mockResolvedValueOnce(mockResult);

      await alchemySubmitter.confirmTransaction('test-signature', 'finalized');

      expect(mockConnection.confirmTransaction).toHaveBeenCalledWith(
        'test-signature',
        'finalized'
      );
    });

    it('should use custom timeout', async () => {
      const mockResult = {
        value: { err: null }
      };
      (mockConnection.confirmTransaction as jest.Mock).mockResolvedValueOnce(mockResult);

      await alchemySubmitter.confirmTransaction('test-signature', 'confirmed', 120000);

      expect(mockConnection.confirmTransaction).toHaveBeenCalledWith(
        'test-signature',
        'confirmed'
      );
    });

    it('should return false for failed transaction', async () => {
      const mockResult = {
        value: { err: 'Transaction failed' }
      };
      (mockConnection.confirmTransaction as jest.Mock).mockResolvedValueOnce(mockResult);

      const confirmed = await alchemySubmitter.confirmTransaction('test-signature');

      expect(confirmed).toBe(false);
    });

    it('should throw error on confirm failure', async () => {
      (mockConnection.confirmTransaction as jest.Mock).mockRejectedValueOnce(
        new Error('Network error')
      );

      await expect(
        alchemySubmitter.confirmTransaction('test-signature')
      ).rejects.toThrow('Alchemy confirm transaction error');
    });

    it('should handle timeout errors', async () => {
      (mockConnection.confirmTransaction as jest.Mock).mockRejectedValueOnce(
        new Error('Timeout')
      );

      await expect(
        alchemySubmitter.confirmTransaction('test-signature')
      ).rejects.toThrow('Alchemy confirm transaction error');
    });
  });

  describe('simulateTransaction', () => {
    it('should simulate transaction successfully', async () => {
      const mockResult = {
        value: {
          err: null,
          logs: ['Log 1', 'Log 2']
        }
      };
      (mockConnection.simulateTransaction as jest.Mock).mockResolvedValueOnce(mockResult);

      const result = await alchemySubmitter.simulateTransaction(mockTransaction);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.logs).toEqual(['Log 1', 'Log 2']);
    });

    it('should return error for failed simulation', async () => {
      const mockResult = {
        value: {
          err: 'Insufficient funds',
          logs: ['Error: Insufficient funds']
        }
      };
      (mockConnection.simulateTransaction as jest.Mock).mockResolvedValueOnce(mockResult);

      const result = await alchemySubmitter.simulateTransaction(mockTransaction);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Insufficient funds');
      expect(result.logs).toEqual(['Error: Insufficient funds']);
    });

    it('should handle simulation without logs', async () => {
      const mockResult = {
        value: {
          err: null,
          logs: null
        }
      };
      (mockConnection.simulateTransaction as jest.Mock).mockResolvedValueOnce(mockResult);

      const result = await alchemySubmitter.simulateTransaction(mockTransaction);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
      expect(result.logs).toBeUndefined();
    });

    it('should throw error on simulation failure', async () => {
      (mockConnection.simulateTransaction as jest.Mock).mockRejectedValueOnce(
        new Error('Network error')
      );

      const result = await alchemySubmitter.simulateTransaction(mockTransaction);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Simulation error: Error: Network error');
    });

    it('should handle timeout errors', async () => {
      (mockConnection.simulateTransaction as jest.Mock).mockRejectedValueOnce(
        new Error('Timeout')
      );

      const result = await alchemySubmitter.simulateTransaction(mockTransaction);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Simulation error: Error: Timeout');
    });
  });

  describe('getConnection', () => {
    it('should return Connection instance', () => {
      const connection = alchemySubmitter.getConnection();

      expect(connection).toBeDefined();
    });

    it('should return same instance on multiple calls', () => {
      const connection1 = alchemySubmitter.getConnection();
      const connection2 = alchemySubmitter.getConnection();

      expect(connection1).toBe(connection2);
    });
  });

  describe('getApiKey', () => {
    it('should return API key', () => {
      const apiKey = 'test-api-key-123';
      const submitter = new AlchemySubmitter(apiKey);

      expect(submitter.getApiKey()).toBe(apiKey);
    });
  });

  describe('getRpcUrl', () => {
    it('should return correct RPC URL', () => {
      const apiKey = 'test-api-key-123';
      const submitter = new AlchemySubmitter(apiKey);

      const expectedRpcUrl = `https://solana-mainnet.g.alchemy.com/v2/${apiKey}`;
      expect(submitter.getRpcUrl()).toBe(expectedRpcUrl);
    });

    it('should handle API key with special characters', () => {
      const apiKey = 'test-api-key-with-special-chars-123!@#';
      const submitter = new AlchemySubmitter(apiKey);

      const expectedRpcUrl = `https://solana-mainnet.g.alchemy.com/v2/${apiKey}`;
      expect(submitter.getRpcUrl()).toBe(expectedRpcUrl);
    });
  });

  describe('Integration tests', () => {
    it('should handle complete transaction flow', async () => {
      // Simulate transaction
      const mockSimulateResult = {
        value: {
          err: null,
          logs: ['Program execute: success']
        }
      };
      (mockConnection.simulateTransaction as jest.Mock).mockResolvedValueOnce(mockSimulateResult);

      const simulateResult = await alchemySubmitter.simulateTransaction(mockTransaction);
      expect(simulateResult.success).toBe(true);

      // Send transaction
      const mockSignature = 'test-signature-123';
      (mockConnection.sendRawTransaction as jest.Mock).mockResolvedValueOnce(mockSignature);

      const signature = await alchemySubmitter.sendTransaction(mockTransaction);
      expect(signature).toBe(mockSignature);

      // Confirm transaction
      const mockConfirmResult = {
        value: { err: null }
      };
      (mockConnection.confirmTransaction as jest.Mock).mockResolvedValueOnce(mockConfirmResult);

      const confirmed = await alchemySubmitter.confirmTransaction(signature);
      expect(confirmed).toBe(true);
    });

    it('should handle transaction failure flow', async () => {
      // Simulate transaction with error
      const mockSimulateResult = {
        value: {
          err: 'Insufficient funds',
          logs: ['Error: Insufficient funds']
        }
      };
      (mockConnection.simulateTransaction as jest.Mock).mockResolvedValueOnce(mockSimulateResult);

      const simulateResult = await alchemySubmitter.simulateTransaction(mockTransaction);
      expect(simulateResult.success).toBe(false);
      expect(simulateResult.error).toBe('Insufficient funds');

      // Transaction should not be sent
      expect(mockConnection.sendRawTransaction).not.toHaveBeenCalled();
    });

    it('should handle confirmation failure', async () => {
      // Send transaction
      const mockSignature = 'test-signature-123';
      (mockConnection.sendRawTransaction as jest.Mock).mockResolvedValueOnce(mockSignature);

      const signature = await alchemySubmitter.sendTransaction(mockTransaction);
      expect(signature).toBe(mockSignature);

      // Confirm transaction with error
      const mockConfirmResult = {
        value: { err: 'Transaction failed' }
      };
      (mockConnection.confirmTransaction as jest.Mock).mockResolvedValueOnce(mockConfirmResult);

      const confirmed = await alchemySubmitter.confirmTransaction(signature);
      expect(confirmed).toBe(false);
    });

    it('should handle network errors gracefully', async () => {
      // Simulate transaction with network error
      (mockConnection.simulateTransaction as jest.Mock).mockRejectedValueOnce(
        new Error('Network error')
      );

      const simulateResult = await alchemySubmitter.simulateTransaction(mockTransaction);
      expect(simulateResult.success).toBe(false);
      expect(simulateResult.error).toContain('Network error');

      // Send transaction with network error
      (mockConnection.sendRawTransaction as jest.Mock).mockRejectedValueOnce(
        new Error('Network error')
      );

      await expect(
        alchemySubmitter.sendTransaction(mockTransaction)
      ).rejects.toThrow('Alchemy send transaction error');

      // Confirm transaction with network error
      (mockConnection.confirmTransaction as jest.Mock).mockRejectedValueOnce(
        new Error('Network error')
      );

      await expect(
        alchemySubmitter.confirmTransaction('test-signature')
      ).rejects.toThrow('Alchemy confirm transaction error');
    });
  });

  describe('Error handling', () => {
    it('should handle connection errors', async () => {
      (mockConnection.sendRawTransaction as jest.Mock).mockRejectedValueOnce(
        new Error('Connection refused')
      );

      await expect(
        alchemySubmitter.sendTransaction(mockTransaction)
      ).rejects.toThrow('Alchemy send transaction error');
    });

    it('should handle timeout errors', async () => {
      (mockConnection.sendRawTransaction as jest.Mock).mockRejectedValueOnce(
        new Error('Request timeout')
      );

      await expect(
        alchemySubmitter.sendTransaction(mockTransaction)
      ).rejects.toThrow('Alchemy send transaction error');
    });

    it('should handle invalid transaction errors', async () => {
      (mockConnection.simulateTransaction as jest.Mock).mockResolvedValueOnce({
        value: {
          err: 'Invalid transaction',
          logs: ['Error: Invalid transaction']
        }
      });

      const result = await alchemySubmitter.simulateTransaction(mockTransaction);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid transaction');
    });

    it('should handle rate limit errors', async () => {
      (mockConnection.sendRawTransaction as jest.Mock).mockRejectedValueOnce(
        new Error('Rate limit exceeded')
      );

      await expect(
        alchemySubmitter.sendTransaction(mockTransaction)
      ).rejects.toThrow('Alchemy send transaction error');
    });
  });

  describe('Interface compliance', () => {
    it('should implement ITransactionSubmitter interface', () => {
      expect(alchemySubmitter.sendTransaction).toBeDefined();
      expect(alchemySubmitter.confirmTransaction).toBeDefined();
      expect(alchemySubmitter.simulateTransaction).toBeDefined();
      expect(alchemySubmitter.getConnection).toBeDefined();
    });

    it('should have correct method signatures', () => {
      expect(typeof alchemySubmitter.sendTransaction).toBe('function');
      expect(typeof alchemySubmitter.confirmTransaction).toBe('function');
      expect(typeof alchemySubmitter.simulateTransaction).toBe('function');
      expect(typeof alchemySubmitter.getConnection).toBe('function');
    });
  });
});
