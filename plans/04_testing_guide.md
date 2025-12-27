# Руководство по тестированию DEX бота

**Дата:** 2025-01-09  
**Статус:** 📝 Подготовка

---

## 🎯 Варианты тестирования

### 1. Unit тесты (Модульное тестирование)
**Уровень:** Отдельные функции и классы  
**Среда:** Local (без RPC)

**Что можно тестировать:**
- ✅ PriorityFeeManager (расчет комиссий, кэширование)
- ✅ PriceMonitor (кэширование, форматирование цен)
- ✅ DisplayHelper (конвертация единиц)
- ✅ Логика лимитных ордеров (расчет цен, условия исполнения)
- ✅ Вспомогательные функции

**Инструменты:**
- Jest или Mocha + Chai
- ts-node для запуска TypeScript

**Пример:**
```typescript
// tests/PriorityFeeManager.test.ts
import { PriorityFeeManager } from '../src/trading/managers/PriorityFeeManager';

describe('PriorityFeeManager', () => {
  it('should calculate median fee correctly', async () => {
    const mockConnection = {
      getRecentPrioritizationFees: async () => [
        { prioritizationFee: 1000 },
        { prioritizationFee: 2000 },
        { prioritizationFee: 3000 },
      ]
    };
    
    const manager = new PriorityFeeManager(mockConnection as any);
    const fee = await manager.getOptimalFee(undefined, 'normal');
    
    expect(fee).toBeGreaterThanOrEqual(2000); // median * 1.15
  });
});
```

---

### 2. Integration тесты (Интеграционное тестирование)
**Уровень:** Взаимодействие компонентов  
**Среда:** Local с моками RPC

**Что можно тестировать:**
- ✅ TradeRouter (маршрутизация стратегий)
- ✅ PumpFunLimitOrderManager (создание и отмена ордеров)
- ✅ TradingPanel (обработка callback queries)
- ✅ Взаимодействие между компонентами

**Инструменты:**
- Jest с моками
- Nock для HTTP запросов
- Solana-test-validator (локальный валидатор)

**Пример:**
```typescript
// tests/PumpFunLimitOrderManager.test.ts
import { PumpFunLimitOrderManager } from '../src/trading/managers/PumpFunLimitOrderManager';

describe('PumpFunLimitOrderManager', () => {
  it('should create order with take profit', async () => {
    const mockStrategy = {
      executeSwap: jest.fn().mockResolvedValue('test_signature')
    };
    const mockPriceMonitor = {
      getCurrentPrice: jest.fn().mockResolvedValue(0.00001)
    };
    
    const manager = new PumpFunLimitOrderManager(
      mockStrategy as any,
      mockPriceMonitor as any,
      mockWallet,
      mockSettings,
      './test-data'
    );
    
    await manager.initialize();
    const orderId = await manager.createOrder({
      tokenMint: 'test_mint',
      orderType: OrderType.BUY,
      amount: 100,
      price: 0.00001,
      takeProfitPercent: 50
    });
    
    const order = await manager.getOrder(orderId);
    expect(order?.params.takeProfitPercent).toBe(50);
    expect(order?.relatedOrderId).toBeDefined();
  });
});
```

---

### 3. Devnet тестирование (Тестовая сеть Solana)
**Уровень:** Реальные транзакции без потери средств  
**Среда:** Solana Devnet

**Что можно тестировать:**
- ✅ Реальные транзакции buy/sell
- ✅ PumpFun на devnet (если доступен)
- ✅ Jupiter на devnet
- ✅ Лимитные ордера с реальными ценами
- ✅ MEV защита (Jito на devnet)

**Инструменты:**
- Solana CLI
- Airdrop для получения тестовых SOL
- Devnet RPC (например, от Helius или QuickNode)

**Подготовка:**
```bash
# Установить Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# Настроить на devnet
solana config set --url devnet

# Получить тестовые SOL
solana airdrop 2
```

**Изменение .env для devnet:**
```bash
SOLANA_NETWORK=devnet
ALCHEMY_SOLANA_RPC=https://solana-devnet.g.alchemy.com/v2/your_key
```

