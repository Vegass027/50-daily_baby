import { OrderExecutor, ExecutionResult } from '../../src/trading/managers/OrderExecutor';
import { LimitOrder, OrderType, OrderStatus } from '../../src/trading/managers/ILimitOrderManager';
import { JupiterStrategy } from '../../src/trading/strategies/solana/JupiterStrategy';
import { PumpFunStrategy } from '../../src/trading/strategies/solana/PumpFunStrategy';
import { ITransactionSubmitter, SimulationResult } from '../../src/interfaces/ITransactionSubmitter';
import { Keypair, Connection, Transaction, SystemProgram, PublicKey } from '@solana/web3.js';
import { UserSettings } from '../../src/trading/router/ITradingStrategy';

// Mock implementations
class MockJupiterStrategy {
  async getQuote(params: any): Promise<any> {
    return {
      inputAmount: params.amount,
      outputAmount: params.amount * 1000000,
      priceImpact: 0.5,
      fee: 1000,
      route: 'Jupiter Aggregator'
    };
  }

  async executeSwap(params: any, settings: UserSettings): Promise<string> {
    return 'mock-signature-123';
  }

  async buildTransaction(params: any): Promise<Transaction> {
    const tx = new Transaction();
    if ((this as any).wallet) {
      tx.feePayer = (this as any).wallet.publicKey;
      // Use a valid base58 blockhash (44 characters)
      tx.recentBlockhash = (this as any).validBlockhash || '11111111111111111111111111111111111111111111';
      
      // Add a dummy instruction to make the transaction valid
      // In real implementation, this would be Jupiter swap instructions
      const dummyInstruction = SystemProgram.transfer({
        fromPubkey: (this as any).wallet.publicKey,
        toPubkey: (this as any).wallet.publicKey, // Transfer to self (no-op)
        lamports: 0
      });
      tx.add(dummyInstruction);
      
      // Don't sign here - OrderExecutor will sign the transaction
    }
    return tx;
  }
}

class MockPumpFunStrategy {
  async getQuote(params: any): Promise<any> {
    return {
      inputAmount: params.amount,
      outputAmount: params.amount * 1000000,
      priceImpact: 0.5,
      fee: 1000,
      route: 'PumpFun Bonding Curve'
    };
  }

  async buildTransaction(params: any): Promise<Transaction> {
    const tx = new Transaction();
    if ((this as any).wallet) {
      tx.feePayer = (this as any).wallet.publicKey;
      // Use a valid base58 blockhash (44 characters)
      tx.recentBlockhash = (this as any).validBlockhash || '11111111111111111111111111111111111111111111';
      
      // Add a dummy instruction to make the transaction valid
      // In real implementation, this would be PumpFun swap instructions
      const dummyInstruction = SystemProgram.transfer({
        fromPubkey: (this as any).wallet.publicKey,
        toPubkey: (this as any).wallet.publicKey, // Transfer to self (no-op)
        lamports: 0
      });
      tx.add(dummyInstruction);
      
      // Don't sign here - OrderExecutor will sign the transaction
    }
    return tx;
  }

  async executeSwap(params: any, settings: UserSettings): Promise<string> {
    return 'mock-signature-456';
  }
}

class MockTransactionSubmitter implements ITransactionSubmitter {
  private confirmResult: boolean = true;
  private simulateResult: SimulationResult = { success: true };
  private mockConnection: any;

  constructor() {
    this.mockConnection = {
      getParsedTransaction: jest.fn().mockResolvedValue({
        meta: {
          postTokenBalances: [
            {
              mint: 'So11111111111111111111111111111111111111112',
              uiTokenAmount: { uiAmount: 1000000 }
            }
          ],
          preTokenBalances: [
            {
              mint: 'So11111111111111111111111111111111111111112',
              uiTokenAmount: { uiAmount: 0 }
            }
          ]
        }
      }),
      sendRawTransaction: jest.fn().mockResolvedValue('mock-tx-signature'),
      confirmTransaction: jest.fn().mockResolvedValue({ value: { err: null } }),
      simulateTransaction: jest.fn().mockResolvedValue({ value: { err: null, logs: [] } })
    };
  }

