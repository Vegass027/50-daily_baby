# Отчет аудита торговой панели

**Дата:** 2025-01-XX  
**Версия:** 1.0  
**Автор:** Kilo Code

---

## Обзор

Проведен полный аудит реализации торговой панели с единым контекстом токена, включая:
- StateManager.ts
- TradingPanel.ts
- PositionTracker.ts
- TPSLManager.ts
- AutoRefreshService.ts
- Интеграцию с bot.ts
- Логику открытия/закрытия сделок

---

## 🔴 КРИТИЧЕСКИЕ ПРОБЛЕМЫ

### 1. Несовместимость типов в executeBuy()

**Файл:** `src/panels/TradingPanel.ts:555-562`

**Проблема:**
```typescript
const updatedPosition = await this.positionTracker.recordTrade(state.user_id, token_address, 'BUY', price, amountTokens);

if (action_data.tp_enabled || action_data.sl_enabled) {
    await this.tpslManager.createTPSLOrders(updatedPosition, {
        tpPercent: action_data.tp_percent,
        slPercent: action_data.sl_percent
    });
}
```

`recordTrade()` возвращает `Position` (Prisma модель), но `createTPSLOrders()` ожидает объект `Position` с полями `{ id, tokenAddress, entryPrice, size }`. Это может работать, но нет гарантии, что все необходимые поля присутствуют.

**Решение:**
```typescript
// Убедиться, что recordTrade возвращает все необходимые поля
const updatedPosition = await this.positionTracker.recordTrade(state.user_id, token_address, 'BUY', price, amountTokens);

if (action_data.tp_enabled || action_data.sl_enabled) {
    await this.tpslManager.createTPSLOrders(updatedPosition, {
        tpPercent: action_data.tp_percent,
        slPercent: action_data.sl_percent
    });
}
```

**Статус:** ✅ Работает, но нужно добавить валидацию

---

### 2. Несовместимость типов в executeSell()

**Файл:** `src/panels/TradingPanel.ts:608-620`

**Проблема:**
```typescript
const updatedPosition = await this.positionTracker.recordTrade(
    user_id,
    token_address,
    'SELL',
    token_data.current_price,
    amountToSellInTokenUnits
);

console.log(`[TradingPanel] Sell executed for ${action_data.selected_amount}% of position...`);
if (updatedPosition.size === 0) {
    console.log(`[TradingPanel] Position for ${token_address} closed.`);
    await this.tpslManager.cancelRelatedOrders(updatedPosition.id);
}
```

`updatedPosition` имеет тип `Position` (Prisma), и `cancelRelatedOrders()` ожидает `positionId: string`. Это работает, так как `Position.id` имеет тип `String` в схеме Prisma.

**Решение:**
✅ Работает корректно

**Статус:** ✅ Работает корректно

---

### 3. Использование ALLOWED_USERS[0] для исполнения лимитных ордеров

**Файл:** `src/bot.ts:462-470`

**Проблема:**
```typescript
// Для лимитных ордеров на покупку мы должны найти userId.
// Эта информация не хранится в ордере. Это серьезное упущение.
// Временное решение: предполагаем, что есть только один пользователь.
// TODO: Передавать userId в LimitOrderManager при создании ордера.
const userId = ALLOWED_USERS[0];
if (!userId) {
    console.error('[Bot] No user found to associate filled order with.');
    return;
}
```

Это критическая проблема для multi-user системы. Если в `ALLOWED_USERS` несколько пользователей, все лимитные ордера будут записываться первому пользователю.

**Решение:**
1. Добавить поле `userId` в `LimitOrderParams`
2. Хранить `userId` в ордере при создании
3. Использовать сохраненный `userId` при исполнении

**Статус:** 🔴 КРИТИЧЕСКАЯ - не работает с несколькими пользователями

---

### 4. Неправильные единицы измерения в TPSLManager.createSellOrder()

**Файл:** `src/services/TPSLManager.ts:82-91`

**Проблема:**
```typescript
private async createSellOrder(tokenAddress: string, price: number, size: number): Promise<string> {
    const params: LimitOrderParams = {
        tokenMint: tokenAddress,
        orderType: OrderType.SELL,
        amount: size,  // ← size в токенах, но LimitOrder ожидает в базовых единицах!
        price: price,
        slippage: 1.0,
    };
    return this.limitOrderManager.createOrder(params);
}
```