**Тестовый сценарий:**
```typescript
// tests/integration/devnet.test.ts
describe('Devnet Integration Tests', () => {
  it('should buy token on devnet', async () => {
    const result = await tradeRouter.buy(
      'Solana',
      'test_token_mint',
      0.1 * LAMPORTS_PER_SOL,
      userSettings,
      wallet
    );
    
    expect(result.signature).toBeDefined();
    console.log(`Transaction: https://solscan.io/tx/${result.signature}?cluster=devnet`);
  });
});
```

---

### 4. Mainnet тестирование (Основная сеть)
**Уровень:** Реальные транзакции с реальными средствами  
**Среда:** Solana Mainnet

**Что можно тестировать:**
- ✅ Полный цикл работы бота
- ✅ Реальные PumpFun токены
- ✅ Реальный Jupiter
- ✅ MEV защита на mainnet
- ✅ Лимитные ордера в реальных условиях

**⚠️ ВНИМАНИЕ:**
- Используйте только небольшие суммы (0.01-0.1 SOL)
- Тестируйте на ликвидных токенах
- Имейте в виду комиссии и проскальзывание
- Используйте testnet сначала!

**Тестовый сценарий:**
```typescript
// tests/integration/mainnet.test.ts
describe('Mainnet Integration Tests', () => {
  it('should buy real token on mainnet', async () => {
    // Используйте только ликвидные токены!
    const usdcMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt';
    
    const result = await tradeRouter.buy(
      'Solana',
      usdcMint,
      0.01 * LAMPORTS_PER_SOL, // Только 0.01 SOL!
      userSettings,
      wallet
    );
    
    expect(result.signature).toBeDefined();
    console.log(`Transaction: https://solscan.io/tx/${result.signature}`);
  });
});
```

---

## 📋 Рекомендуемый порядок тестирования

### Этап 1: Unit тесты (1-2 дня)
**Цель:** Проверить логику отдельных компонентов

1. PriorityFeeManager
   - Расчет медианы
   - Стратегии скорости
   - Кэширование
   - Fallback значения

2. PriceMonitor
   - Кэширование цен
   - Форматирование
   - Мониторинг

3. DisplayHelper
   - Конвертация SOL/lamports
   - Форматирование цен

4. Логика ордеров
   - Расчет take profit
   - Расчет stop loss
   - Условия исполнения

### Этап 2: Integration тесты (2-3 дня)
**Цель:** Проверить взаимодействие компонентов

1. TradeRouter
   - Маршрутизация стратегий
   - Выбор приоритетной стратегии

2. PumpFunLimitOrderManager
   - Создание ордеров
   - Отмена ордеров
   - Связь ордеров

3. TradingPanel
   - Обработка callback queries
   - Пошаговый ввод
   - Клавиатуры

### Этап 3: Devnet тестирование (1-2 дня)
**Цель:** Проверить реальные транзакции без риска

1. Подключение к devnet
2. Получение test SOL через airdrop
3. Тест buy/sell на devnet токенах
4. Тест лимитных ордеров
5. Тест MEV защиты

### Этап 4: Mainnet тестирование (1 день)
**Цель:** Финальное тестирование с реальными средствами

1. Тест на ликвидном токене (USDC)
2. Маленькие суммы (0.01-0.1 SOL)
3. Проверка всех функций
4. Мониторинг в реальном времени

---

## 🛠️ Настройка тестовой среды

### Установка зависимостей
```bash
npm install --save-dev jest @types/jest ts-jest @types/node
npm install --save-dev nock # для моков HTTP запросов
```

### Конфигурация Jest
```javascript
// jest.config.js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
};
```

### Скрипты в package.json
```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:unit": "jest tests/unit",
    "test:integration": "jest tests/integration",
    "test:devnet": "jest tests/integration/devnet.test.ts",
    "test:mainnet": "jest tests/integration/mainnet.test.ts"
  }
}
```

---

## 📁 Структура тестов

```
tests/
├── unit/
│   ├── PriorityFeeManager.test.ts
│   ├── PriceMonitor.test.ts
│   ├── DisplayHelper.test.ts
│   └── LimitOrderLogic.test.ts
├── integration/
│   ├── TradeRouter.test.ts
│   ├── PumpFunLimitOrderManager.test.ts
│   ├── TradingPanel.test.ts
│   ├── devnet.test.ts
│   └── mainnet.test.ts
├── mocks/
│   ├── mockConnection.ts
│   ├── mockWallet.ts
│   └── mockStrategy.ts
└── fixtures/
    ├── orders.json
    └── prices.json
