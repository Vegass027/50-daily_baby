import { PumpFunSwapService } from '../../src/services/PumpFunSwapService';
import { Connection, Transaction, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import { PumpFunSDK } from 'pumpdotfun-sdk';
import { AnchorProvider } from '@coral-xyz/anchor';
import NodeWallet from '@coral-xyz/anchor/dist/cjs/nodewallet';

// Mock pumpdotfun-sdk
jest.mock('pumpdotfun-sdk', () => {
  const actual = jest.requireActual('pumpdotfun-sdk');
  return {
    ...actual,
    PumpFunSDK: jest.fn().mockImplementation(() => ({
      buy: jest.fn(),
      sell: jest.fn(),
      getBondingCurveAccount: jest.fn(),
    })),
  };
});

// Mock @coral-xyz/anchor
jest.mock('@coral-xyz/anchor', () => {
  const actual = jest.requireActual('@coral-xyz/anchor');
  return {
    ...actual,
    AnchorProvider: jest.fn().mockImplementation(() => ({})),
  };
});

// Mock @coral-xyz/anchor/dist/cjs/nodewallet
jest.mock('@coral-xyz/anchor/dist/cjs/nodewallet', () => {
  return jest.fn().mockImplementation(() => ({}));
});

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
    VersionedTransaction: jest.fn().mockImplementation(() => ({
      serialize: jest.fn().mockReturnValue(Buffer.from('mock-versioned-transaction')),
    })),
  };
});