  async sendTransaction(transaction: Transaction, options?: any): Promise<string> {
    return 'mock-tx-signature';
  }

  async confirmTransaction(signature: string, commitment?: any, timeoutMs?: number): Promise<boolean> {
    return this.confirmResult;
  }

  async simulateTransaction(transaction: Transaction): Promise<SimulationResult> {
    return this.simulateResult;
  }

  getConnection(): Connection {
    return this.mockConnection as any;
  }

  setConfirmResult(result: boolean): void {
    this.confirmResult = result;
  }

  setSimulateResult(result: SimulationResult): void {
    this.simulateResult = result;
  }

  setMockTransactionData(mint: string, postAmount: number, preAmount: number): void {
    this.mockConnection.getParsedTransaction = jest.fn().mockResolvedValue({
      meta: {
        postTokenBalances: [
          {
            mint,
            uiTokenAmount: { uiAmount: postAmount }
          }
        ],
        preTokenBalances: [
          {
            mint,
            uiTokenAmount: { uiAmount: preAmount }
          }
        ]
      }
    });
  }

  setConfirmTransactionResult(result: { value: { err: any } }): void {
    this.mockConnection.confirmTransaction = jest.fn().mockResolvedValue(result);
  }
}

// Helper функция для создания тестовых ордеров
function createTestOrder(overrides: Partial<LimitOrder> = {}): LimitOrder {
  return {
    id: 'test-order',
    params: {
      userId: 1,
      tokenMint: 'So11111111111111111111111111111111111112',
      orderType: OrderType.BUY,
      amount: 1_000_000_000,
      price: 0.00001,
      slippage: 0.01,
      ...overrides.params
    },
    status: OrderStatus.PENDING,
    createdAt: Date.now(),
    currentPrice: 0.000009,
    tokenType: 'DEX_POOL',
    ...overrides
  };
}

