import { JupiterSwapService } from '../../src/services/JupiterSwapService';
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

// Mock global fetch
global.fetch = jest.fn();

describe('JupiterSwapService', () => {
  let jupiterSwapService: JupiterSwapService;
  let mockConnection: jest.Mocked<Connection>;
  let mockKeypair: jest.Mocked<Keypair>;

  beforeEach(() => {
    mockConnection = new Connection('https://api.mainnet-beta.solana.com') as jest.Mocked<Connection>;
    jupiterSwapService = new JupiterSwapService(mockConnection);
    
    mockKeypair = {
      publicKey: new PublicKey('test-public-key'),
      secretKey: Buffer.from('test-secret-key'),
      sign: jest.fn(),
    } as unknown as jest.Mocked<Keypair>;
    
    jest.clearAllMocks();
  });

  describe('getQuote', () => {
    it('should fetch quote for swap', async () => {
      const mockQuoteResponse = {
        inputMint: 'input-mint',
        inAmount: '1000000000',
        outputMint: 'output-mint',
        outAmount: '50000000',
        otherAmountThreshold: '49500000',
        swapMode: 'ExactIn',
        slippageBps: 100,
        platformFee: null,
        priceImpactPct: '0.5',
        routePlan: [
          {
            swapInfo: 'Raydium',
            percent: 100,
            label: 'Raydium'
          }
        ],
        contextSlot: 123456789,
        timeTaken: 100
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockQuoteResponse
      } as Response);

      const quote = await jupiterSwapService.getQuote({
        inputMint: 'input-mint',
        outputMint: 'output-mint',
        amount: 1000000000
      });

      expect(quote.inAmount).toBe('1000000000');
      expect(quote.outAmount).toBe('50000000');
      expect(quote.slippageBps).toBe(100);
      expect(quote.priceImpactPct).toBe('0.5');
      expect(quote.routePlan).toHaveLength(1);
    });

    it('should use default slippage of 1%', async () => {
      const mockQuoteResponse = {
        inputMint: 'input-mint',
        inAmount: '1000000000',
        outputMint: 'output-mint',
        outAmount: '50000000',
        otherAmountThreshold: '49500000',
        swapMode: 'ExactIn',
        slippageBps: 100,
        platformFee: null,
        priceImpactPct: '0.5',
        routePlan: [],
        contextSlot: 123456789,
        timeTaken: 100
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockQuoteResponse
      } as Response);

      await jupiterSwapService.getQuote({
        inputMint: 'input-mint',
        outputMint: 'output-mint',
        amount: 1000000000
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('slippageBps=100')
      );
    });

    it('should use custom slippage', async () => {
      const mockQuoteResponse = {
        inputMint: 'input-mint',
        inAmount: '1000000000',
        outputMint: 'output-mint',
        outAmount: '50000000',
        otherAmountThreshold: '49500000',
        swapMode: 'ExactIn',
        slippageBps: 200,
        platformFee: null,
        priceImpactPct: '0.5',
        routePlan: [],
        contextSlot: 123456789,
        timeTaken: 100
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockQuoteResponse
      } as Response);

      await jupiterSwapService.getQuote({
        inputMint: 'input-mint',
        outputMint: 'output-mint',
        amount: 1000000000,
        slippageBps: 200
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('slippageBps=200')
      );
    });

    it('should throw error on API failure', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      } as Response);

      await expect(jupiterSwapService.getQuote({
        inputMint: 'input-mint',
        outputMint: 'output-mint',
        amount: 1000000000
      })).rejects.toThrow('Jupiter quote API error: 500 Internal Server Error');
    });

    it('should throw error on network failure', async () => {
      (global.fetch as jest.MockedFunction<typeof fetch>).mockRejectedValueOnce(
        new Error('Network error')
      );

      await expect(jupiterSwapService.getQuote({
        inputMint: 'input-mint',
        outputMint: 'output-mint',
        amount: 1000000000
      })).rejects.toThrow('Jupiter quote error: Error: Network error');
    });
  });

  describe('buildSwapTransaction', () => {
    it('should build swap transaction', async () => {
      const mockQuoteResponse = {
        inputMint: 'input-mint',
        inAmount: '1000000000',
        outputMint: 'output-mint',
        outAmount: '50000000',
        otherAmountThreshold: '49500000',
        swapMode: 'ExactIn',
        slippageBps: 100,
        platformFee: null,
        priceImpactPct: '0.5',
        routePlan: [],
        contextSlot: 123456789,
        timeTaken: 100
      };

      const mockSwapResponse = {
        swapTransaction: 'base64-encoded-transaction',
        lastValidBlockHeight: 123456789,
        prioritizationFeeLamports: 1000,
        computeUnitLimit: 200000
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSwapResponse
      } as Response);

      const { transaction, swapResponse } = await jupiterSwapService.buildSwapTransaction({
        quoteResponse: mockQuoteResponse,
        userPublicKey: mockKeypair.publicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: 1000
      });

      expect(transaction).toBeDefined();
      expect(swapResponse.prioritizationFeeLamports).toBe(1000);
      expect(swapResponse.computeUnitLimit).toBe(200000);
    });

    it('should use default options', async () => {
      const mockQuoteResponse = {
        inputMint: 'input-mint',
        inAmount: '1000000000',
        outputMint: 'output-mint',
        outAmount: '50000000',
        otherAmountThreshold: '49500000',
        swapMode: 'ExactIn',
        slippageBps: 100,
        platformFee: null,
        priceImpactPct: '0.5',
        routePlan: [],
        contextSlot: 123456789,
        timeTaken: 100
      };

      const mockSwapResponse = {
        swapTransaction: 'base64-encoded-transaction',
        lastValidBlockHeight: 123456789,
        prioritizationFeeLamports: 0,
        computeUnitLimit: 200000
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSwapResponse
      } as Response);

      await jupiterSwapService.buildSwapTransaction({
        quoteResponse: mockQuoteResponse,
        userPublicKey: mockKeypair.publicKey
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://lite-api.jup.ag/swap/v6',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          }
        })
      );
    });

    it('should throw error on API failure', async () => {
      const mockQuoteResponse = {
        inputMint: 'input-mint',
        inAmount: '1000000000',
        outputMint: 'output-mint',
        outAmount: '50000000',
        otherAmountThreshold: '49500000',
        swapMode: 'ExactIn',
        slippageBps: 100,
        platformFee: null,
        priceImpactPct: '0.5',
        routePlan: [],
        contextSlot: 123456789,
        timeTaken: 100
      };

      (global.fetch as jest.MockedFunction<typeof fetch>).mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      } as Response);

      await expect(jupiterSwapService.buildSwapTransaction({
        quoteResponse: mockQuoteResponse,
        userPublicKey: mockKeypair.publicKey
      })).rejects.toThrow('Jupiter swap API error: 500 Internal Server Error');
    });
  });

  describe('createSwapTransaction', () => {
    it('should create complete swap transaction', async () => {
      const mockQuoteResponse = {
        inputMint: 'input-mint',
        inAmount: '1000000000',
        outputMint: 'output-mint',
        outAmount: '50000000',
        otherAmountThreshold: '49500000',
        swapMode: 'ExactIn',
        slippageBps: 100,
        platformFee: null,
        priceImpactPct: '0.5',
        routePlan: [],
        contextSlot: 123456789,
        timeTaken: 100
      };

      const mockSwapResponse = {
        swapTransaction: 'base64-encoded-transaction',
        lastValidBlockHeight: 123456789,
        prioritizationFeeLamports: 1000,
        computeUnitLimit: 200000
      };

      (global.fetch as jest.MockedFunction<typeof fetch>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockQuoteResponse
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockSwapResponse
        } as Response);

      const transaction = await jupiterSwapService.createSwapTransaction({
        inputMint: 'input-mint',
        outputMint: 'output-mint',
        amount: 1000000000,
        userWallet: mockKeypair as unknown as Keypair,
        slippage: 0.01,
        priorityFeeLamports: 1000
      });

      expect(transaction).toBeDefined();
      // Проверяем, что транзакция была создана через Transaction.from
      expect(Transaction.from).toHaveBeenCalled();
    });

    it('should use default slippage of 1%', async () => {
      const mockQuoteResponse = {
        inputMint: 'input-mint',
        inAmount: '1000000000',
        outputMint: 'output-mint',
        outAmount: '50000000',
        otherAmountThreshold: '49500000',
        swapMode: 'ExactIn',
        slippageBps: 100,
        platformFee: null,
        priceImpactPct: '0.5',
        routePlan: [],
        contextSlot: 123456789,
        timeTaken: 100
      };

      const mockSwapResponse = {
        swapTransaction: 'base64-encoded-transaction',
        lastValidBlockHeight: 123456789,
        prioritizationFeeLamports: 0,
        computeUnitLimit: 200000
      };

      (global.fetch as jest.MockedFunction<typeof fetch>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockQuoteResponse
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockSwapResponse
        } as Response);

      await jupiterSwapService.createSwapTransaction({
        inputMint: 'input-mint',
        outputMint: 'output-mint',
        amount: 1000000000,
        userWallet: mockKeypair as unknown as Keypair
      });

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('slippageBps=100')
      );
    });

    it('should use custom priority fee', async () => {
      const mockQuoteResponse = {
        inputMint: 'input-mint',
        inAmount: '1000000000',
        outputMint: 'output-mint',
        outAmount: '50000000',
        otherAmountThreshold: '49500000',
        swapMode: 'ExactIn',
        slippageBps: 100,
        platformFee: null,
        priceImpactPct: '0.5',
        routePlan: [],
        contextSlot: 123456789,
        timeTaken: 100
      };

      const mockSwapResponse = {
        swapTransaction: 'base64-encoded-transaction',
        lastValidBlockHeight: 123456789,
        prioritizationFeeLamports: 5000,
        computeUnitLimit: 200000
      };

      (global.fetch as jest.MockedFunction<typeof fetch>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockQuoteResponse
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockSwapResponse
        } as Response);

      await jupiterSwapService.createSwapTransaction({
        inputMint: 'input-mint',
        outputMint: 'output-mint',
        amount: 1000000000,
        userWallet: mockKeypair as unknown as Keypair,
        priorityFeeLamports: 5000
      });

      expect(global.fetch).toHaveBeenCalledWith(
        'https://lite-api.jup.ag/swap/v6',
        expect.objectContaining({
          body: expect.stringContaining('5000')
        })
      );
    });
  });

  describe('getMinimumAmountOut', () => {
    it('should calculate minimum amount with slippage', () => {
      const expectedAmount = 1000000;
      const slippage = 0.01; // 1%

      const minimumAmount = jupiterSwapService.getMinimumAmountOut(expectedAmount, slippage);

      expect(minimumAmount).toBe(990000); // 1000000 * (1 - 0.01) = 990000
    });

    it('should handle zero slippage', () => {
      const expectedAmount = 1000000;
      const slippage = 0;

      const minimumAmount = jupiterSwapService.getMinimumAmountOut(expectedAmount, slippage);

      expect(minimumAmount).toBe(1000000); // No slippage
    });

    it('should handle high slippage', () => {
      const expectedAmount = 1000000;
      const slippage = 0.1; // 10%

      const minimumAmount = jupiterSwapService.getMinimumAmountOut(expectedAmount, slippage);

      expect(minimumAmount).toBe(900000); // 1000000 * (1 - 0.1) = 900000
    });
  });

  describe('calculateSlippageBps', () => {
    it('should calculate slippage in basis points', () => {
      const slippagePercent = 1; // 1%

      const bps = jupiterSwapService.calculateSlippageBps(slippagePercent);

      expect(bps).toBe(100); // 1 * 100 = 100 bps
    });

    it('should handle fractional percentages', () => {
      const slippagePercent = 0.5; // 0.5%

      const bps = jupiterSwapService.calculateSlippageBps(slippagePercent);

      expect(bps).toBe(50); // 0.5 * 100 = 50 bps
    });

    it('should handle zero slippage', () => {
      const slippagePercent = 0;

      const bps = jupiterSwapService.calculateSlippageBps(slippagePercent);

      expect(bps).toBe(0);
    });
  });

  describe('getRouteInfo', () => {
    it('should extract route information', () => {
      const mockQuoteResponse = {
        inputMint: 'input-mint',
        inAmount: '1000000000',
        outputMint: 'output-mint',
        outAmount: '50000000',
        otherAmountThreshold: '49500000',
        swapMode: 'ExactIn',
        slippageBps: 100,
        platformFee: null,
        priceImpactPct: '0.5',
        routePlan: [
          {
            swapInfo: 'Raydium',
            percent: 100,
            label: 'Raydium'
          },
          {
            swapInfo: 'Jupiter',
            percent: 0,
            label: 'Jupiter'
          }
        ],
        contextSlot: 123456789,
        timeTaken: 100
      };

      const routeInfo = jupiterSwapService.getRouteInfo(mockQuoteResponse);

      expect(routeInfo.routePlanLength).toBe(2);
      expect(routeInfo.priceImpactPct).toBe('0.5');
      expect(routeInfo.contextSlot).toBe(123456789);
      expect(routeInfo.timeTaken).toBe(100);
    });

    it('should handle empty route plan', () => {
      const mockQuoteResponse = {
        inputMint: 'input-mint',
        inAmount: '1000000000',
        outputMint: 'output-mint',
        outAmount: '50000000',
        otherAmountThreshold: '49500000',
        swapMode: 'ExactIn',
        slippageBps: 100,
        platformFee: null,
        priceImpactPct: '0.5',
        routePlan: [],
        contextSlot: 123456789,
        timeTaken: 100
      };

      const routeInfo = jupiterSwapService.getRouteInfo(mockQuoteResponse);

      expect(routeInfo.routePlanLength).toBe(0);
    });
  });

  describe('isQuoteValid', () => {
    it('should return true for valid quote', () => {
      const validQuote = {
        inputMint: 'input-mint',
        inAmount: '1000000000',
        outputMint: 'output-mint',
        outAmount: '50000000',
        otherAmountThreshold: '49500000',
        swapMode: 'ExactIn',
        slippageBps: 100,
        platformFee: null,
        priceImpactPct: '0.5',
        routePlan: [
          {
            swapInfo: 'Raydium',
            percent: 100,
            label: 'Raydium'
          }
        ],
        contextSlot: 123456789,
        timeTaken: 100
      };

      const isValid = jupiterSwapService.isQuoteValid(validQuote);

      expect(isValid).toBe(true);
    });

    it('should return false for zero input amount', () => {
      const invalidQuote = {
        inputMint: 'input-mint',
        inAmount: '0',
        outputMint: 'output-mint',
        outAmount: '50000000',
        otherAmountThreshold: '49500000',
        swapMode: 'ExactIn',
        slippageBps: 100,
        platformFee: null,
        priceImpactPct: '0.5',
        routePlan: [],
        contextSlot: 123456789,
        timeTaken: 100
      };

      const isValid = jupiterSwapService.isQuoteValid(invalidQuote);

      expect(isValid).toBe(false);
    });

    it('should return false for zero output amount', () => {
      const invalidQuote = {
        inputMint: 'input-mint',
        inAmount: '1000000000',
        outputMint: 'output-mint',
        outAmount: '0',
        otherAmountThreshold: '49500000',
        swapMode: 'ExactIn',
        slippageBps: 100,
        platformFee: null,
        priceImpactPct: '0.5',
        routePlan: [],
        contextSlot: 123456789,
        timeTaken: 100
      };

      const isValid = jupiterSwapService.isQuoteValid(invalidQuote);

      expect(isValid).toBe(false);
    });

    it('should return false for empty route plan', () => {
      const invalidQuote = {
        inputMint: 'input-mint',
        inAmount: '1000000000',
        outputMint: 'output-mint',
        outAmount: '50000000',
        otherAmountThreshold: '49500000',
        swapMode: 'ExactIn',
        slippageBps: 100,
        platformFee: null,
        priceImpactPct: '0.5',
        routePlan: [],
        contextSlot: 123456789,
        timeTaken: 100
      };

      const isValid = jupiterSwapService.isQuoteValid(invalidQuote);

      expect(isValid).toBe(false);
    });
  });

  describe('getConnection', () => {
    it('should return connection instance', () => {
      const connection = jupiterSwapService.getConnection();

      expect(connection).toBe(mockConnection);
    });

    it('should return same instance on multiple calls', () => {
      const connection1 = jupiterSwapService.getConnection();
      const connection2 = jupiterSwapService.getConnection();

      expect(connection1).toBe(connection2);
    });
  });

  describe('Integration tests', () => {
    it('should handle complete swap workflow', async () => {
      const mockQuoteResponse = {
        inputMint: 'input-mint',
        inAmount: '1000000000',
        outputMint: 'output-mint',
        outAmount: '50000000',
        otherAmountThreshold: '49500000',
        swapMode: 'ExactIn',
        slippageBps: 100,
        platformFee: null,
        priceImpactPct: '0.5',
        routePlan: [
          {
            swapInfo: 'Raydium',
            percent: 100,
            label: 'Raydium'
          }
        ],
        contextSlot: 123456789,
        timeTaken: 100
      };

      const mockSwapResponse = {
        swapTransaction: 'base64-encoded-transaction',
        lastValidBlockHeight: 123456789,
        prioritizationFeeLamports: 1000,
        computeUnitLimit: 200000
      };

      (global.fetch as jest.MockedFunction<typeof fetch>)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockQuoteResponse
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockSwapResponse
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockQuoteResponse
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockSwapResponse
        } as Response);

      // Get quote
      const quote = await jupiterSwapService.getQuote({
        inputMint: 'input-mint',
        outputMint: 'output-mint',
        amount: 1000000000
      });

      expect(quote.inAmount).toBe('1000000000');
      expect(quote.outAmount).toBe('50000000');

      // Check if quote is valid
      const isValid = jupiterSwapService.isQuoteValid(quote);
      expect(isValid).toBe(true);

      // Get route info
      const routeInfo = jupiterSwapService.getRouteInfo(quote);
      expect(routeInfo.routePlanLength).toBe(1);

      // Build transaction
      const { transaction } = await jupiterSwapService.buildSwapTransaction({
        quoteResponse: quote,
        userPublicKey: mockKeypair.publicKey
      });

      expect(transaction).toBeDefined();

      // Create complete swap transaction
      const swapTransaction = await jupiterSwapService.createSwapTransaction({
        inputMint: 'input-mint',
        outputMint: 'output-mint',
        amount: 1000000000,
        userWallet: mockKeypair as unknown as Keypair
      });

      expect(swapTransaction).toBeDefined();
      // Проверяем, что транзакция была создана через Transaction.from
      expect(Transaction.from).toHaveBeenCalled();
    });

    it('should handle slippage calculation', async () => {
      const expectedAmount = 1000000;
      const slippagePercent = 0.05; // 5%

      const bps = jupiterSwapService.calculateSlippageBps(slippagePercent);
      expect(bps).toBe(5); // 0.05 * 100 = 5 bps

      const minimumAmount = jupiterSwapService.getMinimumAmountOut(expectedAmount, slippagePercent);
      expect(minimumAmount).toBe(950000); // 1000000 * (1 - 0.05) = 950000
    });
  });
});