`size` передается в токенах (из `Position.size`), но `LimitOrderParams.amount` ожидает количество в базовых единицах (lamports для токена, учитывая decimals).

**Решение:**
```typescript
private async createSellOrder(tokenAddress: string, price: number, size: number, decimals: number = 9): Promise<string> {
    const amountInBaseUnits = Math.floor(size * Math.pow(10, decimals));
    const params: LimitOrderParams = {
        tokenMint: tokenAddress,
        orderType: OrderType.SELL,
        amount: amountInBaseUnits,
        price: price,
        slippage: 1.0,
    };
    return this.limitOrderManager.createOrder(params);
}
```

Или передавать `decimals` из `position`:
```typescript
// В createTPSLOrders:
if (tpPrice) {
    const tokenData = await this.tokenDataFetcher?.fetchTokenData(tokenAddress);
    const decimals = tokenData?.decimals || 9;
    tpOrderId = await this.createSellOrder(tokenAddress, tpPrice, size, decimals);
}
```

**Статус:** 🔴 КРИТИЧЕСКАЯ - ордера будут созданы с неправильным количеством

---

## 🟡 СЕРЬЕЗНЫЕ ПРОБЛЕМЫ

### 5. Не обновляется баланс пользователя после покупки

**Файл:** `src/panels/TradingPanel.ts:533-565`

**Проблема:**
После успешной покупки баланс пользователя (`user_data.sol_balance`, `user_data.usd_balance`) не обновляется в состоянии.

**Решение:**
```typescript
private async executeBuy(state: UserPanelState): Promise<void> {
    const { token_address, action_data } = state;
    
    const wallet = await this.walletManager.getWallet();
    if (!wallet) {
        throw new Error('Wallet not found');
    }
    
    const amountLamports = action_data.selected_amount * 1_000_000_000;
    const result = await this.tradeRouter.buy(
        'Solana',
        token_address,
        amountLamports,
        this.userSettings,
        wallet
    );
    
    const txSignature = result.signature;
    const price = state.token_data.current_price;
    const amountTokens = result.outputAmount / Math.pow(10, state.token_data.decimals || 9);

    const updatedPosition = await this.positionTracker.recordTrade(state.user_id, token_address, 'BUY', price, amountTokens);

    // Обновляем баланс пользователя
    const newSolBalance = await this.solanaProvider.getBalance(wallet.publicKey.toString());
    const newSolBalanceSOL = newSolBalance / LAMPORTS_PER_SOL;
    state.user_data.sol_balance = newSolBalanceSOL;
    state.user_data.usd_balance = newSolBalanceSOL * 150; // TODO: Получать актуальную цену SOL

    if (action_data.tp_enabled || action_data.sl_enabled) {
        await this.tpslManager.createTPSLOrders(updatedPosition, {
            tpPercent: action_data.tp_percent,
            slPercent: action_data.sl_percent
        });
    }

    console.log(`[TradingPanel] Buy executed: ${amountTokens} ${token_address} at ${price} SOL`);
}
```

**Статус:** 🟡 СЕРЬЕЗНАЯ - баланс не обновляется

---

### 6. Не обновляется баланс пользователя после продажи

**Файл:** `src/panels/TradingPanel.ts:567-621`

**Проблема:**
После успешной продажи баланс пользователя не обновляется в состоянии.

**Решение:**
```typescript
private async executeSell(state: UserPanelState): Promise<void> {
    // ... существующий код ...

    const result = await this.tradeRouter.sell(
        'Solana',
        token_address,
        amountToSellInBaseUnits,
        this.userSettings,
        wallet
    );

    const txSignature = result.signature;
    const receivedSol = result.outputAmount / LAMPORTS_PER_SOL;

    // ... существующий код ...

    // Обновляем баланс пользователя
    const newSolBalance = await this.solanaProvider.getBalance(wallet.publicKey.toString());
    const newSolBalanceSOL = newSolBalance / LAMPORTS_PER_SOL;
    state.user_data.sol_balance = newSolBalanceSOL;
    state.user_data.usd_balance = newSolBalanceSOL * 150;

    console.log(`[TradingPanel] Sell executed for ${action_data.selected_amount}% of position...`);
    // ... существующий код ...
}
```

