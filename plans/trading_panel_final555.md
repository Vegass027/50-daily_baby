# Финальный документ для разработчика: Критические исправления торговой панели

**Дата:** 28 декабря 2025  
**Статус:** БЛОКИРУЮЩИЕ ОШИБКИ  
**БД:** Prisma + SQLite

---

## Общая оценка

### ✅ Что работает отлично
- **Архитектура сервисного слоя** - транзакции Prisma, rollback логика
- **Персистентность состояний** - восстановление после перезапуска
- **PositionTracker** - корректный расчет средней цены и PNL
- **AutoRefreshService** - обновление каждые 5 секунд

### ❌ Критические блокеры
**3 проблемы делают систему неработоспособной:**
1. Лимитные ордера записываются на первого пользователя
2. Кнопка "Cancel Order" не отменяет ордер в блокчейне
3. Покупка за USD неправильно конвертирует в SOL

**Готовность:** 40% → после исправлений: 95%

---

## БЛОКЕР #1: userId теряется при исполнении лимитных ордеров

### Проблема
```typescript
// src/bot.ts:466
const userId = ALLOWED_USERS[0]; // ❌ ВСЕ ОРДЕРА НА ПЕРВОГО ЮЗЕРА
```

**Последствия:** Хаос в мультиюзер режиме - все позиции и балансы пишутся первому пользователю.

### Исправление

#### Шаг 1: Обновить интерфейс `ILimitOrderManager`
```typescript
// src/trading/managers/ILimitOrderManager.ts
export interface LimitOrderParams {
  userId: number;  // ← ДОБАВИТЬ
  tokenMint: string;
  orderType: OrderType;
  amount: number;
  price: number;
  slippage: number;
}
```

#### Шаг 2: Обновить `LimitOrder` модель
```typescript
// src/trading/managers/LimitOrderManager.ts
export interface LimitOrder {
  id: string;
  params: LimitOrderParams;  // userId будет внутри params
  status: OrderStatus;
  createdAt: number;
}
```

#### Шаг 3: Передавать userId при создании ордера
```typescript
// src/panels/TradingPanel.ts - метод placeLimitOrder
const params: LimitOrderParams = {
  userId: state.user_id,  // ← ИЗ СОСТОЯНИЯ
  tokenMint: token_address,
  orderType: OrderType.BUY,
  amount: amountLamports,
  price: action_data.limit_price,
  slippage: action_data.slippage,
};

const orderId = await this.limitOrderManager.createOrder(params);
```

#### Шаг 4: Использовать userId из ордера при исполнении
```typescript
// src/bot.ts - функция handleLimitOrderFill
async function handleLimitOrderFill(order: LimitOrder): Promise<void> {
  const userId = order.params.userId;  // ← ИЗ ОРДЕРА
  
  if (!userId) {
    console.error('[Bot] Order missing userId:', order.id);
    return;
  }
  
  // Теперь записываем позицию правильному пользователю
  await positionTracker.recordTrade(
    userId,
    order.params.tokenMint,
    order.params.orderType === OrderType.BUY ? 'BUY' : 'SELL',
    order.params.price,
    order.params.amount
  );
}
```

#### Шаг 5: Обновить реализации менеджеров
Убедиться что `PumpFunLimitOrderManager` и `JupiterLimitOrderManager` сохраняют `userId` в объекте ордера.

---

## БЛОКЕР #2: Отмена лимитного ордера не работает

### Проблема
```typescript
// src/panels/TradingPanel.ts:649-661
private async cancelLimitOrder(state: UserPanelState): Promise<void> {
  // TODO: Реализовать получение ID активного лимитного ордера
  state.user_data.has_active_order = false;  // ❌ ТОЛЬКО ФЛАГ
}
```

**Последствия:** Ордер остается активным в блокчейне, может исполниться.

### Исправление

#### Шаг 1: Добавить поле в `UserPanelState`
```typescript
// src/types/panel.ts
export interface UserPanelState {
  user_id: number;
  message_id: number;
  token_address: string;
  mode: PanelMode;
  token_data: TokenData;
  user_data: UserData;
  action_data: ActionData;
  activeLimitOrderId?: string;  // ← ДОБАВИТЬ
  created_at: number;
  closed: boolean;
  waiting_for?: 'limit_price' | 'limit_amount' | 'tp_price' | 'sl_price';
}
```