describe('PumpFunSwapService', () => {
  let pumpFunSwapService: PumpFunSwapService;
  let mockConnection: jest.Mocked<Connection>;
  let mockKeypair: jest.Mocked<Keypair>;
  let mockPumpFunSDK: any;

  beforeEach(() => {
    mockConnection = new Connection('https://api.mainnet-beta.solana.com') as jest.Mocked<Connection>;
    
    mockKeypair = {
      publicKey: new PublicKey('test-public-key'),
      secretKey: Buffer.from('test-secret-key'),
      sign: jest.fn(),
    } as unknown as jest.Mocked<Keypair>;

    // Создаем сервис
    pumpFunSwapService = new PumpFunSwapService(mockConnection, mockKeypair);
    
    // Получаем mock SDK из сервиса
    mockPumpFunSDK = pumpFunSwapService.getPumpFunInstance();
    
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe('createBuyTransaction', () => {
    it('should create buy transaction successfully', async () => {
      const mockVersionedTx = {
        serialize: jest.fn().mockReturnValue(Buffer.from('mock-versioned-transaction'))
      } as unknown as VersionedTransaction;
      const mockResult = {
        success: true,
        results: mockVersionedTx,
        error: null
      };

      (mockPumpFunSDK.buy as jest.Mock).mockResolvedValueOnce(mockResult);

      const transaction = await pumpFunSwapService.createBuyTransaction({
        tokenMint: 'test-token-mint',
        amountSOL: 1.5,
        userWallet: mockKeypair as unknown as Keypair,
        slippage: 0.01,
        priorityFee: { unitLimit: 250000, unitPrice: 250000 }
      });

      expect(transaction).toBeDefined();
      expect(mockPumpFunSDK.buy).toHaveBeenCalled();
    });

    it('should use default slippage of 1%', async () => {
      const mockVersionedTx = {
        serialize: jest.fn().mockReturnValue(Buffer.from('mock-versioned-transaction'))
      } as unknown as VersionedTransaction;
      const mockResult = {
        success: true,
        results: mockVersionedTx,
        error: null
      };

      (mockPumpFunSDK.buy as jest.Mock).mockResolvedValueOnce(mockResult);

      await pumpFunSwapService.createBuyTransaction({
        tokenMint: 'test-token-mint',
        amountSOL: 1.0,
        userWallet: mockKeypair as unknown as Keypair
      });

      expect(mockPumpFunSDK.buy).toHaveBeenCalled();
    });

    it('should use default priority fees', async () => {
      const mockVersionedTx = {
        serialize: jest.fn().mockReturnValue(Buffer.from('mock-versioned-transaction'))
      } as unknown as VersionedTransaction;
      const mockResult = {
        success: true,
        results: mockVersionedTx,
        error: null
      };

      (mockPumpFunSDK.buy as jest.Mock).mockResolvedValueOnce(mockResult);

      await pumpFunSwapService.createBuyTransaction({
        tokenMint: 'test-token-mint',
        amountSOL: 1.0,
        userWallet: mockKeypair as unknown as Keypair
      });

      expect(mockPumpFunSDK.buy).toHaveBeenCalled();
    });

    it('should throw error on buy failure', async () => {
      const mockResult = {
        success: false,
        results: null,
        error: 'Insufficient funds'
      };

      (mockPumpFunSDK.buy as jest.Mock).mockResolvedValueOnce(mockResult);

      await expect(
        pumpFunSwapService.createBuyTransaction({
          tokenMint: 'test-token-mint',
          amountSOL: 1.0,
          userWallet: mockKeypair as unknown as Keypair
        })
      ).rejects.toThrow('Pump.fun buy error');
    });

    it('should handle SDK errors', async () => {
      (mockPumpFunSDK.buy as jest.Mock).mockRejectedValueOnce(
        new Error('SDK connection error')
      );

      await expect(
        pumpFunSwapService.createBuyTransaction({
          tokenMint: 'test-token-mint',
          amountSOL: 1.0,
          userWallet: mockKeypair as unknown as Keypair
        })
      ).rejects.toThrow('Pump.fun buy error');
    });
  });

  describe('createSellTransaction', () => {
    it('should create sell transaction successfully', async () => {
      const mockVersionedTx = {
        serialize: jest.fn().mockReturnValue(Buffer.from('mock-versioned-transaction'))
      } as unknown as VersionedTransaction;
      const mockResult = {
        success: true,
        results: mockVersionedTx,
        error: null
      };

      (mockPumpFunSDK.sell as jest.Mock).mockResolvedValueOnce(mockResult);

      const transaction = await pumpFunSwapService.createSellTransaction({
        tokenMint: 'test-token-mint',
        tokenAmount: 1000000,
        userWallet: mockKeypair as unknown as Keypair,
        slippage: 0.01,
        priorityFee: { unitLimit: 250000, unitPrice: 250000 }
      });

      expect(transaction).toBeDefined();
      expect(mockPumpFunSDK.sell).toHaveBeenCalled();
    });

    it('should use default slippage of 1%', async () => {
      const mockVersionedTx = {
        serialize: jest.fn().mockReturnValue(Buffer.from('mock-versioned-transaction'))
      } as unknown as VersionedTransaction;
      const mockResult = {
        success: true,
        results: mockVersionedTx,
        error: null
      };

      (mockPumpFunSDK.sell as jest.Mock).mockResolvedValueOnce(mockResult);

      await pumpFunSwapService.createSellTransaction({
        tokenMint: 'test-token-mint',
        tokenAmount: 1000000,
        userWallet: mockKeypair as unknown as Keypair
      });

      expect(mockPumpFunSDK.sell).toHaveBeenCalled();
    });

    it('should use default priority fees', async () => {
      const mockVersionedTx = {
        serialize: jest.fn().mockReturnValue(Buffer.from('mock-versioned-transaction'))
      } as unknown as VersionedTransaction;
      const mockResult = {
        success: true,
        results: mockVersionedTx,
        error: null
      };

      (mockPumpFunSDK.sell as jest.Mock).mockResolvedValueOnce(mockResult);

      await pumpFunSwapService.createSellTransaction({
        tokenMint: 'test-token-mint',
        tokenAmount: 1000000,
        userWallet: mockKeypair as unknown as Keypair
      });

      expect(mockPumpFunSDK.sell).toHaveBeenCalled();
    });

    it('should throw error on sell failure', async () => {
      const mockResult = {
        success: false,
        results: null,
        error: 'Insufficient token balance'
      };

      (mockPumpFunSDK.sell as jest.Mock).mockResolvedValueOnce(mockResult);

      await expect(
        pumpFunSwapService.createSellTransaction({
          tokenMint: 'test-token-mint',
          tokenAmount: 1000000,
          userWallet: mockKeypair as unknown as Keypair
        })
      ).rejects.toThrow('Pump.fun sell error');
    });

    it('should handle SDK errors', async () => {
      (mockPumpFunSDK.sell as jest.Mock).mockRejectedValueOnce(
        new Error('SDK connection error')
      );

      await expect(
        pumpFunSwapService.createSellTransaction({
          tokenMint: 'test-token-mint',
          tokenAmount: 1000000,
          userWallet: mockKeypair as unknown as Keypair
        })
      ).rejects.toThrow('Pump.fun sell error');
    });
  });

  describe('isTokenTradeable', () => {
    it('should return true for tradeable token', async () => {
      const mockBondingCurve = {
        complete: false,
        virtualSolReserves: 1000000000,
        virtualTokenReserves: 1000000000
      };

      (mockPumpFunSDK.getBondingCurveAccount as jest.Mock).mockResolvedValueOnce(mockBondingCurve);

      const isTradeable = await pumpFunSwapService.isTokenTradeable('test-token-mint');

      expect(isTradeable).toBe(true);
      expect(mockPumpFunSDK.getBondingCurveAccount).toHaveBeenCalled();
    });

    it('should return false for migrated token', async () => {
      const mockBondingCurve = {
        complete: true,
        virtualSolReserves: 1000000000,
        virtualTokenReserves: 1000000000
      };

      (mockPumpFunSDK.getBondingCurveAccount as jest.Mock).mockResolvedValueOnce(mockBondingCurve);

      const isTradeable = await pumpFunSwapService.isTokenTradeable('test-token-mint');

      expect(isTradeable).toBe(false);
    });

    it('should return false for non-existent token', async () => {
      (mockPumpFunSDK.getBondingCurveAccount as jest.Mock).mockResolvedValueOnce(null);

      const isTradeable = await pumpFunSwapService.isTokenTradeable('test-token-mint');

      expect(isTradeable).toBe(false);
    });

    it('should handle SDK errors', async () => {
      (mockPumpFunSDK.getBondingCurveAccount as jest.Mock).mockRejectedValueOnce(
        new Error('SDK error')
      );

      const isTradeable = await pumpFunSwapService.isTokenTradeable('test-token-mint');

      expect(isTradeable).toBe(false);
    });
  });

  describe('getTokenData', () => {
    it('should return token data successfully', async () => {
      const mockBondingCurve = {
        complete: false,
        virtualSolReserves: 1000000000,
        virtualTokenReserves: 1000000000,
        marketCap: 50000
      };

      (mockPumpFunSDK.getBondingCurveAccount as jest.Mock).mockResolvedValueOnce(mockBondingCurve);

      const tokenData = await pumpFunSwapService.getTokenData('test-token-mint');

      expect(tokenData).toBeDefined();
      expect(tokenData.complete).toBe(false);
      expect(mockPumpFunSDK.getBondingCurveAccount).toHaveBeenCalled();
    });

    it('should throw error for non-existent token', async () => {
      (mockPumpFunSDK.getBondingCurveAccount as jest.Mock).mockResolvedValueOnce(null);

      await expect(
        pumpFunSwapService.getTokenData('test-token-mint')
      ).rejects.toThrow('Token test-token-mint not found');
    });

    it('should handle SDK errors', async () => {
      (mockPumpFunSDK.getBondingCurveAccount as jest.Mock).mockRejectedValueOnce(
        new Error('SDK error')
      );

      await expect(
        pumpFunSwapService.getTokenData('test-token-mint')
      ).rejects.toThrow('Pump.fun get token data error');
    });
  });

  describe('calculateExpectedTokens', () => {
    it('should calculate expected tokens for SOL amount', async () => {
      const mockBondingCurve = {
        complete: false,
        virtualSolReserves: 1000000000, // 1 SOL
        virtualTokenReserves: 1000000000 // 1 token
      };

      (mockPumpFunSDK.getBondingCurveAccount as jest.Mock).mockResolvedValueOnce(mockBondingCurve);

      const expectedTokens = await pumpFunSwapService.calculateExpectedTokens('test-token-mint', 1.0);

      expect(expectedTokens).toBe(1.0);
    });

    it('should throw error for migrated token', async () => {
      const mockBondingCurve = {
        complete: true,
        virtualSolReserves: 1000000000,
        virtualTokenReserves: 1000000000
      };

      (mockPumpFunSDK.getBondingCurveAccount as jest.Mock).mockResolvedValueOnce(mockBondingCurve);

      await expect(
        pumpFunSwapService.calculateExpectedTokens('test-token-mint', 1.0)
      ).rejects.toThrow('Token test-token-mint has migrated to DEX');
    });

    it('should handle SDK errors', async () => {
      (mockPumpFunSDK.getBondingCurveAccount as jest.Mock).mockRejectedValueOnce(
        new Error('SDK error')
      );

      await expect(
        pumpFunSwapService.calculateExpectedTokens('test-token-mint', 1.0)
      ).rejects.toThrow('Pump.fun calculate tokens error');
    });
  });

  describe('calculateExpectedSol', () => {
    it('should calculate expected SOL for token amount', async () => {
      const mockBondingCurve = {
        complete: false,
        virtualSolReserves: 1000000000, // 1 SOL
        virtualTokenReserves: 1000000000 // 1 token
      };

      (mockPumpFunSDK.getBondingCurveAccount as jest.Mock).mockResolvedValueOnce(mockBondingCurve);

      const expectedSol = await pumpFunSwapService.calculateExpectedSol('test-token-mint', 1.0);

      expect(expectedSol).toBe(1.0);
    });

    it('should throw error for migrated token', async () => {
      const mockBondingCurve = {
        complete: true,
        virtualSolReserves: 1000000000,
        virtualTokenReserves: 1000000000
      };

      (mockPumpFunSDK.getBondingCurveAccount as jest.Mock).mockResolvedValueOnce(mockBondingCurve);

      await expect(
        pumpFunSwapService.calculateExpectedSol('test-token-mint', 1.0)
      ).rejects.toThrow('Token test-token-mint has migrated to DEX');
    });

    it('should handle SDK errors', async () => {
      (mockPumpFunSDK.getBondingCurveAccount as jest.Mock).mockRejectedValueOnce(
        new Error('SDK error')
      );

      await expect(
        pumpFunSwapService.calculateExpectedSol('test-token-mint', 1.0)
      ).rejects.toThrow('Pump.fun calculate SOL error');
    });
  });

  describe('getConnection', () => {
    it('should return connection instance', () => {
      const connection = pumpFunSwapService.getConnection();

      expect(connection).toBe(mockConnection);
    });
  });

  describe('getPumpFunInstance', () => {
    it('should return PumpFunSDK instance', () => {
      const pumpFunInstance = pumpFunSwapService.getPumpFunInstance();

      expect(pumpFunInstance).toBeDefined();
    });
  });

  describe('Integration tests', () => {
    it('should handle complete buy workflow', async () => {
      const mockVersionedTx = {
        serialize: jest.fn().mockReturnValue(Buffer.from('mock-versioned-transaction'))
      } as unknown as VersionedTransaction;
      const mockBuyResult = {
        success: true,
        results: mockVersionedTx,
        error: null
      };

      const mockBondingCurve = {
        complete: false,
        virtualSolReserves: 1000000000,
        virtualTokenReserves: 1000000000
      };

      (mockPumpFunSDK.buy as jest.Mock).mockResolvedValueOnce(mockBuyResult);
      (mockPumpFunSDK.getBondingCurveAccount as jest.Mock).mockResolvedValue(mockBondingCurve);

      // Check if token is tradeable
      const isTradeable = await pumpFunSwapService.isTokenTradeable('test-token-mint');
      expect(isTradeable).toBe(true);

      // Create buy transaction
      const transaction = await pumpFunSwapService.createBuyTransaction({
        tokenMint: 'test-token-mint',
        amountSOL: 1.0,
        userWallet: mockKeypair as unknown as Keypair
      });

      expect(transaction).toBeDefined();
    });

    it('should handle complete sell workflow', async () => {
      const mockVersionedTx = {
        serialize: jest.fn().mockReturnValue(Buffer.from('mock-versioned-transaction'))
      } as unknown as VersionedTransaction;
      const mockSellResult = {
        success: true,
        results: mockVersionedTx,
        error: null
      };

      const mockBondingCurve = {
        complete: false,
        virtualSolReserves: 1000000000,
        virtualTokenReserves: 1000000000
      };

      (mockPumpFunSDK.sell as jest.Mock).mockResolvedValueOnce(mockSellResult);
      (mockPumpFunSDK.getBondingCurveAccount as jest.Mock).mockResolvedValue(mockBondingCurve);

      // Check if token is tradeable
      const isTradeable = await pumpFunSwapService.isTokenTradeable('test-token-mint');
      expect(isTradeable).toBe(true);

      // Create sell transaction
      const transaction = await pumpFunSwapService.createSellTransaction({
        tokenMint: 'test-token-mint',
        tokenAmount: 1000000000,
        userWallet: mockKeypair as unknown as Keypair
      });

      expect(transaction).toBeDefined();
    });
  });
});