**Статус:** 🟡 СЕРЬЕЗНАЯ - баланс не обновляется

---

### 7. Не обновляется position в состоянии после покупки

**Файл:** `src/panels/TradingPanel.ts:533-565`

**Проблема:**
После покупки `action_data.position` в состоянии не обновляется с новыми данными позиции.

**Решение:**
```typescript
private async executeBuy(state: UserPanelState): Promise<void> {
    // ... существующий код ...

    const updatedPosition = await this.positionTracker.recordTrade(state.user_id, token_address, 'BUY', price, amountTokens);

    // Обновляем позицию в состоянии
    const currentPrice = await this.tokenDataFetcher.getCurrentPrice(token_address);
    const positionData = await this.positionTracker.getPosition(state.user_id, token_address);
    if (positionData && currentPrice) {
        const pnl = this.positionTracker.calculatePNL(positionData, currentPrice);
        state.action_data.position = {
            ...positionData,
            current_price: currentPrice,
            pnl_usd: pnl.pnl_usd,
            pnl_percent: pnl.pnl_percent,
        };
    }

    // ... существующий код ...
}
```

**Статус:** 🟡 СЕРЬЕЗНАЯ - позиция в панели не обновляется

---

### 8. Не обновляется position в состоянии после продажи

**Файл:** `src/panels/TradingPanel.ts:567-621`

**Проблема:**
После продажи `action_data.position` в состоянии не обновляется.

**Решение:**
```typescript
private async executeSell(state: UserPanelState): Promise<void> {
    // ... существующий код ...

    const updatedPosition = await this.positionTracker.recordTrade(
        user_id,
        token_address,
        'SELL',
        token_data.current_price,
        amountToSellInTokenUnits
    );

    // Обновляем позицию в состоянии
    const currentPrice = await this.tokenDataFetcher.getCurrentPrice(token_address);
    const positionData = await this.positionTracker.getPosition(user_id, token_address);
    if (positionData && currentPrice) {
        const pnl = this.positionTracker.calculatePNL(positionData, currentPrice);
        state.action_data.position = {
            ...positionData,
            current_price: currentPrice,
            pnl_usd: pnl.pnl_usd,
            pnl_percent: pnl.pnl_percent,
        };
    } else {
        state.action_data.position = undefined;
    }

    console.log(`[TradingPanel] Sell executed for ${action_data.selected_amount}% of position...`);
    // ... существующий код ...
}
```

**Статус:** 🟡 СЕРЬЕЗНАЯ - позиция в панели не обновляется

---

### 9. Нет обработки ошибок при создании TP/SL ордеров

**Файл:** `src/panels/TradingPanel.ts:557-562`

**Проблема:**
Если создание TP/SL ордеров не удается, ошибка не обрабатывается, и пользователь не получает уведомление.

**Решение:**
```typescript
if (action_data.tp_enabled || action_data.sl_enabled) {
    try {
        await this.tpslManager.createTPSLOrders(updatedPosition, {
            tpPercent: action_data.tp_percent,
            slPercent: action_data.sl_percent
        });
        console.log(`[TradingPanel] TP/SL orders created for position ${updatedPosition.id}`);
    } catch (error) {
        console.error('[TradingPanel] Failed to create TP/SL orders:', error);
        // Не прерываем выполнение, просто логируем ошибку
        // Можно добавить уведомление пользователю
    }
}
```

**Статус:** 🟡 СЕРЬЕЗНАЯ - ошибки не обрабатываются

---

## 🟢 СРЕДНИЕ ПРОБЛЕМЫ

### 10. Не обновляется баланс пользователя в AutoRefreshService

**Файл:** `src/services/AutoRefreshService.ts:64-121`

**Проблема:**
При авто-обновлении панели баланс пользователя не обновляется.