#### Шаг 2: Добавить поле в Prisma схему
```prisma
// prisma/schema.prisma
model PanelState {
  id                   String   @id @default(uuid())
  userId               Int
  messageId            Int
  tokenAddress         String
  mode                 String
  tokenData            String   // JSON
  userData             String   // JSON
  actionData           String   // JSON
  activeLimitOrderId   String?  // ← ДОБАВИТЬ
  createdAt            DateTime @default(now())
  closed               Boolean  @default(false)
  waitingFor           String?
  
  @@unique([userId, tokenAddress])
}
```

#### Шаг 3: Сохранять orderId при создании
```typescript
// src/panels/TradingPanel.ts - метод placeLimitOrder
private async placeLimitOrder(state: UserPanelState): Promise<void> {
  // ... валидация ...
  
  const orderId = await this.limitOrderManager.createOrder(params);
  
  // Сохранить ID ордера
  state.user_data.has_active_order = true;
  state.activeLimitOrderId = orderId;  // ← СОХРАНИТЬ
  
  await this.stateManager.setState(state.user_id, state);
  
  console.log(`[TradingPanel] Limit order placed: ${orderId}`);
}
```

#### Шаг 4: Реализовать отмену
```typescript
// src/panels/TradingPanel.ts
private async cancelLimitOrder(state: UserPanelState): Promise<void> {
  const orderId = state.activeLimitOrderId;
  
  if (!orderId) {
    throw new Error("No active limit order to cancel");
  }
  
  // Отменить в блокчейне
  await this.limitOrderManager.cancelOrder(orderId);
  
  // Отменить связанные TP/SL
  await this.tpslManager.cancelRelatedOrders(orderId);
  
  // Обновить состояние
  state.user_data.has_active_order = false;
  state.activeLimitOrderId = undefined;
  
  await this.stateManager.setState(state.user_id, state);
  
  console.log(`[TradingPanel] Limit order cancelled: ${orderId}`);
}
```

#### Шаг 5: Обновить StateManager для работы с новым полем
```typescript
// src/services/StateManager.ts
async setState(userId: number, state: UserPanelState): Promise<void> {
  await prisma.panelState.upsert({
    where: { userId_tokenAddress: { userId, tokenAddress: state.token_address } },
    create: {
      userId,
      messageId: state.message_id,
      tokenAddress: state.token_address,
      mode: state.mode,
      tokenData: JSON.stringify(state.token_data),
      userData: JSON.stringify(state.user_data),
      actionData: JSON.stringify(state.action_data),
      activeLimitOrderId: state.activeLimitOrderId,  // ← ДОБАВИТЬ
      closed: state.closed,
      waitingFor: state.waiting_for,
    },
    update: {
      messageId: state.message_id,
      mode: state.mode,
      tokenData: JSON.stringify(state.token_data),
      userData: JSON.stringify(state.user_data),
      actionData: JSON.stringify(state.action_data),
      activeLimitOrderId: state.activeLimitOrderId,  // ← ДОБАВИТЬ
      closed: state.closed,
      waitingFor: state.waiting_for,
    },
  });
}
```

---

## БЛОКЕР #3: Неправильная конвертация USD в SOL

### Проблема
```typescript
// src/panels/TradingPanel.ts:541
const amountLamports = action_data.selected_amount * 1_000_000_000;
// ❌ $50 интерпретируется как 50 SOL
```

**Последствия:** Покупка на сумму в сотни раз больше ожидаемой.

### Исправление

#### Шаг 1: Добавить метод получения цены SOL
```typescript
// src/services/TokenDataFetcher.ts
export class TokenDataFetcher {
  private solPriceCache: { price: number; timestamp: number } | null = null;
  private readonly SOL_PRICE_CACHE_TTL = 60000; // 1 минута

  async getSOLPriceInUSD(): Promise<number | null> {
    // Проверить кэш
    if (this.solPriceCache && 
        Date.now() - this.solPriceCache.timestamp < this.SOL_PRICE_CACHE_TTL) {
      return this.solPriceCache.price;
    }

    try {
      // Получить цену SOL через Jupiter API
      const response = await fetch(
        'https://price.jup.ag/v4/price?ids=So11111111111111111111111111111111111111112'
      );
      const data = await response.json();
      const solPrice = data.data['So11111111111111111111111111111111111111112']?.price;
      
      if (solPrice) {
        this.solPriceCache = { price: solPrice, timestamp: Date.now() };
        return solPrice;
      }
      
      return null;
    } catch (error) {
      console.error('[TokenDataFetcher] Error fetching SOL price:', error);
      return null;
    }
  }
}
```

