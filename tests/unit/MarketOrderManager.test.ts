/**
 * Unit Tests для MarketOrderManager
 * Тестирует функциональность market orders (buy/sell)
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { Keypair, Transaction, Connection } from '@solana/web3.js';
import { MarketOrderManager, MarketBuyResult, MarketSellResult, PnLResult } from '../../src/trading/managers/MarketOrderManager';
import { JupiterStrategy } from '../../src/trading/strategies/solana/JupiterStrategy';
import { PumpFunStrategy } from '../../src/trading/strategies/solana/PumpFunStrategy';
import { OrderExecutor } from '../../src/trading/managers/OrderExecutor';
import { TokenTypeDetector } from '../../src/trading/managers/TokenTypeDetector';
import { UnifiedPriceService } from '../../src/services/UnifiedPriceService';
import { PositionManager, Position } from '../../src/trading/managers/PositionManager';
import { LimitOrderManager } from '../../src/trading/managers/LimitOrderManager';
import { ITransactionSubmitter, SimulationResult } from '../../src/interfaces/ITransactionSubmitter';
import { UserSettings } from '../../src/trading/router/ITradingStrategy';

// Mock dependencies
const mockJupiterStrategy = {
  buildTransaction: jest.fn(),
  getQuote: jest.fn(),
  executeSwap: jest.fn()
} as any;

const mockPumpFunStrategy = {
  buildTransaction: jest.fn(),
  getQuote: jest.fn(),
  executeSwap: jest.fn()
} as any;

const mockOrderExecutor = {
  simulateTransaction: jest.fn(),
  sendTransaction: jest.fn(),
  confirmTransaction: jest.fn(),
  getReceivedTokensFromTx: jest.fn(),
  getConnection: jest.fn()
} as any;

const mockTokenTypeDetector = {
  detectType: jest.fn()
} as any;

const mockUnifiedPriceService = {
  getPrice: jest.fn(),
  getTokenType: jest.fn()
} as any;

const mockPositionManager = {
  createPosition: jest.fn(),
  getPosition: jest.fn(),
  closePosition: jest.fn()
} as any;

const mockLimitOrderManager = {
  createOrder: jest.fn(),
  getOrdersByPosition: jest.fn(),
  cancelOrder: jest.fn()
} as any;

const mockWallet = Keypair.generate();
const mockConnection = new Connection('https://api.mainnet-beta.solana.com');
const TEST_USER_ID = 123;

const mockUserSettings: UserSettings = {
  slippage: 0.01,
  mevProtection: true,
  speedStrategy: 'normal',
  useJito: true,
  jitoTipMultiplier: 1.0,
  priorityFee: 100000
};

describe('MarketOrderManager', () => {
  let marketOrderManager: MarketOrderManager;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Setup mock implementations
    mockOrderExecutor.getConnection.mockReturnValue(mockConnection);
    jest.spyOn(mockConnection, 'getBalance').mockResolvedValue(1_000_000_000); // 1 SOL

    marketOrderManager = new MarketOrderManager(
      mockJupiterStrategy,
      mockPumpFunStrategy,
      mockOrderExecutor,
      mockTokenTypeDetector,
      mockUnifiedPriceService,
      mockPositionManager,
      mockWallet,
      mockUserSettings,
      TEST_USER_ID,
      mockLimitOrderManager
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('executeMarketBuy', () => {
    it('должен успешно исполнить market buy для DEX токена', async () => {
      // Arrange
      const tokenMint = 'TestTokenMint12345678901234567890';
      const amountSOL = 0.5;
      const expectedTokens = 1000;
      const expectedPrice = 0.0005;
      const mockTransaction = new Transaction();
      const mockSignature = 'test_signature_12345';
      const mockPosition: Position = {
        id: 'pos_123',
        userId: 123,
        tokenMint,
        tokenType: 'DEX_POOL',
        entryPrice: expectedPrice,
        size: expectedTokens,
        status: 'OPEN',
        orderType: 'MARKET_BUY',
        openTxSignature: mockSignature,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockTokenTypeDetector.detectType.mockResolvedValue('DEX_POOL');
      mockUnifiedPriceService.getPrice.mockResolvedValue({ price: expectedPrice, source: 'JUPITER', tokenType: 'DEX_POOL' });
      mockJupiterStrategy.buildTransaction.mockResolvedValue(mockTransaction);
      mockOrderExecutor.simulateTransaction.mockResolvedValue({ success: true });
      mockOrderExecutor.sendTransaction.mockResolvedValue(mockSignature);
      mockOrderExecutor.confirmTransaction.mockResolvedValue(true);
      mockOrderExecutor.getReceivedTokensFromTx.mockResolvedValue(expectedTokens);
      mockPositionManager.createPosition.mockResolvedValue(mockPosition);

      // Act
      const result = await marketOrderManager.executeMarketBuy(tokenMint, amountSOL);

      // Assert
      expect(result.success).toBe(true);
      expect(result.signature).toBe(mockSignature);
      expect(result.position).toEqual(mockPosition);
      expect(result.receivedTokens).toBe(expectedTokens);
      expect(result.entryPrice).toBe(expectedPrice);
      expect(mockTokenTypeDetector.detectType).toHaveBeenCalledWith(tokenMint);
      expect(mockUnifiedPriceService.getPrice).toHaveBeenCalledWith(tokenMint);
      expect(mockJupiterStrategy.buildTransaction).toHaveBeenCalled();
      expect(mockOrderExecutor.simulateTransaction).toHaveBeenCalledWith(mockTransaction);
      expect(mockOrderExecutor.sendTransaction).toHaveBeenCalledWith(mockTransaction, expect.objectContaining({
        priorityFee: 100000,
        jitoTip: expect.any(Number)
      }));
      expect(mockOrderExecutor.confirmTransaction).toHaveBeenCalledWith(mockSignature);
      expect(mockOrderExecutor.getReceivedTokensFromTx).toHaveBeenCalledWith(mockSignature, tokenMint);
      expect(mockPositionManager.createPosition).toHaveBeenCalledWith(
        TEST_USER_ID,
        expect.objectContaining({
          tokenMint,
          tokenType: 'DEX_POOL',
          entryPrice: expectedPrice,
          size: expectedTokens,
          openTxSignature: mockSignature,
          orderType: 'MARKET_BUY'
        })
      );
    });

    it('должен успешно исполнить market buy для bonding curve токена', async () => {
      // Arrange
      const tokenMint = 'PumpFunTokenMint1234567890';
      const amountSOL = 0.3;
      const expectedTokens = 500;
      const expectedPrice = 0.0006;
      const mockTransaction = new Transaction();
      const mockSignature = 'test_signature_456';
      const mockPosition: Position = {
        id: 'pos_456',
        userId: 123,
        tokenMint,
        tokenType: 'BONDING_CURVE',
        entryPrice: expectedPrice,
        size: expectedTokens,
        status: 'OPEN',
        orderType: 'MARKET_BUY',
        openTxSignature: mockSignature,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockTokenTypeDetector.detectType.mockResolvedValue('BONDING_CURVE');
      mockUnifiedPriceService.getPrice.mockResolvedValue({ price: expectedPrice, source: 'PUMP_FUN', tokenType: 'BONDING_CURVE' });
      mockPumpFunStrategy.buildTransaction.mockResolvedValue(mockTransaction);
      mockOrderExecutor.simulateTransaction.mockResolvedValue({ success: true });
      mockOrderExecutor.sendTransaction.mockResolvedValue(mockSignature);
      mockOrderExecutor.confirmTransaction.mockResolvedValue(true);
      mockOrderExecutor.getReceivedTokensFromTx.mockResolvedValue(expectedTokens);
      mockPositionManager.createPosition.mockResolvedValue(mockPosition);

      // Act
      const result = await marketOrderManager.executeMarketBuy(tokenMint, amountSOL);

      // Assert
      expect(result.success).toBe(true);
      expect(result.signature).toBe(mockSignature);
      expect(result.position).toEqual(mockPosition);
      expect(result.position?.tokenType).toBe('BONDING_CURVE');
      expect(mockPumpFunStrategy.buildTransaction).toHaveBeenCalled();
      expect(mockPositionManager.createPosition).toHaveBeenCalledWith(
        TEST_USER_ID,
        expect.objectContaining({
          tokenMint,
          tokenType: 'BONDING_CURVE',
        })
      );
    });

    it('должен успешно исполнить market buy с take profit', async () => {
      // Arrange
      const tokenMint = 'TestTokenMint12345678901234567890';
      const amountSOL = 0.5;
      const takeProfitPrice = 0.00075; // +50% от входной цены
      const expectedTokens = 1000;
      const expectedPrice = 0.0005;
      const mockTransaction = new Transaction();
      const mockSignature = 'test_signature_789';
      const mockPosition: Position = {
        id: 'pos_789',
        userId: 123,
        tokenMint,
        tokenType: 'DEX_POOL',
        entryPrice: expectedPrice,
        size: expectedTokens,
        status: 'OPEN',
        orderType: 'MARKET_BUY',
        openTxSignature: mockSignature,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      const mockTakeProfitOrderId = 'tp_order_123';

      mockTokenTypeDetector.detectType.mockResolvedValue('DEX_POOL');
      mockUnifiedPriceService.getPrice.mockResolvedValue({ price: expectedPrice, source: 'JUPITER', tokenType: 'DEX_POOL' });
      mockJupiterStrategy.buildTransaction.mockResolvedValue(mockTransaction);
      mockOrderExecutor.simulateTransaction.mockResolvedValue({ success: true });
      mockOrderExecutor.sendTransaction.mockResolvedValue(mockSignature);
      mockOrderExecutor.confirmTransaction.mockResolvedValue(true);
      mockOrderExecutor.getReceivedTokensFromTx.mockResolvedValue(expectedTokens);
      mockPositionManager.createPosition.mockResolvedValue(mockPosition);
      mockLimitOrderManager.createOrder.mockResolvedValue(mockTakeProfitOrderId);

      // Act
      const result = await marketOrderManager.executeMarketBuy(
        tokenMint,
        amountSOL,
        {
          createTakeProfit: true,
          takeProfitPrice
        }
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.takeProfitOrderId).toBe(mockTakeProfitOrderId);
      expect(mockLimitOrderManager.createOrder).toHaveBeenCalledWith(expect.objectContaining({
        userId: TEST_USER_ID,
        tokenMint,
        orderType: 'sell',
        price: takeProfitPrice,
        amount: expectedTokens,
        slippage: mockUserSettings.slippage,
        linkedPositionId: mockPosition.id
      }));
    });

    it('должен вернуть ошибку при неудачной симуляции', async () => {
      // Arrange
      const tokenMint = 'TestTokenMint12345678901234567890';
      const amountSOL = 0.5;
      const mockTransaction = new Transaction();

      mockTokenTypeDetector.detectType.mockResolvedValue('DEX_POOL');
      mockUnifiedPriceService.getPrice.mockResolvedValue({ price: 0.0005, source: 'JUPITER', tokenType: 'DEX_POOL' });
      mockJupiterStrategy.buildTransaction.mockResolvedValue(mockTransaction);
      mockOrderExecutor.simulateTransaction.mockResolvedValue({
        success: false,
        error: 'Simulation failed'
      });

      // Act
      const result = await marketOrderManager.executeMarketBuy(tokenMint, amountSOL);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('Simulation failed');
      expect(mockOrderExecutor.sendTransaction).not.toHaveBeenCalled();
    });

    it('должен вернуть ошибку при недостаточном балансе', async () => {
      // Arrange
      const tokenMint = 'TestTokenMint12345678901234567890';
      const amountSOL = 10; // Больше чем баланс


      // Act
      const result = await marketOrderManager.executeMarketBuy(tokenMint, amountSOL);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('Insufficient SOL balance');
    });
  });

  describe('executeMarketSell', () => {
    it('должен успешно исполнить market sell позиции', async () => {
      // Arrange
      const positionId = 'pos_123';
      const mockPosition: Position = {
        id: positionId,
        userId: 123,
        tokenMint: 'TestTokenMint12345678901234567890',
        tokenType: 'DEX_POOL',
        entryPrice: 0.0005,
        size: 1000,
        status: 'OPEN',
        orderType: 'MARKET_BUY',
        openTxSignature: 'open_tx_123',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      const currentPrice = 0.00075; // +50% от входной цены
      const mockTransaction = new Transaction();
      const mockSignature = 'sell_signature_123';
      const expectedPnL: PnLResult = {
        pnlSOL: 0.25,
        pnlPercent: 50,
        pnlUSD: 37.5
      };

      mockPositionManager.getPosition.mockResolvedValue(mockPosition);
      mockUnifiedPriceService.getPrice.mockResolvedValue({ price: currentPrice, source: 'JUPITER', tokenType: 'DEX_POOL' });
      mockJupiterStrategy.buildTransaction.mockResolvedValue(mockTransaction);
      mockOrderExecutor.simulateTransaction.mockResolvedValue({ success: true });
      mockOrderExecutor.sendTransaction.mockResolvedValue(mockSignature);
      mockOrderExecutor.confirmTransaction.mockResolvedValue(true);
      mockPositionManager.closePosition.mockResolvedValue(undefined);
      mockLimitOrderManager.getOrdersByPosition.mockResolvedValue([]);

      // Act
      const result = await marketOrderManager.executeMarketSell(positionId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.signature).toBe(mockSignature);
      expect(result.exitPrice).toBe(currentPrice);
      expect(result.pnl).toEqual(expectedPnL);
      expect(mockPositionManager.getPosition).toHaveBeenCalledWith(positionId);
      expect(mockJupiterStrategy.buildTransaction).toHaveBeenCalled();
      expect(mockOrderExecutor.sendTransaction).toHaveBeenCalled();
      expect(mockPositionManager.closePosition).toHaveBeenCalledWith(
        positionId,
        expect.objectContaining({
          exitPrice: currentPrice,
          exitTxSignature: mockSignature,
          realizedPnL: expectedPnL.pnlSOL,
          realizedPnLPercent: expectedPnL.pnlPercent
        })
      );
    });

    it('должен отменять связанные ордера перед продажей', async () => {
      // Arrange
      const positionId = 'pos_456';
      const mockPosition: Position = {
        id: positionId,
        userId: 123,
        tokenMint: 'TestTokenMint12345678901234567890',
        tokenType: 'DEX_POOL',
        entryPrice: 0.0005,
        size: 1000,
        status: 'OPEN',
        orderType: 'MARKET_BUY',
        openTxSignature: 'open_tx_456',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      const mockLinkedOrder = {
        id: 'order_123',
        params: {
          tokenMint: mockPosition.tokenMint,
          orderType: 'SELL' as any,
          price: 0.00075,
          amount: 1000
        }
      };

      mockPositionManager.getPosition.mockResolvedValue(mockPosition);
      mockUnifiedPriceService.getPrice.mockResolvedValue({ price: 0.00075, source: 'JUPITER', tokenType: 'DEX_POOL' });
      mockJupiterStrategy.buildTransaction.mockResolvedValue(new Transaction());
      mockOrderExecutor.simulateTransaction.mockResolvedValue({ success: true });
      mockOrderExecutor.sendTransaction.mockResolvedValue('sell_signature');
      mockOrderExecutor.confirmTransaction.mockResolvedValue(true);
      mockLimitOrderManager.getOrdersByPosition.mockResolvedValue([mockLinkedOrder]);
      mockLimitOrderManager.cancelOrder.mockResolvedValue(undefined);
      mockPositionManager.closePosition.mockResolvedValue(undefined);

      // Act
      await marketOrderManager.executeMarketSell(positionId);

      // Assert
      expect(mockLimitOrderManager.getOrdersByPosition).toHaveBeenCalledWith(positionId);
      expect(mockLimitOrderManager.cancelOrder).toHaveBeenCalledWith('order_123');
    });

    it('должен вернуть ошибку если позиция не найдена', async () => {
      // Arrange
      const positionId = 'non_existent_pos';

      mockPositionManager.getPosition.mockResolvedValue(null);

      // Act
      const result = await marketOrderManager.executeMarketSell(positionId);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('должен вернуть ошибку если позиция уже закрыта', async () => {
      // Arrange
      const positionId = 'pos_closed';
      const mockPosition: Position = {
        id: positionId,
        userId: 123,
        tokenMint: 'TestTokenMint12345678901234567890',
        tokenType: 'DEX_POOL',
        entryPrice: 0.0005,
        size: 0,
        status: 'CLOSED',
        orderType: 'MARKET_BUY',
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockPositionManager.getPosition.mockResolvedValue(mockPosition);

      // Act
      const result = await marketOrderManager.executeMarketSell(positionId);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('not open');
    });
  });

  describe('расчет P&L', () => {
    it('должен правильно рассчитывать P&L для прибыльной позиции', async () => {
      // Arrange
      const positionId = 'pos_profit';
      const mockPosition: Position = {
        id: positionId,
        userId: 123,
        tokenMint: 'TestTokenMint12345678901234567890',
        tokenType: 'DEX_POOL',
        entryPrice: 0.0005,
        size: 1000,
        status: 'OPEN',
        orderType: 'MARKET_BUY',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      const currentPrice = 0.00075; // +50%

      mockPositionManager.getPosition.mockResolvedValue(mockPosition);
      mockUnifiedPriceService.getPrice.mockResolvedValue({ price: currentPrice, source: 'JUPITER', tokenType: 'DEX_POOL' });
      mockJupiterStrategy.buildTransaction.mockResolvedValue(new Transaction());
      mockOrderExecutor.simulateTransaction.mockResolvedValue({ success: true });
      mockOrderExecutor.sendTransaction.mockResolvedValue('signature');
      mockOrderExecutor.confirmTransaction.mockResolvedValue(true);
      mockLimitOrderManager.getOrdersByPosition.mockResolvedValue([]);
      mockPositionManager.closePosition.mockResolvedValue(undefined);

      // Act
      const result = await marketOrderManager.executeMarketSell(positionId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.pnl?.pnlPercent).toBe(50);
      expect(result.pnl?.pnlSOL).toBeCloseTo(0.25, 2);
    });

    it('должен правильно рассчитывать P&L для убыточной позиции', async () => {
      // Arrange
      const positionId = 'pos_loss';
      const mockPosition: Position = {
        id: positionId,
        userId: 123,
        tokenMint: 'TestTokenMint12345678901234567890',
        tokenType: 'DEX_POOL',
        entryPrice: 0.0005,
        size: 1000,
        status: 'OPEN',
        orderType: 'MARKET_BUY',
        createdAt: new Date(),
        updatedAt: new Date()
      };
      const currentPrice = 0.0004; // -20%

      mockPositionManager.getPosition.mockResolvedValue(mockPosition);
      mockUnifiedPriceService.getPrice.mockResolvedValue({ price: currentPrice, source: 'JUPITER', tokenType: 'DEX_POOL' });
      mockJupiterStrategy.buildTransaction.mockResolvedValue(new Transaction());
      mockOrderExecutor.simulateTransaction.mockResolvedValue({ success: true });
      mockOrderExecutor.sendTransaction.mockResolvedValue('signature');
      mockOrderExecutor.confirmTransaction.mockResolvedValue(true);
      mockLimitOrderManager.getOrdersByPosition.mockResolvedValue([]);
      mockPositionManager.closePosition.mockResolvedValue(undefined);

      // Act
      const result = await marketOrderManager.executeMarketSell(positionId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.pnl?.pnlPercent).toBe(-20);
      expect(result.pnl?.pnlSOL).toBeCloseTo(-0.1, 2);
    });
  });
});