**Решение:**
```typescript
async refreshPanel(userId: number): Promise<void> {
    try {
        const state = await this.stateManager.getState(userId);
        
        if (!state || state.closed) {
            this.stopAutoRefresh(userId);
            return;
        }

        // Обновляем данные токена
        const updatedTokenData = await this.tokenDataFetcher.fetchTokenData(state.token_address);
        
        if (updatedTokenData) {
            await this.stateManager.updateTokenData(userId, updatedTokenData);
            state.token_data = updatedTokenData;
        }

        // Обновляем баланс пользователя
        // TODO: Нужно добавить доступ к walletManager и solanaProvider
        // const wallet = await this.walletManager.getWallet();
        // if (wallet) {
        //     const solBalance = await this.solanaProvider.getBalance(wallet.publicKey.toString());
        //     const solBalanceSOL = solBalance / LAMPORTS_PER_SOL;
        //     state.user_data.sol_balance = solBalanceSOL;
        //     state.user_data.usd_balance = solBalanceSOL * 150;
        //     await this.stateManager.updateUserData(userId, state.user_data);
        // }

        // Обновляем состояние с новыми данными
        const updatedState = await this.stateManager.getState(userId);
        
        if (!updatedState) {
            this.stopAutoRefresh(userId);
            return;
        }

        // Генерируем новый текст панели через TradingPanel
        const newText = this.tradingPanel.generatePanelText(updatedState);
        const keyboard = this.tradingPanel.generateKeyboard(updatedState);
        
        // Обновляем сообщение в Telegram
        try {
            await this.bot.telegram.editMessageText(
                userId,
                updatedState.message_id,
                undefined,
                newText,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: keyboard,
                    },
                }
            );
        } catch (error) {
            // ... существующий код ...
        }
    } catch (error) {
        console.error(`[AutoRefreshService] Error refreshing panel for user ${userId}:`, error);
    }
}
```

**Статус:** 🟢 СРЕДНЯЯ - баланс не обновляется автоматически

---

### 11. Поле token_balance не используется

**Файл:** `src/types/panel.ts:17-22` и `src/bot.ts:400`

**Проблема:**
В `UserData` есть поле `token_balance`, но оно:
1. Не используется в логике
2. Не обновляется при покупках/продажах
3. Отображается как 0 в панели

**Решение:**
Либо удалить поле, либо реализовать его обновление:
```typescript
// В executeBuy:
state.user_data.token_balance = (state.user_data.token_balance || 0) + amountTokens;

// В executeSell:
state.user_data.token_balance = Math.max(0, (state.user_data.token_balance || 0) - amountToSellInTokenUnits);
```

**Статус:** 🟢 СРЕДНЯЯ - неиспользуемое поле

---

### 12. Нет валидации перед выполнением сделок

**Файл:** `src/panels/TradingPanel.ts:533-565, 567-621`

**Проблема:**
Нет проверок:
- Достаточно ли средств для покупки
- Достаточно ли токенов для продажи
- Корректность введенных данных

**Решение:**
```typescript
private async executeBuy(state: UserPanelState): Promise<void> {
    const { token_address, action_data, user_data } = state;
    
    // Валидация
    if (action_data.selected_amount <= 0) {
        throw new Error('Amount must be positive');
    }
    
    const requiredUSD = action_data.selected_amount;
    const availableUSD = user_data.usd_balance;
    
    if (requiredUSD > availableUSD) {
        throw new Error(`Insufficient balance. Required: $${requiredUSD}, Available: $${availableUSD.toFixed(2)}`);
    }
    
    // ... существующий код ...
}
```

**Статус:** 🟢 СРЕДНЯЯ - нет валидации

---

## 🔵 МИНОРНЫЕ ПРОБЛЕМЫ

### 13. Нет уведомлений пользователю в панели

**Файл:** `src/panels/TradingPanel.ts`

**Проблема:**
После выполнения сделок пользователь не получает уведомление в панели об успехе или ошибке.

**Решение:**
Добавить временные сообщения в текст панели или использовать `ctx.reply()` для уведомлений.

**Статус:** 🔵 МИНОРНАЯ - плохой UX

---

### 14. Нет логирования транзакций в файл

**Файл:** Все файлы

**Проблема:**
Транзакции логируются только в консоль, но не в файл.

**Решение:**
Добавить файловое логирование:
```typescript
import fs from 'fs';
import path from 'path';

const logFile = path.join(__dirname, '../../logs/trades.log');

function logTrade(data: any) {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${JSON.stringify(data)}\n`;
    fs.appendFileSync(logFile, logEntry);
}
```

**Статус:** 🔵 МИНОРНАЯ - нет файлового логирования

---

### 15. Нет rate limiting для сделок

**Файл:** `src/panels/TradingPanel.ts`

**Проблема:**
Нет защиты от частых сделок (как указано в ТЗ: "Rate limiting (макс 1 сделка в 3 секунды)")

**Решение:**
```typescript
private lastTradeTime: Map<number, number> = new Map();