```

---

## 🎯 Пример полного теста

```typescript
// tests/integration/PumpFunLimitOrderManager.integration.test.ts
import { PumpFunLimitOrderManager } from '../../src/trading/managers/PumpFunLimitOrderManager';
import { PriceMonitor } from '../../src/trading/managers/PriceMonitor';
import { PumpFunStrategy } from '../../src/trading/strategies/solana/PumpFunStrategy';
import { OrderType, OrderStatus } from '../../src/trading/managers/ILimitOrderManager';
import * as fs from 'fs/promises';
import * as path from 'path';

describe('PumpFunLimitOrderManager Integration', () => {
  let manager: PumpFunLimitOrderManager;
  let testDataDir: string;
  let mockStrategy: any;
  let mockPriceMonitor: any;
  let mockWallet: any;
  let mockSettings: any;

  beforeEach(async () => {
    testDataDir = path.join(__dirname, '../test-data');
    
    // Создаем моки
    mockStrategy = {
      executeSwap: jest.fn().mockResolvedValue('test_signature')
    };
    
    mockPriceMonitor = {
      getCurrentPrice: jest.fn().mockResolvedValue(0.00001)
    };
    
    mockWallet = {
      publicKey: { toString: () => 'test_wallet_address' }
    };
    
    mockSettings = {
      slippage: 1.0,
      mevProtection: true,
      speedStrategy: 'normal'
    };
    
    manager = new PumpFunLimitOrderManager(
      mockStrategy,
      mockPriceMonitor,
      mockWallet,
      mockSettings,
      testDataDir
    );
    
    await manager.initialize();
  });

  afterEach(async () => {
    // Очистка тестовых данных
    try {
      await fs.rm(testDataDir, { recursive: true, force: true });
    } catch (e) {
      // Игнорируем ошибки очистки
    }
  });

  describe('Order Creation', () => {
    it('should create buy order', async () => {
      const orderId = await manager.createOrder({
        tokenMint: 'test_mint',
        orderType: OrderType.BUY,
        amount: 100,
        price: 0.00001,
      });

      expect(orderId).toBeDefined();
      expect(orderId).toMatch(/^LO_/);
      
      const order = await manager.getOrder(orderId);
      expect(order).toBeDefined();
      expect(order?.status).toBe(OrderStatus.PENDING);
      expect(order?.params.orderType).toBe(OrderType.BUY);
    });

    it('should create buy order with take profit', async () => {
      const orderId = await manager.createOrder({
        tokenMint: 'test_mint',
        orderType: OrderType.BUY,
        amount: 100,
        price: 0.00001,
        takeProfitPercent: 50,
      });

      const order = await manager.getOrder(orderId);
      expect(order?.relatedOrderId).toBeDefined();
      
      const takeProfitOrder = await manager.getOrder(order!.relatedOrderId!);
      expect(takeProfitOrder).toBeDefined();
      expect(takeProfitOrder?.params.orderType).toBe(OrderType.SELL);
      expect(takeProfitOrder?.params.price).toBe(0.000015); // 0.00001 * 1.5
    });
  });

  describe('Order Cancellation', () => {
    it('should cancel order', async () => {
      const orderId = await manager.createOrder({
        tokenMint: 'test_mint',
        orderType: OrderType.BUY,
        amount: 100,
        price: 0.00001,
      });

      await manager.cancelOrder(orderId);
      
      const order = await manager.getOrder(orderId);
      expect(order?.status).toBe(OrderStatus.CANCELLED);
    });

    it('should cancel related take profit order', async () => {
      const orderId = await manager.createOrder({
        tokenMint: 'test_mint',
        orderType: OrderType.BUY,
        amount: 100,
        price: 0.00001,
        takeProfitPercent: 50,
      });

      await manager.cancelOrder(orderId);
      
      const order = await manager.getOrder(orderId);
      const relatedOrder = await manager.getOrder(order!.relatedOrderId!);
      
      expect(order?.status).toBe(OrderStatus.CANCELLED);
      expect(relatedOrder?.status).toBe(OrderStatus.CANCELLED);
    });
  });

  describe('Order Statistics', () => {
    it('should return correct statistics', async () => {
      await manager.createOrder({
        tokenMint: 'test_mint1',
        orderType: OrderType.BUY,
        amount: 100,
        price: 0.00001,
      });

      await manager.createOrder({
        tokenMint: 'test_mint2',
        orderType: OrderType.SELL,
        amount: 200,
        price: 0.00002,
      });

      const stats = await manager.getStats();
      expect(stats.total).toBe(2);
      expect(stats.pending).toBe(2);
    });
  });
});
```

---

## 🚀 Быстрый старт

### 1. Запуск unit тестов
```bash
npm test
```

### 2. Запуск с покрытием кода
```bash
npm run test:coverage
```

### 3. Запуск в watch режиме
```bash
npm run test:watch
```

### 4. Тестирование на devnet
```bash
# Сначала настройте .env для devnet
npm run test:devnet
```

### 5. Тестирование на mainnet (ОСТОРОЖНО!)
```bash
# Убедитесь, что используете маленькие суммы!
npm run test:mainnet
```

---

## ⚠️ Важные замечания

### Unit тесты
- ✅ Быстрые и дешевые
- ✅ Можно запускать часто
- ✅ Покрывают логику
- ❌ Не проверяют взаимодействие с RPC

### Integration тесты
- ✅ Проверяют взаимодействие компонентов
- ✅ Можно использовать моки
- ✅ Быстрее end-to-end тестов
- ❌ Не проверяют реальные транзакции

### Devnet тесты
- ✅ Реальные транзакции
- ✅ Без потери средств
- ✅ Тестовая среда
- ❌ Может отличаться от mainnet
- ❌ Не все токены доступны

### Mainnet тесты
- ✅ Полностью реальная среда
- ✅ Тест всех функций
- ❌ Риск потери средств
- ❌ Комиссии
- ❌ Нужно использовать только маленькие суммы

---

## 📊 Метрики тестирования

### Цели покрытия кода
- **Unit тесты:** >80% покрытие
- **Integration тесты:** >60% покрытие
- **Общее покрытие:** >70%

### Критические пути
- ✅ Создание и исполнение ордеров
- ✅ MEV защита
- ✅ Обработка ошибок
- ✅ Graceful shutdown

---

## 🔧 Отладка

### Логирование тестов
```typescript
// В тестах можно включить детальное логирование
const originalConsole = console.log;
beforeAll(() => {
  console.log = (...args) => {
    originalConsole('[TEST]', ...args);
  };
});
```

### Моки для RPC
```typescript
import { mock } from 'jest-mock-extended';

const mockConnection = mock<Connection>({
  getRecentPrioritizationFees: jest.fn().mockResolvedValue([
    { prioritizationFee: 1000 },
    { prioritizationFee: 2000 },
  ]),
  getBalance: jest.fn().mockResolvedValue(1_000_000_000),
});
```

---

## 📝 Заключение

**Рекомендуемый подход:**
1. Начните с unit тестов для критической логики
2. Добавьте integration тесты для проверки взаимодействия
3. Протестируйте на devnet с реальными транзакциями
4. Проведите финальное тестирование на mainnet с маленькими суммами

**Безопасность:**
- Всегда начинайте с unit тестов
- Используйте devnet перед mainnet
- На mainnet используйте только маленькие суммы
- Тестируйте на ликвидных токенах

**Автоматизация:**
- Настройте CI/CD для автоматического запуска тестов
- Используйте pre-commit хуки для проверки кода
- Генерируйте отчеты о покрытии кода
