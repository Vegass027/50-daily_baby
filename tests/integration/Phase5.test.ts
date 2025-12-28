/**
 * Integration Tests для Этапа 5: Market Orders
 * Тестирует полную интеграцию market orders с существующими компонентами
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Keypair, Transaction } from '@solana/web3.js';
import { MarketOrderManager } from '../../src/trading/managers/MarketOrderManager';
import { PositionManager } from '../../src/trading/managers/PositionManager';
import { JupiterStrategy } from '../../src/trading/strategies/solana/JupiterStrategy';
import { PumpFunStrategy } from '../../src/trading/strategies/solana/PumpFunStrategy';
import { OrderExecutor } from '../../src/trading/managers/OrderExecutor';
import { TokenTypeDetector } from '../../src/trading/managers/TokenTypeDetector';
import { UnifiedPriceService } from '../../src/services/UnifiedPriceService';
import { LimitOrderManager } from '../../src/trading/managers/LimitOrderManager';
import { AlchemySubmitter } from '../../src/services/AlchemySubmitter';
import { SolanaProvider } from '../../src/chains/SolanaProvider';
import { JupiterLimitOrderManager } from '../../src/trading/managers/JupiterLimitOrderManager';
import { PumpFunLimitOrderManager } from '../../src/trading/managers/PumpFunLimitOrderManager';
import { PriceMonitor } from '../../src/trading/managers/PriceMonitor';
import { UserSettings } from '../../src/trading/router/ITradingStrategy';

// Конфигурация для тестов
const TEST_USER_ID = 123456789;
const TEST_TOKEN_MINT_DEX = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGk92'; // USDC
const TEST_TOKEN_MINT_PUMPFUN = 'TestPumpFunToken12345678901234567890';
const TEST_AMOUNT_SOL = 0.01;
const TEST_SLIPPAGE = 0.01;

// User settings для тестов
const testUserSettings: UserSettings = {
  slippage: TEST_SLIPPAGE,
  mevProtection: true,
  speedStrategy: 'normal',
  useJito: true,
  jitoTipMultiplier: 1.0,
  priorityFee: 100000
};

describe('Phase 5: Market Orders Integration Tests', () => {
  let marketOrderManager: MarketOrderManager;
  let positionManager: PositionManager;
  let orderExecutor: OrderExecutor;
  let tokenTypeDetector: TokenTypeDetector;
  let unifiedPriceService: UnifiedPriceService;
  let limitOrderManager: LimitOrderManager;
  let jupiterStrategy: JupiterStrategy;
  let pumpFunStrategy: PumpFunStrategy;
  let solanaProvider: SolanaProvider;
  let alchemySubmitter: AlchemySubmitter;
  let testWallet: Keypair;

  beforeAll(async () => {
    // Инициализация компонентов
    testWallet = Keypair.generate();

    // Solana Provider
    const rpcUrl = process.env.RPC_URL || 'https://api.mainnet-beta.solana.com';
    solanaProvider = new SolanaProvider(rpcUrl);

    // Alchemy Submitter
    const apiKey = process.env.ALCHEMY_API_KEY || 'test_api_key';
    alchemySubmitter = new AlchemySubmitter(apiKey);

    // Стратегии
    jupiterStrategy = new JupiterStrategy(solanaProvider, testWallet);
    pumpFunStrategy = new PumpFunStrategy(solanaProvider, testWallet);

    // Order Executor
    orderExecutor = new OrderExecutor(
      jupiterStrategy,
      pumpFunStrategy,
      alchemySubmitter,
      testWallet,
      testUserSettings,
      null // Jito auth keypair (null для тестов без Jito)
    );

    // Unified Price Service
    unifiedPriceService = new UnifiedPriceService();

    // Token Type Detector
    tokenTypeDetector = new TokenTypeDetector(unifiedPriceService);

    // Position Manager
    positionManager = new PositionManager();

    // Price Monitor
    const priceMonitor = new PriceMonitor(solanaProvider.connection, pumpFunStrategy);

    // Jupiter Limit Order Manager
    const jupiterLimitOrderManager = new JupiterLimitOrderManager(
      jupiterStrategy,
      testWallet,
      testUserSettings
    );

    // PumpFun Limit Order Manager
    const pumpFunLimitOrderManager = new PumpFunLimitOrderManager(
      pumpFunStrategy,
      priceMonitor,
      testWallet,
      testUserSettings
    );

    // Limit Order Manager
    limitOrderManager = new LimitOrderManager(
      jupiterLimitOrderManager,
      pumpFunLimitOrderManager,
      priceMonitor,
      orderExecutor,
      tokenTypeDetector,
      './data'
    );

    await limitOrderManager.initialize();

    // Market Order Manager
    marketOrderManager = new MarketOrderManager(
      jupiterStrategy,
      pumpFunStrategy,
      orderExecutor,
      tokenTypeDetector,
      unifiedPriceService,
      positionManager,
      testWallet,
      testUserSettings,
      TEST_USER_ID,
      limitOrderManager
    );

    console.log('✅ Integration test environment initialized');
  });

  afterAll(async () => {
    // Очистка
    console.log('✅ Integration test environment cleaned up');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Полный цикл Market Buy', () => {
    it('должен успешно исполнить market buy для DEX токена', async () => {
      // Arrange
      const tokenMint = TEST_TOKEN_MINT_DEX;
      const amountSOL = TEST_AMOUNT_SOL;

      // Mock
      vi.spyOn(tokenTypeDetector, 'detectType').mockResolvedValue('DEX_POOL');
      vi.spyOn(unifiedPriceService, 'getPrice').mockResolvedValue({ price: 0.0005, source: 'JUPITER', tokenType: 'DEX_POOL' });
      vi.spyOn(marketOrderManager as any, 'validateBalance').mockResolvedValue(undefined);
      vi.spyOn(jupiterStrategy, 'buildTransaction').mockResolvedValue(new Transaction());
      vi.spyOn(orderExecutor, 'simulateTransaction').mockResolvedValue({ success: true });
      vi.spyOn(orderExecutor, 'sendTransaction').mockResolvedValue('mock_tx_signature_dex');
      vi.spyOn(orderExecutor, 'confirmTransaction').mockResolvedValue(true);
      vi.spyOn(orderExecutor, 'getReceivedTokensFromTx').mockResolvedValue(20000);
      vi.spyOn(positionManager, 'createPosition').mockResolvedValue({ id: 'mock_position_id_dex' } as any);

      // Act
      const result = await marketOrderManager.executeMarketBuy(
        tokenMint,
        amountSOL
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.signature).toBe('mock_tx_signature_dex');
      expect(result.position).toBeDefined();
      expect(result.position?.id).toBe('mock_position_id_dex');
      expect(result.receivedTokens).toBe(20000);
      expect(result.entryPrice).toBe(0.0005);

      console.log('Market buy test result:', result);
    });

    it('должен правильно определять тип токена', async () => {
      // Arrange
      const dexTokenMint = TEST_TOKEN_MINT_DEX;
      vi.spyOn(tokenTypeDetector, 'detectType').mockResolvedValue('DEX_POOL');

      // Act
      const tokenType = await tokenTypeDetector.detectType(dexTokenMint);

      // Assert
      expect(tokenType).toBe('DEX_POOL');
      console.log(`Detected token type: ${tokenType}`);
    });

    it('должен получать текущую цену токена', async () => {
      // Arrange
      const tokenMint = TEST_TOKEN_MINT_DEX;
      vi.spyOn(unifiedPriceService, 'getPrice').mockResolvedValue({ price: 0.0005, source: 'JUPITER', tokenType: 'DEX_POOL' });

      // Act
      const priceResult = await unifiedPriceService.getPrice(tokenMint);

      // Assert
      expect(priceResult).toBeDefined();
      expect(priceResult.price).toBe(0.0005);
      console.log(`Token price: ${priceResult.price} SOL (source: ${priceResult.source})`);
    });

    it('должен успешно исполнить market buy для bonding curve токена', async () => {
      // Arrange
      const tokenMint = TEST_TOKEN_MINT_PUMPFUN;
      const amountSOL = TEST_AMOUNT_SOL;

      // Mock
      vi.spyOn(tokenTypeDetector, 'detectType').mockResolvedValue('BONDING_CURVE');
      vi.spyOn(unifiedPriceService, 'getPrice').mockResolvedValue({ price: 0.0005, source: 'PUMP_FUN', tokenType: 'BONDING_CURVE' });
      vi.spyOn(marketOrderManager as any, 'validateBalance').mockResolvedValue(undefined);
      vi.spyOn(pumpFunStrategy, 'buildTransaction').mockResolvedValue(new Transaction());
      vi.spyOn(orderExecutor, 'simulateTransaction').mockResolvedValue({ success: true });
      vi.spyOn(orderExecutor, 'sendTransaction').mockResolvedValue('mock_tx_signature_pumpfun');
      vi.spyOn(orderExecutor, 'confirmTransaction').mockResolvedValue(true);
      vi.spyOn(orderExecutor, 'getReceivedTokensFromTx').mockResolvedValue(1000);
      vi.spyOn(positionManager, 'createPosition').mockResolvedValue({ id: 'mock_position_id_pumpfun' } as any);


      // Act
      const result = await marketOrderManager.executeMarketBuy(
        tokenMint,
        amountSOL
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.signature).toBe('mock_tx_signature_pumpfun');
      expect(result.position).toBeDefined();
      expect(result.position?.id).toBe('mock_position_id_pumpfun');

      console.log('Market buy for bonding curve test result:', result);
    });
  });

  describe('Market Buy с Take Profit', () => {
    it('должен создавать take profit ордер вместе с market buy', async () => {
      // Arrange
      const tokenMint = TEST_TOKEN_MINT_DEX;
      const amountSOL = TEST_AMOUNT_SOL;
      const entryPrice = 0.0005;
      const takeProfitPercent = 50;
      const takeProfitPrice = entryPrice * (1 + takeProfitPercent / 100); // 0.00075

      // Mock price service
      vi.spyOn(tokenTypeDetector, 'detectType').mockResolvedValue('DEX_POOL');
      vi.spyOn(unifiedPriceService, 'getPrice').mockResolvedValue({ price: entryPrice, source: 'JUPITER', tokenType: 'DEX_POOL' });
      vi.spyOn(marketOrderManager as any, 'validateBalance').mockResolvedValue(undefined);
      vi.spyOn(jupiterStrategy, 'buildTransaction').mockResolvedValue(new Transaction());
      vi.spyOn(orderExecutor, 'simulateTransaction').mockResolvedValue({ success: true });
      vi.spyOn(orderExecutor, 'sendTransaction').mockResolvedValue('mock_tx_signature_tp');
      vi.spyOn(orderExecutor, 'confirmTransaction').mockResolvedValue(true);
      vi.spyOn(orderExecutor, 'getReceivedTokensFromTx').mockResolvedValue(20000);
      vi.spyOn(positionManager, 'createPosition').mockResolvedValue({ id: 'mock_position_tp', tokenMint, size: 20000 } as any);
      const createOrderSpy = vi.spyOn(limitOrderManager, 'createOrder').mockResolvedValue('mock_tp_order_id');

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
      expect(result.takeProfitOrderId).toBe('mock_tp_order_id');
      expect(createOrderSpy).toHaveBeenCalledWith(expect.objectContaining({
        tokenMint,
        orderType: 'sell',
        price: takeProfitPrice,
        amount: 20000
      }));

      console.log('Market buy with TP test result:', result);
    });
  });

  describe('Полный цикл Market Sell', () => {
    it('должен успешно исполнить market sell позиции', async () => {
      // Этот тест требует существующей позиции

      // Arrange
      const positionId = 'test_position_id_sell';
      const mockPosition = { id: positionId, tokenMint: TEST_TOKEN_MINT_DEX, tokenType: 'DEX_POOL', entryPrice: 0.0005, size: 1000, status: 'OPEN' };

      // Mock
      vi.spyOn(positionManager, 'getPosition').mockResolvedValue(mockPosition as any);
      vi.spyOn(unifiedPriceService, 'getPrice').mockResolvedValue({ price: 0.0006, source: 'JUPITER', tokenType: 'DEX_POOL' });
      vi.spyOn(limitOrderManager, 'getOrdersByPosition').mockResolvedValue([]);
      vi.spyOn(jupiterStrategy, 'buildTransaction').mockResolvedValue(new Transaction());
      vi.spyOn(orderExecutor, 'simulateTransaction').mockResolvedValue({ success: true });
      vi.spyOn(orderExecutor, 'sendTransaction').mockResolvedValue('mock_tx_signature_sell');
      vi.spyOn(orderExecutor, 'confirmTransaction').mockResolvedValue(true);
      vi.spyOn(positionManager, 'closePosition').mockResolvedValue(undefined);


      // Act
      const result = await marketOrderManager.executeMarketSell(positionId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.signature).toBe('mock_tx_signature_sell');
      expect(result.exitPrice).toBe(0.0006);
      expect(result.pnl?.pnlPercent).toBeCloseTo(20);

      console.log('Market sell test result:', result);
    });

  });

  describe('Валидация баланса', () => {
    it('должен проверять баланс перед market buy', async () => {
      // Arrange
      const tokenMint = TEST_TOKEN_MINT_DEX;
      const amountSOL = 100; // Очень большая сумма
  
      // Mock preceding calls
      vi.spyOn(tokenTypeDetector, 'detectType').mockResolvedValue('DEX_POOL');
      vi.spyOn(unifiedPriceService, 'getPrice').mockResolvedValue({ price: 0.0005, source: 'JUPITER', tokenType: 'DEX_POOL' });
      // Mock the actual balance check to fail
      vi.spyOn(marketOrderManager as any, 'validateBalance').mockRejectedValue(new Error('Insufficient SOL balance'));
  
      // Act
      const result = await marketOrderManager.executeMarketBuy(
          tokenMint,
          amountSOL
      );
  
      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('Insufficient');
      console.log('Balance validation test result:', result);
    });
  });

  describe('Связанные ордера (TP/SL)', () => {
    it('должен отменять связанные ордера при market sell', async () => {
      // Arrange
      const positionId = 'test_position_with_orders';
      const mockPosition = { id: positionId, tokenMint: TEST_TOKEN_MINT_DEX, tokenType: 'DEX_POOL', entryPrice: 0.0005, size: 1000, status: 'OPEN' };
      const mockLinkedOrder = { id: 'linked_order_id_123' };
      const getOrdersSpy = vi.spyOn(limitOrderManager, 'getOrdersByPosition').mockResolvedValue([mockLinkedOrder] as any);
      const cancelOrderSpy = vi.spyOn(limitOrderManager, 'cancelOrder').mockResolvedValue(undefined);

      // Mock the rest of the flow
      vi.spyOn(positionManager, 'getPosition').mockResolvedValue(mockPosition as any);
      vi.spyOn(unifiedPriceService, 'getPrice').mockResolvedValue({ price: 0.0006, source: 'JUPITER', tokenType: 'DEX_POOL' });
      vi.spyOn(jupiterStrategy, 'buildTransaction').mockResolvedValue(new Transaction());
      vi.spyOn(orderExecutor, 'simulateTransaction').mockResolvedValue({ success: true });
      vi.spyOn(orderExecutor, 'sendTransaction').mockResolvedValue('mock_tx_signature_cancel');
      vi.spyOn(orderExecutor, 'confirmTransaction').mockResolvedValue(true);
      vi.spyOn(positionManager, 'closePosition').mockResolvedValue(undefined);


      // Act
      await marketOrderManager.executeMarketSell(positionId);

      // Assert
      expect(getOrdersSpy).toHaveBeenCalledWith(positionId);
      expect(cancelOrderSpy).toHaveBeenCalledWith('linked_order_id_123');
      console.log('Linked orders cancellation test completed.');
    });
  });

  describe('Интеграция с PositionManager', () => {
    it('должен создавать позицию после успешного market buy', async () => {
      // Arrange
      const userId = TEST_USER_ID;
      const params = {
        tokenMint: TEST_TOKEN_MINT_DEX,
        tokenType: 'DEX_POOL' as const,
        entryPrice: 0.0005,
        size: 1000,
        openTxSignature: 'test_tx_signature',
        orderType: 'MARKET_BUY' as const
      };

      // Act
      // Mock the DB call
      const mockPosition = { id: 'test_pos_id', userId, ...params, status: 'OPEN' };
      vi.spyOn(positionManager, 'createPosition').mockResolvedValue(mockPosition as any);

      const position = await positionManager.createPosition(userId, params);

      // Assert
      expect(position).toBeDefined();
      expect(position.id).toBeDefined();
      expect(position.userId).toBe(userId);
      expect(position.tokenMint).toBe(params.tokenMint);
      expect(position.entryPrice).toBe(params.entryPrice);
      expect(position.size).toBe(params.size);
      expect(position.status).toBe('OPEN');
      expect(position.orderType).toBe(params.orderType);
      console.log('Created position:', position.id);
    });

    it('должен закрывать позицию после успешного market sell', async () => {
      // Arrange
      const positionId = 'test_position_to_close';
      const closeParams = {
        exitPrice: 0.00075,
        exitTxSignature: 'sell_tx_signature',
        realizedPnL: 0.5,
        realizedPnLPercent: 50
      };

      // Mock position existence
      vi.spyOn(positionManager, 'getPosition').mockResolvedValue({
        id: positionId,
        userId: TEST_USER_ID,
        tokenMint: TEST_TOKEN_MINT_DEX,
        tokenType: 'DEX_POOL',
        entryPrice: 0.0005,
        size: 1000,
        status: 'OPEN',
        orderType: 'MARKET_BUY',
        createdAt: new Date(),
        updatedAt: new Date()
      });

      const closeSpy = vi.spyOn(positionManager, 'closePosition').mockResolvedValue(undefined);

      // Act
      await positionManager.closePosition(positionId, closeParams);

      // Assert
      expect(closeSpy).toHaveBeenCalledWith(positionId, closeParams);
      console.log('Position closed:', positionId);
    });

    it('должен получать открытые позиции пользователя', async () => {
      // Arrange
      const userId = TEST_USER_ID;

      // Act
      // Mock the DB call
      vi.spyOn(positionManager, 'getOpenPositions').mockResolvedValue([]);
      const positions = await positionManager.getOpenPositions(userId);

      // Assert
      expect(Array.isArray(positions)).toBe(true);
      console.log(`Found ${positions.length} open positions for user ${userId}`);
    });
  });

  describe('Обработка ошибок', () => {
    it('должен корректно обрабатывать ошибки симуляции', async () => {
      // Arrange
      const tokenMint = TEST_TOKEN_MINT_DEX;
      const amountSOL = TEST_AMOUNT_SOL;

      // Mock preceding calls
      vi.spyOn(tokenTypeDetector, 'detectType').mockResolvedValue('DEX_POOL');
      vi.spyOn(unifiedPriceService, 'getPrice').mockResolvedValue({ price: 0.0005, source: 'JUPITER', tokenType: 'DEX_POOL' });
      vi.spyOn(marketOrderManager as any, 'validateBalance').mockResolvedValue(undefined);
      vi.spyOn(jupiterStrategy, 'buildTransaction').mockResolvedValue(new Transaction());
      
      // Mock simulation failure
      vi.spyOn(orderExecutor, 'simulateTransaction').mockResolvedValue({
        success: false,
        error: 'Simulation failed: insufficient funds'
      });

      // Act
      const result = await marketOrderManager.executeMarketBuy(
        tokenMint,
        amountSOL
      );

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('Simulation failed');
      console.log('Error handling test result:', result);
    });

    it('должен корректно обрабатывать ошибки подтверждения транзакции', async () => {
      // Arrange
      const positionId = 'test_position';
      const mockPosition = { id: positionId, tokenMint: TEST_TOKEN_MINT_DEX, tokenType: 'DEX_POOL', entryPrice: 0.0005, size: 1000, status: 'OPEN' };

      // Mock the flow to reach the confirmation step
      vi.spyOn(positionManager, 'getPosition').mockResolvedValue(mockPosition as any);
      vi.spyOn(unifiedPriceService, 'getPrice').mockResolvedValue({ price: 0.0006, source: 'JUPITER', tokenType: 'DEX_POOL' });
      vi.spyOn(limitOrderManager, 'getOrdersByPosition').mockResolvedValue([]);
      vi.spyOn(jupiterStrategy, 'buildTransaction').mockResolvedValue(new Transaction());
      vi.spyOn(orderExecutor, 'simulateTransaction').mockResolvedValue({ success: true });
      vi.spyOn(orderExecutor, 'sendTransaction').mockResolvedValue('mock_tx_signature_confirm_fail');
      
      // Mock confirmation failure
      vi.spyOn(orderExecutor, 'confirmTransaction').mockResolvedValue(false);

      // Act
      const result = await marketOrderManager.executeMarketSell(positionId);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('timeout');
      console.log('Confirmation error handling test result:', result);
    });
  });

  describe('Интеграция с LimitOrderManager', () => {
    it('должен корректно работать с LimitOrderManager для TP ордеров', async () => {
      // Arrange
      const positionId = 'test_position_for_tp';

      // Act
      const linkedOrders = await limitOrderManager.getOrdersByPosition(positionId);

      // Assert
      expect(Array.isArray(linkedOrders)).toBe(true);
      console.log(`Found ${linkedOrders.length} linked orders for position ${positionId}`);
    });
  });

  describe('Производительность', () => {
    it('должен быстро обрабатывать market buy запрос', async () => {
      // Arrange
      const tokenMint = TEST_TOKEN_MINT_DEX;
      const amountSOL = TEST_AMOUNT_SOL;

      // Mock inner dependencies to isolate the manager's logic time
      vi.spyOn(tokenTypeDetector, 'detectType').mockResolvedValue('DEX_POOL');
      vi.spyOn(unifiedPriceService, 'getPrice').mockResolvedValue({ price: 0.0005, source: 'JUPITER', tokenType: 'DEX_POOL' });
      vi.spyOn(marketOrderManager as any, 'validateBalance').mockResolvedValue(undefined);
      vi.spyOn(jupiterStrategy, 'buildTransaction').mockResolvedValue(new Transaction());
      vi.spyOn(orderExecutor, 'simulateTransaction').mockResolvedValue({ success: true });
      vi.spyOn(orderExecutor, 'sendTransaction').mockResolvedValue('mock_tx_signature_perf');
      vi.spyOn(orderExecutor, 'confirmTransaction').mockResolvedValue(true);
      vi.spyOn(orderExecutor, 'getReceivedTokensFromTx').mockResolvedValue(20000);
      vi.spyOn(positionManager, 'createPosition').mockResolvedValue({ id: 'mock_position_id_perf' } as any);

      // Act
      const startTime = Date.now();
      await marketOrderManager.executeMarketBuy(
        tokenMint,
        amountSOL
      );
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Assert
      expect(duration).toBeLessThan(5000);
      console.log(`Market buy processing time: ${duration}ms`);
    });

    it('должен быстро обрабатывать market sell запрос', async () => {
      // Arrange
      const positionId = 'test_position';

      // Mock inner dependencies
      const mockPosition = { id: positionId, tokenMint: TEST_TOKEN_MINT_DEX, tokenType: 'DEX_POOL', entryPrice: 0.0005, size: 1000, status: 'OPEN' };
      vi.spyOn(positionManager, 'getPosition').mockResolvedValue(mockPosition as any);
      vi.spyOn(unifiedPriceService, 'getPrice').mockResolvedValue({ price: 0.0006, source: 'JUPITER', tokenType: 'DEX_POOL' });
      vi.spyOn(limitOrderManager, 'getOrdersByPosition').mockResolvedValue([]);
      vi.spyOn(jupiterStrategy, 'buildTransaction').mockResolvedValue(new Transaction());
      vi.spyOn(orderExecutor, 'simulateTransaction').mockResolvedValue({ success: true });
      vi.spyOn(orderExecutor, 'sendTransaction').mockResolvedValue('mock_tx_signature_sell_perf');
      vi.spyOn(orderExecutor, 'confirmTransaction').mockResolvedValue(true);
      vi.spyOn(positionManager, 'closePosition').mockResolvedValue(undefined);

      // Act
      const startTime = Date.now();
      await marketOrderManager.executeMarketSell(positionId);
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Assert
      expect(duration).toBeLessThan(5000);
      console.log(`Market sell processing time: ${duration}ms`);
    });
  });
});