private async executeBuy(state: UserPanelState): Promise<void> {
    const now = Date.now();
    const lastTrade = this.lastTradeTime.get(state.user_id) || 0;
    
    if (now - lastTrade < 3000) {
        throw new Error('Please wait 3 seconds between trades');
    }
    
    this.lastTradeTime.set(state.user_id, now);
    
    // ... существующий код ...
}
```

**Статус:** 🔵 МИНОРНАЯ - нет rate limiting

---

## ✅ ЧТО РАБОТАЕТ ХОРОШО

1. **StateManager.ts** - корректно управляет состояниями пользователей в БД
2. **PositionTracker.ts** - правильно рассчитывает среднюю цену входа и PNL
3. **TPSLManager.ts** - корректно создает и отменяет связанные ордера (за исключением проблемы с единицами измерения)
4. **AutoRefreshService.ts** - корректно обновляет панели каждые 5 секунд
5. **Интеграция с bot.ts** - правильно обрабатывает текстовые сообщения и callback queries
6. **Обработка ошибок в StateManager** - добавлена обработка ошибок
7. **Логика очистки состояний** - удаляются только закрытые состояния

---

## 📋 ПРИОРИТЕТ ИСПРАВЛЕНИЯ

### 🔴 Высокий приоритет (до тестирования):
1. **Проблема #4** - Неправильные единицы измерения в TPSLManager
2. **Проблема #3** - Использование ALLOWED_USERS[0] для лимитных ордеров

### 🟡 Средний приоритет (до релиза):
3. **Проблема #5** - Не обновляется баланс после покупки
4. **Проблема #6** - Не обновляется баланс после продажи
5. **Проблема #7** - Не обновляется position после покупки
6. **Проблема #8** - Не обновляется position после продажи
7. **Проблема #9** - Нет обработки ошибок при создании TP/SL

### 🟢 Низкий приоритет (после релиза):
8. **Проблема #10** - Не обновляется баланс в AutoRefreshService
9. **Проблема #11** - Поле token_balance не используется
10. **Проблема #12** - Нет валидации перед сделками

### 🔵 Очень низкий приоритет:
11. **Проблема #13** - Нет уведомлений в панели
12. **Проблема #14** - Нет файлового логирования
13. **Проблема #15** - Нет rate limiting

---

## 🎯 РЕКОМЕНДАЦИИ

### 1. Добавить интеграционные тесты
Создать тесты для:
- Открытия и закрытия позиций
- Создания и отмены TP/SL ордеров
- Авто-обновления панелей
- Многостраничной работы с несколькими пользователями

### 2. Добавить мониторинг
- Метрики: success rate, avg fee, total volume, uptime
- Алерты при ошибках
- Логирование всех транзакций в файл

### 3. Улучшить UX
- Добавить индикаторы загрузки
- Показывать пользователю результаты сделок

### 4. Улучшить безопасность
- Добавить rate limiting
- Валидировать все пользовательские вводы
- Проверять userId в callback queries

---

## 📊 СТАТИСТИКА

- **Критических проблем:** 4
- **Серьезных проблем:** 5
- **Средних проблем:** 3
- **Минорных проблем:** 3
- **Всего проблем:** 15

**Готовность к тестированию:** ~70% (после исправления критических проблем)

---

## 📝 ЗАКЛЮЧЕНИЕ

Реализация торговой панели в целом соответствует ТЗ, но есть несколько критических проблем, которые необходимо устранить перед тестированием:

1. **Неправильные единицы измерения в TP/SL ордерах** - это приведет к созданию ордеров с неправильным количеством
2. **Использование ALLOWED_USERS[0]** - это не работает с несколькими пользователями

После исправления этих проблем система будет готова к тестированию. Остальные проблемы можно устранить постепенно в процессе разработки.

---

**Дополнительные примечания:**
- Трейлинг стоп-лосс и трейлинг тейк-профит не реализованы (как указано в ТЗ)
- Используется Prisma + SQLite для хранения данных
- Авто-обновление панелей работает каждые 5 секунд
- Состояния пользователей хранятся в БД и восстанавливаются при перезапуске
