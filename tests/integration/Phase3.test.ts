import { LimitOrderManager } from '../../src/trading/managers/LimitOrderManager';
import { JupiterLimitOrderManager } from '../../src/trading/managers/JupiterLimitOrderManager';
import { PumpFunLimitOrderManager } from '../../src/trading/managers/PumpFunLimitOrderManager';
import { PriceMonitor } from '../../src/trading/managers/PriceMonitor';
import { OrderExecutor } from '../../src/trading/managers/OrderExecutor';
import { OrderValidator } from '../../src/trading/managers/OrderValidator';
import { TokenTypeDetector } from '../../src/trading/managers/TokenTypeDetector';
import { LimitOrderParams, OrderType, OrderStatus } from '../../src/trading/managers/ILimitOrderManager';
import { JupiterStrategy } from '../../src/trading/strategies/solana/JupiterStrategy';
import { PumpFunStrategy } from '../../src/trading/strategies/solana/PumpFunStrategy';
import { SolanaProvider } from '../../src/chains/SolanaProvider';
import { AlchemySubmitter } from '../../src/services/AlchemySubmitter';
import { UnifiedPriceService } from '../../src/services/UnifiedPriceService';
import { Keypair } from '@solana/web3.js';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Integration tests for Phase 3: Limit Orders Improvements
 * 
 * These tests verify the complete flow of limit order management including:
 * - Order creation and validation
 * - Linked orders (buy + take profit)
 * - Order execution
 * - Order cancellation
 * - Order persistence
 */