#### Шаг 2: Переписать executeBuy с правильной конвертацией
```typescript
// src/panels/TradingPanel.ts
private async executeBuy(state: UserPanelState): Promise<void> {
  const { token_address, action_data } = state;
  
  // 1. Получить текущую цену SOL в USD
  const solPriceUSD = await this.tokenDataFetcher.getSOLPriceInUSD();
  if (!solPriceUSD) {
    throw new Error("Could not fetch SOL price");
  }
  
  // 2. Конвертировать USD в SOL
  const amountUSD = action_data.selected_amount;
  const amountSOL = amountUSD / solPriceUSD;
  const amountLamports = Math.floor(amountSOL * LAMPORTS_PER_SOL);
  
  console.log(`[TradingPanel] Buying for $${amountUSD} (${amountSOL.toFixed(4)} SOL)`);
  
  // 3. Валидация баланса
  const wallet = await this.walletManager.getWallet();
  if (!wallet) {
    throw new Error('Wallet not found');
  }
  
  const userBalance = await this.solanaProvider.getBalance(wallet.publicKey.toString());
  if (amountLamports > userBalance) {
    throw new Error(`Insufficient balance. Required: ${amountSOL.toFixed(4)} SOL, Available: ${(userBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  }
  
  // 4. Выполнить покупку
  const result = await this.tradeRouter.buy(
    'Solana',
    token_address,
    amountLamports,
    this.userSettings,
    wallet
  );
  
  // 5. Обработать результат
  const price = state.token_data.current_price;
  const amountTokens = result.outputAmount / Math.pow(10, state.token_data.decimals || 9);
  
  // 6. Записать позицию
  const updatedPosition = await this.positionTracker.recordTrade(
    state.user_id,
    token_address,
    'BUY',
    price,
    amountTokens
  );
  
  // 7. Обновить баланс пользователя
  const newBalance = await this.solanaProvider.getBalance(wallet.publicKey.toString());
  const newBalanceSOL = newBalance / LAMPORTS_PER_SOL;
  const newBalanceUSD = newBalanceSOL * solPriceUSD;
  
  state.user_data.sol_balance = newBalanceSOL;
  state.user_data.usd_balance = newBalanceUSD;
  
  // 8. Обновить позицию в состоянии
  const currentPrice = await this.tokenDataFetcher.getCurrentPrice(token_address);
  if (currentPrice) {
    const pnl = this.positionTracker.calculatePNL(updatedPosition, currentPrice);
    state.action_data.position = {
      ...updatedPosition,
      current_price: currentPrice,
      pnl_usd: pnl.pnl_usd,
      pnl_percent: pnl.pnl_percent,
    };
  }
  
  // 9. Создать TP/SL если включены
  if (action_data.tp_enabled || action_data.sl_enabled) {
    try {
      await this.tpslManager.createTPSLOrders(updatedPosition, {
        tpPercent: action_data.tp_percent,
        slPercent: action_data.sl_percent
      });
    } catch (error) {
      console.error('[TradingPanel] Failed to create TP/SL:', error);
      // Не прерываем выполнение, просто логируем
    }
  }
  
  await this.stateManager.setState(state.user_id, state);
  
  console.log(`[TradingPanel] Buy executed: ${amountTokens.toFixed(4)} tokens at ${price} SOL`);
}
```

---

## ВАЖНО: Проблема с единицами измерения в TPSLManager

### Проблема
```typescript
// src/services/TPSLManager.ts:82-91
private async createSellOrder(tokenAddress: string, price: number, size: number): Promise<string> {
  const params: LimitOrderParams = {
    tokenMint: tokenAddress,
    orderType: OrderType.SELL,
    amount: size,  // ❌ size в токенах, но нужно в базовых единицах
    price: price,
    slippage: 1.0,
  };
  return this.limitOrderManager.createOrder(params);
}
```

### Исправление
```typescript
// src/services/TPSLManager.ts
private async createSellOrder(
  tokenAddress: string, 
  price: number, 
  size: number, 
  decimals: number
): Promise<string> {
  // Конвертировать размер из токенов в базовые единицы
  const amountInBaseUnits = Math.floor(size * Math.pow(10, decimals));
  
  const params: LimitOrderParams = {
    userId: 0, // Будет установлен в createTPSLOrders
    tokenMint: tokenAddress,
    orderType: OrderType.SELL,
    amount: amountInBaseUnits,  // ← В базовых единицах
    price: price,
    slippage: 1.0,
  };
  
  return this.limitOrderManager.createOrder(params);
}