describe('OrderExecutor', () => {
  let jupiterStrategy: any;
  let pumpFunStrategy: any;
  let transactionSubmitter: MockTransactionSubmitter;
  let wallet: Keypair;
  let userSettings: UserSettings;
  let orderExecutor: OrderExecutor;
  let validBlockhash: string;

  beforeEach(() => {
    wallet = Keypair.generate();
    // Generate a valid base58 blockhash (44 characters = 32 bytes in base58)
    validBlockhash = Keypair.generate().publicKey.toBase58();
    
    jupiterStrategy = new MockJupiterStrategy() as any;
    pumpFunStrategy = new MockPumpFunStrategy() as any;
    transactionSubmitter = new MockTransactionSubmitter();
    
    // Assign the correct wallet from the test scope to the mock strategies
    jupiterStrategy.wallet = wallet;
    pumpFunStrategy.wallet = wallet;
    jupiterStrategy.validBlockhash = validBlockhash;
    pumpFunStrategy.validBlockhash = validBlockhash;
    
    userSettings = {
      slippage: 0.01,
      mevProtection: false,
      speedStrategy: 'normal',
      priorityFee: 1000
    };

    orderExecutor = new OrderExecutor(
      jupiterStrategy,
      pumpFunStrategy,
      transactionSubmitter,
      wallet,
      userSettings
    );
  });

  describe('executeOrder', () => {
    it('should execute DEX_POOL order successfully', async () => {
      const order = createTestOrder({
        id: 'test-order-1'
      });

      // Setup mock transaction data
      transactionSubmitter.setMockTransactionData(
        'So11111111111111111111111111111111111112',
        1000000,
        0
      );

      const result = await orderExecutor.executeOrder(order, 'DEX_POOL');

      expect(result.success).toBe(true);
      expect(result.signature).toBeDefined();
      expect(result.filledPrice).toBeDefined();
      expect(result.receivedAmount).toBeDefined();
    });

    it('should execute BONDING_CURVE order successfully', async () => {
      const order: LimitOrder = {
        id: 'test-order-2',
        params: {
          userId: 1,
          tokenMint: 'So11111111111111111111111111111111111112',
          orderType: OrderType.BUY,
          amount: 1_000_000_000,
          price: 0.00001,
          slippage: 0.01
        },
        status: OrderStatus.PENDING,
        createdAt: Date.now(),
        currentPrice: 0.000009,
        tokenType: 'BONDING_CURVE'
      };

      // Setup mock transaction data
      transactionSubmitter.setMockTransactionData(
        'So11111111111111111111111111111111111112',
        1000000,
        0
      );

      const result = await orderExecutor.executeOrder(order, 'BONDING_CURVE');

      expect(result.success).toBe(true);
      expect(result.signature).toBeDefined();
    });

    it('should fail if price validation fails', async () => {
      const order: LimitOrder = {
        id: 'test-order-3',
        params: {
          userId: 1,
          tokenMint: 'So11111111111111111111111111111111111112',
          orderType: OrderType.BUY,
          amount: 1_000_000_000,
          price: 0.00001,
          slippage: 0.01
        },
        status: OrderStatus.PENDING,
        createdAt: Date.now(),
        currentPrice: 0.00002, // Price moved away
        tokenType: 'DEX_POOL'
      };

      const result = await orderExecutor.executeOrder(order, 'DEX_POOL');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Price moved away');
    });

    it('should fail if transaction confirmation times out', async () => {
      // Mock confirmation failure
      transactionSubmitter.setConfirmTransactionResult({
        value: { err: { message: 'Transaction confirmation timeout' } }
      });

      const order: LimitOrder = {
        id: 'test-order-4',
        params: {
          userId: 1,
          tokenMint: 'So11111111111111111111111111111111111111112',
          orderType: OrderType.BUY,
          amount: 1_000_000_000,
          price: 0.00001,
          slippage: 0.01
        },
        status: OrderStatus.PENDING,
        createdAt: Date.now(),
        currentPrice: 0.000009,
        tokenType: 'DEX_POOL'
      };

      // Setup mock transaction data
      transactionSubmitter.setMockTransactionData(
        'So11111111111111111111111111111111111111112',
        1000000,
        0
      );

      const result = await orderExecutor.executeOrder(order, 'DEX_POOL');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Transaction confirmation timeout');
    });

    it('should fail if price impact is too high', async () => {
      // Mock high price impact
      jest.spyOn(jupiterStrategy, 'getQuote').mockResolvedValue({
        inputAmount: 1_000_000_000,
        outputAmount: 500_000_000,
        priceImpact: 15, // Too high
        fee: 1000,
        route: 'Jupiter Aggregator'
      });

      const order: LimitOrder = {
        id: 'test-order-5',
        params: {
          userId: 1,
          tokenMint: 'So11111111111111111111111111111111111112',
          orderType: OrderType.BUY,
          amount: 1_000_000_000,
          price: 0.00001,
          slippage: 0.01
        },
        status: OrderStatus.PENDING,
        createdAt: Date.now(),
        currentPrice: 0.000009,
        tokenType: 'DEX_POOL'
      };

      const result = await orderExecutor.executeOrder(order, 'DEX_POOL');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Price impact too high');
    });
  });

  describe('simulateExecution', () => {
    it('should simulate DEX_POOL order successfully', async () => {
      const order: LimitOrder = {
        id: 'test-order-6',
        params: {
          userId: 1,
          tokenMint: 'So11111111111111111111111111111111111112',
          orderType: OrderType.BUY,
          amount: 1_000_000_000,
          price: 0.00001,
          slippage: 0.01
        },
        status: OrderStatus.PENDING,
        createdAt: Date.now(),
        tokenType: 'DEX_POOL'
      };

      const result = await orderExecutor.simulateExecution(order, 'DEX_POOL');

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should simulate BONDING_CURVE order successfully', async () => {
      const order: LimitOrder = {
        id: 'test-order-7',
        params: {
          userId: 1,
          tokenMint: 'So11111111111111111111111111111111111112',
          orderType: OrderType.BUY,
          amount: 1_000_000_000,
          price: 0.00001,
          slippage: 0.01
        },
        status: OrderStatus.PENDING,
        createdAt: Date.now(),
        tokenType: 'BONDING_CURVE'
      };

      const result = await orderExecutor.simulateExecution(order, 'BONDING_CURVE');

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should fail simulation if price impact is too high', async () => {
      // Mock high price impact
      jest.spyOn(jupiterStrategy, 'getQuote').mockResolvedValue({
        inputAmount: 1_000_000_000,
        outputAmount: 500_000_000,
        priceImpact: 15, // Too high
        fee: 1000,
        route: 'Jupiter Aggregator'
      });

      const order: LimitOrder = {
        id: 'test-order-8',
        params: {
          userId: 1,
          tokenMint: 'So11111111111111111111111111111111111112',
          orderType: OrderType.BUY,
          amount: 1_000_000_000,
          price: 0.00001,
          slippage: 0.01
        },
        status: OrderStatus.PENDING,
        createdAt: Date.now(),
        tokenType: 'DEX_POOL'
      };

      const result = await orderExecutor.simulateExecution(order, 'DEX_POOL');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Price impact too high');
    });
  
    describe('MEV защита', () => {
      it('должен рассчитывать Jito tip при включенной MEV защите', async () => {
        userSettings.mevProtection = true;
        userSettings.jitoTipMultiplier = 1.5;
  
        const order = createTestOrder({
          id: 'test-mev-order',
          params: {
            amount: 1_000_000_000,
            userId: 1,
            tokenMint: 'So11111111111111111111111111111111111112',
            orderType: OrderType.BUY,
            price: 0.00001,
            slippage: 0.01
          },
          tokenType: 'BONDING_CURVE'
        });
  
        transactionSubmitter.setMockTransactionData('So11111111111111111111111111111111111112', 1000000, 0);
  
        const result = await orderExecutor.executeOrder(order, 'BONDING_CURVE');
  
        expect(result.success).toBe(true);
        expect(result.jitoTip).toBeGreaterThan(0);
      });
  
      it('не должен рассчитывать tip при выключенной MEV защите', async () => {
        userSettings.mevProtection = false;
  
        const order = createTestOrder({
          id: 'test-no-mev-order',
          tokenType: 'DEX_POOL'
        });
  
        const result = await orderExecutor.executeOrder(order, 'DEX_POOL');
  
        expect(result.jitoTip).toBe(0);
      });
    });
  
    describe('edge cases', () => {
      it('должен обрабатывать очень большие суммы', async () => {
        const order = createTestOrder({
          id: 'huge-order',
          params: {
            amount: 1000 * 1_000_000_000,
            userId: 1,
            tokenMint: 'So11111111111111111111111111111111111112',
            orderType: OrderType.BUY,
            price: 0.00001
          }
        });
  
        transactionSubmitter.setMockTransactionData('So11111111111111111111111111111111111112', 1000000000, 0);
  
        const result = await orderExecutor.executeOrder(order, 'DEX_POOL');
  
        expect(result.success).toBe(true);
      });
  
      it('должен обрабатывать очень малые суммы', async () => {
        const order = createTestOrder({
          id: 'tiny-order',
          params: {
            amount: 1_000,
            userId: 1,
            tokenMint: 'So11111111111111111111111111111111111112',
            orderType: OrderType.BUY,
            price: 0.00001
          }
        });
  
        transactionSubmitter.setMockTransactionData('So11111111111111111111111111111111111112', 1, 0);
  
        const result = await orderExecutor.executeOrder(order, 'DEX_POOL');
  
        expect(result.success).toBe(true);
      });
  
      it('должен обрабатывать граничные значения slippage', async () => {
        const order = createTestOrder({
          id: 'slippage-order',
          params: {
            slippage: 0.1,
            userId: 1,
            tokenMint: 'So11111111111111111111111111111111111112',
            orderType: OrderType.BUY,
            price: 0.00001,
            amount: 1_000_000_000
          }
        });
  
        transactionSubmitter.setMockTransactionData('So11111111111111111111111111111111111112', 1000000, 0);
  
        const result = await orderExecutor.executeOrder(order, 'DEX_POOL');
  
        expect(result.success).toBe(true);
      });
    });
  });

  describe('getConnection', () => {
    it('should return the connection from transaction submitter', () => {
      const connection = orderExecutor.getConnection();

      expect(connection).toBeDefined();
      // Note: In unit tests, this returns a mock connection object
      expect(connection).toHaveProperty('getParsedTransaction');
    });
  });
});