describe('Phase 3: Limit Orders Improvements', () => {
  let jupiterStrategy: JupiterStrategy;
  let pumpFunStrategy: PumpFunStrategy;
  let priceMonitor: PriceMonitor;
  let orderExecutor: OrderExecutor;
  let tokenTypeDetector: TokenTypeDetector;
  let jupiterManager: JupiterLimitOrderManager;
  let pumpFunManager: PumpFunLimitOrderManager;
  let limitOrderManager: LimitOrderManager;
  let wallet: Keypair;
  let testDataDir: string;

  beforeAll(async () => {
    // Create temporary test directory
    testDataDir = path.join(__dirname, '..', '..', 'test-data', 'phase3-integration');
    try {
      await fs.mkdir(testDataDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }

    // Initialize wallet (in production, this would be loaded from encrypted storage)
    wallet = Keypair.generate();

    // Initialize Solana provider with mock connection
    // Note: In real integration tests, you would use actual RPC endpoints
    const solanaProvider = new SolanaProvider(
      'https://api.devnet.solana.com',
      'test-key'
    );

    // Initialize strategies
    jupiterStrategy = new JupiterStrategy(solanaProvider, wallet);
    pumpFunStrategy = new PumpFunStrategy(solanaProvider, wallet);

    // Initialize price monitor
    priceMonitor = new PriceMonitor(solanaProvider.connection, pumpFunStrategy);

    // Initialize transaction submitter
    const transactionSubmitter = new AlchemySubmitter('test-api-key');

    // Initialize token type detector
    tokenTypeDetector = new TokenTypeDetector(
      new UnifiedPriceService()
    );

    // Initialize order executor
    orderExecutor = new OrderExecutor(
      jupiterStrategy,
      pumpFunStrategy,
      transactionSubmitter,
      wallet,
      { slippage: 0.01, mevProtection: false, speedStrategy: 'normal', priorityFee: 1000 }
    );

    // Initialize managers
    jupiterManager = new JupiterLimitOrderManager(
      jupiterStrategy,
      wallet,
      { slippage: 0.01, mevProtection: false, speedStrategy: 'normal', priorityFee: 1000 },
      testDataDir
    );

    pumpFunManager = new PumpFunLimitOrderManager(
      pumpFunStrategy,
      priceMonitor,
      wallet,
      { slippage: 0.01, mevProtection: false, speedStrategy: 'normal', priorityFee: 1000 },
      testDataDir
    );

    // Set order executor for managers
    jupiterManager.setOrderExecutor(orderExecutor);
    pumpFunManager.setOrderExecutor(orderExecutor);

    // Initialize unified manager
    limitOrderManager = new LimitOrderManager(
      jupiterManager,
      pumpFunManager,
      priceMonitor,
      orderExecutor,
      tokenTypeDetector,
      testDataDir
    );

    await limitOrderManager.initialize();
  });

  afterAll(async () => {
    // Clean up test data
    try {
      await fs.rm(testDataDir, { recursive: true, force: true });
    } catch (error) {
      // Directory might not exist
    }
  });

  describe('Order Creation and Validation', () => {
    it.skip('should create and validate a BUY limit order', async () => {
      // Skip: Requires Pump.fun API which may be unavailable
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000, // 1 SOL
        price: 0.00001,
        slippage: 0.01
      };

      const orderId = await limitOrderManager.createOrder(params);

      expect(orderId).toBeDefined();
      expect(orderId).toMatch(/^LO_/);

      const order = await limitOrderManager.getOrder(orderId);
      expect(order).not.toBeNull();
      expect(order?.params.orderType).toBe(OrderType.BUY);
      expect(order?.status).toBe(OrderStatus.PENDING);
    });

    it.skip('should create and validate a SELL limit order', async () => {
      // Skip: Requires Pump.fun API which may be unavailable
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.SELL,
        amount: 1000000,
        price: 0.00001,
        slippage: 0.01
      };

      const orderId = await limitOrderManager.createOrder(params);

      expect(orderId).toBeDefined();
      const order = await limitOrderManager.getOrder(orderId);
      expect(order?.params.orderType).toBe(OrderType.SELL);
    });

    it('should reject invalid order parameters', async () => {
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'invalid-address',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01
      };

      await expect(limitOrderManager.createOrder(params))
        .rejects
        .toThrow('Invalid order parameters');
    });
  });

  describe('Linked Orders (Buy + Take Profit)', () => {
    it.skip('should create buy order with take profit', async () => {
      // Skip: Requires Pump.fun API which may be unavailable
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01,
        takeProfitPercent: 50 // 50% profit
      };

      const buyOrderId = await limitOrderManager.createOrder(params);

      // Check that take profit order was created
      const linkedOrders = limitOrderManager.getLinkedOrders(buyOrderId);
      expect(linkedOrders).not.toBeNull();
      expect(linkedOrders?.buyOrderId).toBe(buyOrderId);
      expect(linkedOrders?.takeProfitOrderId).toBeDefined();

      // Verify take profit order
      const tpOrderId = linkedOrders!.takeProfitOrderId!;
      const tpOrder = await limitOrderManager.getOrder(tpOrderId);
      expect(tpOrder).not.toBeNull();
      expect(tpOrder?.params.orderType).toBe(OrderType.SELL);
      expect(tpOrder?.status).toBe(OrderStatus.INACTIVE);
      expect(tpOrder?.params.price).toBeCloseTo(0.000015, 8); // 0.00001 * 1.5
    });

    it.skip('should cancel linked orders when buy order is cancelled', async () => {
      // Skip: Requires Pump.fun API which may be unavailable
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01,
        takeProfitPercent: 50
      };

      const buyOrderId = await limitOrderManager.createOrder(params);
      const linkedOrders = limitOrderManager.getLinkedOrders(buyOrderId);
      const tpOrderId = linkedOrders!.takeProfitOrderId!;

      // Cancel buy order
      await limitOrderManager.cancelOrder(buyOrderId);

      // Verify both orders are cancelled
      const buyOrder = await limitOrderManager.getOrder(buyOrderId);
      const tpOrder = await limitOrderManager.getOrder(tpOrderId);

      expect(buyOrder?.status).toBe(OrderStatus.CANCELLED);
      expect(tpOrder?.status).toBe(OrderStatus.CANCELLED);
    });
  });

  describe('Order Cancellation', () => {
    it.skip('should cancel a PENDING order', async () => {
      // Skip: Requires Pump.fun API which may be unavailable
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01
      };

      const orderId = await limitOrderManager.createOrder(params);
      await limitOrderManager.cancelOrder(orderId);

      const order = await limitOrderManager.getOrder(orderId);
      expect(order?.status).toBe(OrderStatus.CANCELLED);
    });

    it.skip('should reject cancelling non-PENDING order', async () => {
      // Skip: Requires Pump.fun API which may be unavailable
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01
      };

      const orderId = await limitOrderManager.createOrder(params);

      // Manually set order to FILLED
      const order = await limitOrderManager.getOrder(orderId);
      if (order) {
        order.status = OrderStatus.FILLED;
      }

      await expect(limitOrderManager.cancelOrder(orderId))
        .rejects
        .toThrow('Cannot cancel order with status FILLED');
    });

    it('should throw error for non-existent order', async () => {
      await expect(limitOrderManager.cancelOrder('non-existent-order'))
        .rejects
        .toThrow('Order non-existent-order not found');
    });
  });

  describe('Order Retrieval', () => {
    it.skip('should retrieve order by ID', async () => {
      // Skip: Requires Pump.fun API which may be unavailable
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01
      };

      const orderId = await limitOrderManager.createOrder(params);
      const order = await limitOrderManager.getOrder(orderId);

      expect(order).not.toBeNull();
      expect(order?.id).toBe(orderId);
    });

    it('should return null for non-existent order', async () => {
      const order = await limitOrderManager.getOrder('non-existent-order');
      expect(order).toBeNull();
    });

    it.skip('should retrieve all orders sorted by creation time', async () => {
      // Skip: Requires Pump.fun API which may be unavailable
      const params1: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01
      };

      const params2: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00002,
        slippage: 0.01
      };

      await limitOrderManager.createOrder(params1);
      await new Promise(resolve => setTimeout(resolve, 10)); // Small delay
      await limitOrderManager.createOrder(params2);

      const allOrders = await limitOrderManager.getAllOrders();

      expect(allOrders).toHaveLength(2);
      expect(allOrders[0].createdAt).toBeGreaterThan(allOrders[1].createdAt);
    });

    it.skip('should retrieve only PENDING orders', async () => {
      // Skip: Requires Pump.fun API which may be unavailable
      const params1: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01
      };

      const params2: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00002,
        slippage: 0.01
      };

      const orderId1 = await limitOrderManager.createOrder(params1);
      const orderId2 = await limitOrderManager.createOrder(params2);

      // Cancel one order
      await limitOrderManager.cancelOrder(orderId2);

      const activeOrders = await limitOrderManager.getActiveOrders();

      expect(activeOrders).toHaveLength(1);
      expect(activeOrders[0].id).toBe(orderId1);
      expect(activeOrders[0].status).toBe(OrderStatus.PENDING);
    });
  });

  describe('Order Statistics', () => {
    it.skip('should return correct statistics', async () => {
      // Skip: Requires Pump.fun API which may be unavailable
      const params1: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01
      };

      const params2: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00002,
        slippage: 0.01,
        takeProfitPercent: 50
      };

      await limitOrderManager.createOrder(params1);
      const orderId2 = await limitOrderManager.createOrder(params2);

      // Cancel one order
      await limitOrderManager.cancelOrder(orderId2);

      const stats = await limitOrderManager.getStats();

      expect(stats.total).toBe(3); // 2 buy + 1 take profit
      expect(stats.pending).toBe(1);
      expect(stats.cancelled).toBe(2); // 1 buy + 1 take profit
      expect(stats.filled).toBe(0);
      expect(stats.inactive).toBe(1); // 1 take profit
    });
  });

  describe('Order Persistence', () => {
    it.skip('should persist orders to file', async () => {
      // Skip: Requires Pump.fun API which may be unavailable
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01
      };

      const orderId = await limitOrderManager.createOrder(params);

      // Check that file was created
      const ordersFile = path.join(testDataDir, 'limit_orders.json');
      const fileExists = await fs.access(ordersFile).then(() => true).catch(() => false);

      expect(fileExists).toBe(true);

      // Verify file content
      const fileContent = await fs.readFile(ordersFile, 'utf-8');
      const orders = JSON.parse(fileContent);

      expect(orders).toHaveLength(1);
      expect(orders[0].id).toBe(orderId);
    });

    it.skip('should load orders from file on initialization', async () => {
      // Skip: Requires Pump.fun API which may be unavailable
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01
      };

      const orderId = await limitOrderManager.createOrder(params);

      // Create new manager instance to test loading
      const newManager = new LimitOrderManager(
        jupiterManager,
        pumpFunManager,
        priceMonitor,
        orderExecutor,
        tokenTypeDetector,
        testDataDir
      );

      await newManager.initialize();

      const loadedOrder = await newManager.getOrder(orderId);
      expect(loadedOrder).not.toBeNull();
      expect(loadedOrder?.id).toBe(orderId);
    });
  });

  describe('Order Callbacks', () => {
    it.skip('should call order filled callback', async () => {
      // Skip: Requires Pump.fun API which may be unavailable
      const callback = jest.fn();
      limitOrderManager.setOrderFilledCallback(callback);

      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01
      };

      const orderId = await limitOrderManager.createOrder(params);

      // Get order and simulate fill
      const order = await limitOrderManager.getOrder(orderId);
      if (order) {
        order.status = OrderStatus.FILLED;
        order.filledAt = Date.now();
        order.filledPrice = 0.00001;
      }

      // Trigger callback
      await limitOrderManager['handleOrderFilled'](order!);

      // Note: In real scenario, callback would be invoked through manager
    });

    it.skip('should call order cancelled callback', async () => {
      // Skip: Requires Pump.fun API which may be unavailable
      const callback = jest.fn();
      limitOrderManager.setOrderCancelledCallback(callback);

      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01
      };

      const orderId = await limitOrderManager.createOrder(params);
      await limitOrderManager.cancelOrder(orderId);

      expect(limitOrderManager['orderCancelledCallback']).toBe(callback);
    });
  });

  describe('Clear All Orders', () => {
    it.skip('should clear all orders', async () => {
      // Skip: Requires Pump.fun API which may be unavailable
      const params: LimitOrderParams = {
        userId: 1,
        tokenMint: 'So11111111111111111111111111111111111111111112',
        orderType: OrderType.BUY,
        amount: 1_000_000_000,
        price: 0.00001,
        slippage: 0.01
      };

      await limitOrderManager.createOrder(params);

      await limitOrderManager.clearAllOrders();

      const allOrders = await limitOrderManager.getAllOrders();
      expect(allOrders).toHaveLength(0);
    });
  });

  describe('Price Validation', () => {
    it('should validate execution conditions for BUY order', () => {
      const order = {
        id: 'test-order',
        params: {
          userId: 1,
          tokenMint: 'So11111111111111111111111111111111111111112',
          orderType: OrderType.BUY,
          amount: 1_000_000_000,
          price: 0.00001
        },
        status: OrderStatus.PENDING,
        createdAt: Date.now()
      };

      const currentPrice = 0.000009; // Lower than target
      const shouldExecute = OrderValidator.validateExecution(order, currentPrice);

      expect(shouldExecute).toBe(true);
    });

    it('should validate execution conditions for SELL order', () => {
      const order = {
        id: 'test-order',
        params: {
          userId: 1,
          tokenMint: 'So11111111111111111111111111111111111111111112',
          orderType: OrderType.SELL,
          amount: 1_000_000_000,
          price: 0.00001
        },
        status: OrderStatus.PENDING,
        createdAt: Date.now()
      };

      const currentPrice = 0.000011; // Higher than target
      const shouldExecute = OrderValidator.validateExecution(order, currentPrice);

      expect(shouldExecute).toBe(true);
    });

    it('should validate price before execution', async () => {
      const order = {
        id: 'test-order',
        params: {
          userId: 1,
          tokenMint: 'So11111111111111111111111111111111111111112',
          orderType: OrderType.BUY,
          amount: 1_000_000_000,
          price: 0.00001
        },
        status: OrderStatus.PENDING,
        createdAt: Date.now()
      };

      const currentPrice = 0.000009; // Within 1% tolerance
      const isValid = await OrderValidator.validatePriceBeforeExecution(order, currentPrice);

      expect(isValid).toBe(true);
    });
  });

  describe('Take Profit Calculation', () => {
    it('should calculate take profit price correctly', () => {
      const buyPrice = 0.00001;
      const takeProfitPercent = 50; // 50%

      const tpPrice = OrderValidator.calculateTakeProfitPrice(buyPrice, takeProfitPercent);

      expect(tpPrice).toBeCloseTo(0.000015, 8); // 0.00001 * 1.5
    });

    it('should calculate take profit price for 100%', () => {
      const buyPrice = 0.00001;
      const takeProfitPercent = 100;

      const tpPrice = OrderValidator.calculateTakeProfitPrice(buyPrice, takeProfitPercent);

      expect(tpPrice).toBe(0.00002); // 0.00001 * 2
    });
  });
});