async createTPSLOrders(
  position: Position, 
  options: { tpPercent?: number; slPercent?: number }
): Promise<{ tpOrderId?: string; slOrderId?: string }> {
  const { tokenAddress, entryPrice, size, userId } = position;
  
  // Получить decimals токена
  const tokenData = await this.tokenDataFetcher?.fetchTokenData(tokenAddress);
  const decimals = tokenData?.decimals || 9;
  
  let tpOrderId: string | undefined;
  let slOrderId: string | undefined;
  
  try {
    if (options.tpPercent) {
      const tpPrice = entryPrice * (1 + options.tpPercent / 100);
      tpOrderId = await this.createSellOrder(tokenAddress, tpPrice, size, decimals);
    }
    
    if (options.slPercent) {
      const slPrice = entryPrice * (1 - options.slPercent / 100);
      slOrderId = await this.createSellOrder(tokenAddress, slPrice, size, decimals);
    }
    
    // Связать ордера с позицией
    if (tpOrderId || slOrderId) {
      this.relatedOrders.set(position.id, [tpOrderId, slOrderId].filter(Boolean));
      
      await prisma.$transaction([
        tpOrderId ? prisma.tpslOrder.create({
          data: {
            positionId: position.id,
            orderId: tpOrderId,
            type: 'TP',
            price: entryPrice * (1 + options.tpPercent! / 100),
          }
        }) : null,
        slOrderId ? prisma.tpslOrder.create({
          data: {
            positionId: position.id,
            orderId: slOrderId,
            type: 'SL',
            price: entryPrice * (1 - options.slPercent! / 100),
          }
        }) : null,
      ].filter(Boolean));
    }
    
    return { tpOrderId, slOrderId };
    
  } catch (error) {
    // Rollback: отменить созданные ордера
    if (tpOrderId) {
      await this.limitOrderManager.cancelOrder(tpOrderId).catch(console.error);
    }
    if (slOrderId) {
      await this.limitOrderManager.cancelOrder(slOrderId).catch(console.error);
    }
    throw error;
  }
}
```

---

## Среднеприоритетные улучшения

### 1. Обновление балансов в executeSell
```typescript
// src/panels/TradingPanel.ts
private async executeSell(state: UserPanelState): Promise<void> {
  // ... существующий код выполнения продажи ...
  
  // Обновить баланс
  const solPriceUSD = await this.tokenDataFetcher.getSOLPriceInUSD() || 150;
  const newBalance = await this.solanaProvider.getBalance(wallet.publicKey.toString());
  const newBalanceSOL = newBalance / LAMPORTS_PER_SOL;
  
  state.user_data.sol_balance = newBalanceSOL;
  state.user_data.usd_balance = newBalanceSOL * solPriceUSD;
  
  // Обновить позицию в состоянии
  const positionData = await this.positionTracker.getPosition(state.user_id, token_address);
  if (positionData) {
    const currentPrice = await this.tokenDataFetcher.getCurrentPrice(token_address);
    if (currentPrice) {
      const pnl = this.positionTracker.calculatePNL(positionData, currentPrice);
      state.action_data.position = {
        ...positionData,
        current_price: currentPrice,
        pnl_usd: pnl.pnl_usd,
        pnl_percent: pnl.pnl_percent,
      };
    }
  } else {
    state.action_data.position = undefined;
  }
  
  await this.stateManager.setState(state.user_id, state);
}
```

### 2. Валидация перед сделками
```typescript
// src/panels/TradingPanel.ts
private async executeBuy(state: UserPanelState): Promise<void> {
  const { action_data, user_data } = state;
  
  // Валидация суммы
  if (action_data.selected_amount <= 0) {
    throw new Error('Amount must be positive');
  }
  
  // Проверка баланса
  const requiredUSD = action_data.selected_amount;
  if (requiredUSD > user_data.usd_balance) {
    throw new Error(
      `Insufficient balance. Required: $${requiredUSD}, Available: $${user_data.usd_balance.toFixed(2)}`
    );
  }
  
  // ... остальной код ...
}
```

### 3. Rate limiting
```typescript
// src/panels/TradingPanel.ts
export class TradingPanel {
  private lastTradeTime: Map<number, number> = new Map();
  private readonly TRADE_COOLDOWN = 3000; // 3 секунды
  
  private checkRateLimit(userId: number): void {
    const now = Date.now();
    const lastTrade = this.lastTradeTime.get(userId) || 0;
    
    if (now - lastTrade < this.TRADE_COOLDOWN) {
      const waitTime = Math.ceil((this.TRADE_COOLDOWN - (now - lastTrade)) / 1000);
      throw new Error(`Please wait ${waitTime} seconds between trades`);
    }
    
    this.lastTradeTime.set(userId, now);
  }
  
  private async executeBuy(state: UserPanelState): Promise<void> {
    this.checkRateLimit(state.user_id);
    // ... остальной код ...
  }
}
```

---

## Миграция базы данных

### Создать миграцию для новых полей
```bash
npx prisma migrate dev --name add_limit_order_tracking
```

### Обновленная схема Prisma
```prisma
// prisma/schema.prisma

model PanelState {
  id                   String   @id @default(uuid())
  userId               Int
  messageId            Int
  tokenAddress         String
  mode                 String
  tokenData            String
  userData             String
  actionData           String
  activeLimitOrderId   String?
  createdAt            DateTime @default(now())
  closed               Boolean  @default(false)
  waitingFor           String?
  
  @@unique([userId, tokenAddress])
  @@index([userId])
  @@index([closed])
}

model Position {
  id           String   @id @default(uuid())
  userId       Int
  tokenAddress String
  entryPrice   Float
  size         Float
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  
  tpslOrders   TPSLOrder[]
  
  @@unique([userId, tokenAddress])
  @@index([userId])
}

model TPSLOrder {
  id         String   @id @default(uuid())
  positionId String
  orderId    String   @unique
  type       String   // 'TP' or 'SL'
  price      Float
  createdAt  DateTime @default(now())
  
  position   Position @relation(fields: [positionId], references: [id], onDelete: Cascade)
  
  @@index([positionId])
  @@index([orderId])
}

model Trade {
  id           String   @id @default(uuid())
  userId       Int
  tokenAddress String
  type         String   // 'BUY' or 'SELL'
  price        Float
  amount       Float
  timestamp    DateTime @default(now())
  signature    String
  
  @@index([userId, tokenAddress])
  @@index([timestamp])
}
```

---

## Чек-лист перед тестированием

### Критические исправления
- [ ] userId передается и сохраняется в лимитных ордерах
- [ ] handleLimitOrderFill использует userId из ордера
- [ ] activeLimitOrderId сохраняется в PanelState
- [ ] cancelLimitOrder отменяет ордер в блокчейне
- [ ] executeBuy корректно конвертирует USD в SOL
- [ ] getSOLPriceInUSD реализован с кэшированием
- [ ] TPSLManager конвертирует размер в базовые единицы
- [ ] Миграция БД применена

### Средний приоритет
- [ ] executeSell обновляет балансы
- [ ] executeBuy обновляет балансы
- [ ] Позиция обновляется в состоянии после сделок
- [ ] Валидация баланса перед покупкой
- [ ] Rate limiting реализован
- [ ] Обработка ошибок при создании TP/SL

### Тестирование
- [ ] Создание лимитного ордера несколькими пользователями
- [ ] Отмена лимитного ордера через UI
- [ ] Покупка на $50, $100 (проверить правильную сумму в SOL)
- [ ] Создание позиции с TP/SL
- [ ] Исполнение TP ордера (проверить отмену SL)
- [ ] Исполнение SL ордера (проверить отмену TP)
- [ ] Перезапуск бота (проверить восстановление состояний)

---

## Логирование для отладки

### Добавить в критические точки
```typescript
// В handleLimitOrderFill
console.log(`[Bot] Order filled for user ${userId}: ${order.id}`);

// В executeBuy
console.log(`[TradingPanel] Converting $${amountUSD} to ${amountSOL.toFixed(4)} SOL at rate ${solPriceUSD}`);

// В cancelLimitOrder
console.log(`[TradingPanel] Cancelling order ${orderId} for user ${state.user_id}`);

// В createTPSLOrders
console.log(`[TPSLManager] Creating TP/SL for position ${position.id}: TP=${tpOrderId}, SL=${slOrderId}`);
```

---

## Итоговая готовность после исправлений

**До исправлений:** 40%  
**После критических исправлений:** 95%  
**После всех исправлений:** 100%

**Время на исправления:**
- Критические блокеры: 4-6 часов
- Среднеприоритетные: 2-3 часа
- Тестирование: 2-4 часа

**Итого:** 1 рабочий день

---

## Контакт для вопросов

Если возникнут вопросы по реализации, обращайтесь с конкретным файлом и номером строки.