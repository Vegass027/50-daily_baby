# ТЗ: Миграция DEX бота с SQLite на Supabase PostgreSQL + Realtime

## 🎯 Цель проекта
Мигрировать Telegram DEX бот на Solana с локальной SQLite базы данных на облачную Supabase (PostgreSQL) с поддержкой Realtime subscriptions для мгновенного обновления данных без потери функциональности.

---

## 📋 Контекст проекта

### Текущее состояние:
- **База данных:** SQLite (`file:./prisma/dev.db`)
- **ORM:** Prisma
- **Хостинг:** Render (ephemeral filesystem - данные теряются при редеплое)
- **Пользователи:** 1 пользователь (разработчик)
- **Обновление данных:** Polling каждые 30 секунд

### Проблемы:
- ❌ При каждом деплое на Render данные об ордерах/позициях теряются
- ❌ Медленное обновление UI (30 секунд задержка)
- ❌ Нет персистентного хранилища

### Желаемое состояние:
- ✅ Персистентная БД в облаке (Supabase PostgreSQL)
- ✅ Realtime обновления (мгновенное обновление UI при изменении данных)
- ✅ Сохранение всех данных при редеплое
- ✅ Интервал polling уменьшен до 3-5 секунд или полностью заменен на Realtime

---

## 🔧 Технические требования

### 1. Настройка Supabase

#### 1.1 Создание проекта
- Создать новый проект в Supabase
- **Регион:** EU Central (eu-central-1) - Frankfurt (ближайший к пользователю)
- **План:** Free tier (достаточно для одного пользователя)

#### 1.2 Получить credentials
Необходимо получить и сохранить:
```env
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
SUPABASE_URL=https://[project-ref].supabase.co
SUPABASE_ANON_KEY=eyJhbGc...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc... (для server-side)
```

**Где найти:**
- `DATABASE_URL`: Settings → Database → Connection String → URI (Transaction mode)
- `SUPABASE_URL`: Settings → API → Project URL
- `SUPABASE_ANON_KEY`: Settings → API → Project API keys → anon public
- `SUPABASE_SERVICE_ROLE_KEY`: Settings → API → Project API keys → service_role (секретный!)

---

### 2. Изменения в Prisma Schema

#### 2.1 Обновить `prisma/schema.prisma`

**ВАЖНО: Удалить адаптер для SQLite!**

```prisma
datasource db {
  provider = "postgresql"  // БЫЛО: "sqlite"
  url      = env("DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

// Все модели остаются БЕЗ ИЗМЕНЕНИЙ
// Prisma автоматически адаптирует типы для PostgreSQL

// ВАЖНЫЕ ИЗМЕНЕНИЯ В ТИПАХ:
model UserPanelState {
  userId              BigInt    @id  // БЫЛО: Int, теперь BigInt для Telegram IDs
  messageId           Int
  tokenAddress        String
  mode                PanelMode
  tokenData           String    // JSON as string - одинаково для обеих БД
  userData            String
  actionData          String
  activeLimitOrderId  String?
  waitingFor          String?
  closed              Boolean   @default(false)
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
}

model Position {
  id           String        @id @default(cuid())
  userId       BigInt        // БЫЛО: Int, теперь BigInt
  tokenAddress String
  entryPrice   Float
  size         Float
  trades       Trade[]
  linkedOrders LinkedOrder[]
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt

  @@unique([userId, tokenAddress])
}

// Trade и LinkedOrder остаются без изменений
```

#### 2.2 Важные изменения типов (автоматические)
Prisma автоматически конвертирует:
- `INTEGER` (SQLite) → `SERIAL/INTEGER` (PostgreSQL)
- `REAL` (SQLite) → `DOUBLE PRECISION` (PostgreSQL)
- `TEXT` (SQLite) → `TEXT/VARCHAR` (PostgreSQL)
- `BLOB` (SQLite) → `BYTEA` (PostgreSQL)

**Проверить особые типы:**
- `BigInt` для `userId` - должен быть `@db.BigInt` в PostgreSQL
- `DateTime` поля - автоматически используют `TIMESTAMP`
- JSON поля (если есть) - используют `JSONB` в PostgreSQL

---

### 3. Миграция базы данных

#### 3.1 Создание миграции

```bash
# 1. Удалить старые SQLite миграции (опционально)
rm -rf prisma/migrations

# 2. Создать новую миграцию для PostgreSQL
npx prisma migrate dev --name init_postgresql

# 3. Сгенерировать Prisma Client
npx prisma generate
```

#### 3.2 Для продакшена (Render)

```bash
# В package.json добавить postinstall скрипт:
"scripts": {
  "postinstall": "prisma generate",
  "build": "tsc",
  "start": "node dist/bot.js",
  "dev": "tsx watch src/bot.ts",
  "migrate:deploy": "prisma migrate deploy"
}
```

**На Render настроить:**
- Build Command: `npm install && npm run migrate:deploy && npm run build`
- Start Command: `npm start`

---

### 4. Установка Supabase SDK

#### 4.1 Установить зависимости

```bash
npm install @supabase/supabase-js
```

#### 4.2 Создать Supabase client

**Файл: `src/services/SupabaseClient.ts`**
```typescript
import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY! // Server-side

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
}

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false, // Server-side - не нужна сессия
  },
  realtime: {
    params: {
      eventsPerSecond: 10, // Лимит событий для free tier
    },
  },
})

export default supabase
```

---

### 5. Реализация Realtime Subscriptions

#### 5.1 Какие таблицы слушать

Приоритет для Realtime (критичные для UI):
1. **Order** - ордера (лимитные, TP/SL)
2. **Position** - открытые позиции
3. **Trade** - история сделок
4. **UserPanelState** - состояние панели пользователя

#### 5.2 Создать Realtime сервис

**Файл: `src/services/RealtimeService.ts`**
```typescript
import { RealtimeChannel } from '@supabase/supabase-js'
import supabase from './SupabaseClient'
import { EventEmitter } from 'events'

export type RealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE'

export interface RealtimePayload<T = any> {
  eventType: RealtimeEvent
  new: T
  old: T
  table: string
}

class RealtimeService extends EventEmitter {
  private channels: Map<string, RealtimeChannel> = new Map()

  /**
   * Подписка на изменения таблицы Order
   */
  subscribeToOrders(callback: (payload: RealtimePayload) => void) {
    const channel = supabase
      .channel('orders-changes')
      .on(
        'postgres_changes',
        {
          event: '*', // INSERT, UPDATE, DELETE
          schema: 'public',
          table: 'Order',
        },
        (payload) => {
          console.log('[Realtime] Order changed:', payload)
          callback({
            eventType: payload.eventType as RealtimeEvent,
            new: payload.new,
            old: payload.old,
            table: 'Order',
          })
        }
      )
      .subscribe((status) => {
        console.log(`[Realtime] Orders subscription status: ${status}`)
      })

    this.channels.set('orders', channel)
    return channel
  }

  /**
   * Подписка на изменения таблицы Position
   */
  subscribeToPositions(callback: (payload: RealtimePayload) => void) {
    const channel = supabase
      .channel('positions-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'Position',
        },
        (payload) => {
          console.log('[Realtime] Position changed:', payload)
          callback({
            eventType: payload.eventType as RealtimeEvent,
            new: payload.new,
            old: payload.old,
            table: 'Position',
          })
        }
      )
      .subscribe((status) => {
        console.log(`[Realtime] Positions subscription status: ${status}`)
      })

    this.channels.set('positions', channel)
    return channel
  }

  /**
   * Подписка на изменения таблицы Trade
   */
  subscribeToTrades(callback: (payload: RealtimePayload) => void) {
    const channel = supabase
      .channel('trades-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT', // Только новые сделки
          schema: 'public',
          table: 'Trade',
        },
        (payload) => {
          console.log('[Realtime] Trade created:', payload)
          callback({
            eventType: 'INSERT',
            new: payload.new,
            old: payload.old,
            table: 'Trade',
          })
        }
      )
      .subscribe((status) => {
        console.log(`[Realtime] Trades subscription status: ${status}`)
      })

    this.channels.set('trades', channel)
    return channel
  }

  /**
   * Отписаться от всех каналов
   */
  async unsubscribeAll() {
    for (const [name, channel] of this.channels) {
      await supabase.removeChannel(channel)
      console.log(`[Realtime] Unsubscribed from ${name}`)
    }
    this.channels.clear()
  }

  /**
   * Отписаться от конкретного канала
   */
  async unsubscribe(channelName: string) {
    const channel = this.channels.get(channelName)
    if (channel) {
      await supabase.removeChannel(channel)
      this.channels.delete(channelName)
      console.log(`[Realtime] Unsubscribed from ${channelName}`)
    }
  }
}

export const realtimeService = new RealtimeService()
export default realtimeService
```

---

### 6. Интеграция Realtime в существующие сервисы

#### 6.1 Обновить `AutoRefreshService.ts`

**Стратегия:**
- Заменить polling на Realtime для критичных данных
- Оставить fallback polling на случай потери соединения
- Уменьшить интервал polling до 5 секунд (вместо 30)

```typescript
import realtimeService from './RealtimeService'

class AutoRefreshService {
  private refreshIntervals: Map<number, NodeJS.Timeout> = new Map()
  private useRealtime: boolean = true // Флаг использования Realtime
  private realtimeConnected: boolean = false

  async initialize() {
    console.log('[AutoRefreshService] Initializing...')
    
    // Подключить Realtime subscriptions
    if (this.useRealtime) {
      await this.setupRealtimeSubscriptions()
    }

    // Запустить fallback polling (реже, как backup)
    this.startFallbackPolling()
  }

  private async setupRealtimeSubscriptions() {
    try {
      // Подписка на ордера
      realtimeService.subscribeToOrders(async (payload) => {
        this.realtimeConnected = true
        await this.handleOrderChange(payload)
      })

      // Подписка на позиции
      realtimeService.subscribeToPositions(async (payload) => {
        await this.handlePositionChange(payload)
      })

      // Подписка на сделки
      realtimeService.subscribeToTrades(async (payload) => {
        await this.handleTradeChange(payload)
      })

      console.log('[AutoRefreshService] Realtime subscriptions active')
    } catch (error) {
      console.error('[AutoRefreshService] Realtime setup failed:', error)
      this.useRealtime = false // Fallback to polling only
    }
  }

  private async handleOrderChange(payload: RealtimePayload) {
    console.log('[AutoRefreshService] Order changed via Realtime:', payload.eventType)
    
    // Обновить UI для всех активных панелей с ордерами
    const activePanels = await this.getActivePanelsWithOrders()
    
    for (const panel of activePanels) {
      await this.refreshPanelForUser(panel.userId, 'orders')
    }
  }

  private async handlePositionChange(payload: RealtimePayload) {
    console.log('[AutoRefreshService] Position changed via Realtime:', payload.eventType)
    
    // Обновить UI для всех активных панелей с позициями
    const activePanels = await this.getActivePanelsWithPositions()
    
    for (const panel of activePanels) {
      await this.refreshPanelForUser(panel.userId, 'positions')
    }
  }

  private async handleTradeChange(payload: RealtimePayload) {
    console.log('[AutoRefreshService] New trade via Realtime')
    
    // Отправить уведомление о новой сделке
    await this.notifyUserAboutTrade(payload.new)
  }

  private startFallbackPolling() {
    // Polling каждые 5 секунд (вместо 30) как backup
    // Если Realtime работает, этот polling будет просто страховкой
    const FALLBACK_INTERVAL = this.useRealtime ? 10000 : 5000 // 10s с Realtime, 5s без
    
    setInterval(async () => {
      if (!this.realtimeConnected && this.useRealtime) {
        console.warn('[AutoRefreshService] Realtime disconnected, using polling')
      }
      
      // Обновить только если Realtime не работает
      if (!this.useRealtime || !this.realtimeConnected) {
        await this.pollAllActivePanels()
      }
    }, FALLBACK_INTERVAL)
  }

  // ... остальные методы без изменений
}
```

#### 6.2 Обновить `TradingPanel.ts`

Добавить индикатор Realtime соединения:

```typescript
async renderPanel(userId: number) {
  const realtimeStatus = realtimeService.isConnected() ? '🟢 Live' : '🟡 Polling'
  
  const message = `
👑 Панель управления ${realtimeStatus}

━━━━━━━━━━━━━━━━━━

📊 Статус: ✅ Активен
...
  `
  
  // ... rest of rendering
}
```

---

### 7. Настройка Row Level Security (RLS) в Supabase

#### 7.1 Включить RLS для таблиц

**В Supabase Dashboard:**
1. Table Editor → выбрать таблицу
2. RLS → Enable RLS
3. Add Policy

**Для server-side доступа (service_role key) RLS НЕ нужен** - он автоматически bypass RLS.

#### 7.2 Policies (если планируешь добавить web UI в будущем)

```sql
-- Политика для Order: пользователь видит только свои ордера
CREATE POLICY "Users can view own orders"
ON "Order"
FOR SELECT
USING (auth.uid()::text = "userId"::text);

-- Политика для Position: пользователь видит только свои позиции
CREATE POLICY "Users can view own positions"
ON "Position"
FOR SELECT
USING (auth.uid()::text = "userId"::text);
```

**Но для текущей реализации (server-side bot) это НЕ обязательно** - используем service_role key.

---

### 8. Обновление кода для работы с PostgreSQL

#### 8.1 Обновить `PrismaClient.ts` - УДАЛИТЬ SQLite адаптер!

**Файл: `src/services/PrismaClient.ts`**
```typescript
import { PrismaClient } from '@prisma/client';

// УДАЛИТЬ импорт SQLite адаптера:
// import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

// Создаем PrismaClient БЕЗ адаптера (PostgreSQL работает напрямую)
export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'production'
    ? ['warn', 'error']
    : ['query', 'info', 'warn', 'error'],
  // adapter больше не нужен для PostgreSQL!
});

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});
```

#### 8.2 Обновить `StateManager.ts` - изменить типы userId

**Файл: `src/services/StateManager.ts`**

**КРИТИЧЕСКОЕ ИЗМЕНЕНИЕ:** userId теперь BigInt в PostgreSQL, но остается number в TypeScript.

```typescript
// В методе toAppState():
private toAppState(dbState: PrismaUserPanelState): UserPanelState {
  return {
    // ИЗМЕНЕНО: конвертируем BigInt -> number
    user_id: Number(dbState.userId), // PostgreSQL хранит как BigInt
    message_id: Number(dbState.messageId),
    token_address: dbState.tokenAddress,
    // ... остальное без изменений
  };
}

// В методе toDbData():
private toDbData(state: UserPanelState): Prisma.UserPanelStateCreateInput {
  return {
    userId: BigInt(state.user_id), // ИЗМЕНЕНО: конвертируем number -> BigInt
    messageId: state.message_id,
    tokenAddress: state.token_address,
    // ... остальное без изменений
  };
}

// В методе setState():
async setState(userId: number, state: UserPanelState): Promise<void> {
  try {
    const dataForDb = this.toDbData(state);
    const { userId: _, createdAt: __, ...updatePayload } = dataForDb;

    await prisma.userPanelState.upsert({
      where: { userId: BigInt(userId) }, // ИЗМЕНЕНО: конвертируем в BigInt
      update: updatePayload,
      create: {
        ...dataForDb,
        userId: BigInt(userId), // ИЗМЕНЕНО
      },
    });
  } catch (error) {
    console.error(`[StateManager] Error setting state for user ${userId}:`, error);
    throw error;
  }
}

// Аналогично для всех методов, где используется userId:
async getState(userId: number): Promise<UserPanelState | null> {
  const dbState = await prisma.userPanelState.findUnique({
    where: { userId: BigInt(userId) }, // ИЗМЕНЕНО
  });
  // ...
}

async deleteState(userId: number): Promise<void> {
  await prisma.userPanelState.delete({ 
    where: { userId: BigInt(userId) } // ИЗМЕНЕНО
  });
}

// И в updateJsonField тоже:
private async updateJsonField<T>(
  userId: number, 
  field: 'tokenData' | 'userData' | 'actionData', 
  data: Partial<T>
): Promise<void> {
  const currentState = await prisma.userPanelState.findUnique({
    where: { userId: BigInt(userId) }, // ИЗМЕНЕНО
    select: { [field]: true },
  });

  if (currentState) {
    const currentJson = JSON.parse(currentState[field] as string) || {};
    const newJson = { ...currentJson, ...data };

    await prisma.userPanelState.update({
      where: { userId: BigInt(userId) }, // ИЗМЕНЕНО
      data: { [field]: JSON.stringify(newJson) },
    });
  }
}
```

#### 8.3 Обновить `PositionTracker.ts` - изменить типы userId

```typescript
// В методе recordTrade():
async recordTrade(
  userId: number, // Остается number в TypeScript
  tokenAddress: string,
  type: 'BUY' | 'SELL',
  price: number,
  size: number
): Promise<Position> {
  // ...
  const result = await prisma.$transaction(async (tx) => {
    let position = await tx.position.findUnique({
      where: { 
        userId_tokenAddress: { 
          userId: BigInt(userId), // ИЗМЕНЕНО: конвертируем в BigInt
          tokenAddress 
        } 
      },
    });

    if (!position) {
      if (type === 'SELL') {
        throw new Error("Cannot sell a token you don't have a position in.");
      }
      position = await tx.position.create({
        data: {
          userId: BigInt(userId), // ИЗМЕНЕНО
          tokenAddress,
          entryPrice: 0,
          size: 0,
        },
      });
    }
    // ... остальное без изменений
  });
  // ...
}

// Аналогично для getPosition():
async getPosition(userId: number, tokenAddress: string): Promise<PositionData | null> {
  const position = await prisma.position.findUnique({
    where: {
      userId_tokenAddress: { 
        userId: BigInt(userId), // ИЗМЕНЕНО
        tokenAddress 
      },
      size: { gt: 0 }
    },
  });
  return position ? this.toPositionData(position) : null;
}

// И для getAllUserPositions():
async getAllUserPositions(userId: number): Promise<PositionData[]> {
  const dbPositions = await prisma.position.findMany({
    where: {
      userId: BigInt(userId), // ИЗМЕНЕНО
      size: { gt: 0 }
    }
  });
  return dbPositions.map(this.toPositionData);
}

// И для getTradeHistory():
async getTradeHistory(userId: number, tokenAddress: string): Promise<Trade[]> {
  const position = await prisma.position.findUnique({
    where: { 
      userId_tokenAddress: { 
        userId: BigInt(userId), // ИЗМЕНЕНО
        tokenAddress 
      } 
    },
    include: {
      trades: {
        orderBy: {
          timestamp: 'desc',
        },
      },
    },
  });
  return position ? position.trades : [];
}
```

#### 8.1 Локальная разработка (`.env`)

```env
# Database
DATABASE_URL="postgresql://postgres.[ref]:[password]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres"

# Supabase
SUPABASE_URL="https://[project-ref].supabase.co"
SUPABASE_ANON_KEY="eyJhbGc..."
SUPABASE_SERVICE_ROLE_KEY="eyJhbGc..."

# Telegram (без изменений)
TELEGRAM_BOT_TOKEN="..."
ALLOWED_USER_IDS="7295309649"

# Solana (без изменений)
SOLANA_RPC_URL="..."
WALLET_PRIVATE_KEY="..."
```

#### 8.2 Production (Render Environment Variables)

Добавить в Render Dashboard:
- `DATABASE_URL` = `postgresql://...`
- `SUPABASE_URL` = `https://...`
- `SUPABASE_SERVICE_ROLE_KEY` = `eyJhbGc...`
- (Остальные переменные без изменений)

**⚠️ ВАЖНО:** `SUPABASE_SERVICE_ROLE_KEY` - секретный ключ, НЕ коммитить в Git!

---

### 9. Тестирование

#### 9.1 Чек-лист тестирования

**Локальное тестирование:**
- [ ] База данных подключается к Supabase
- [ ] Prisma миграция успешна
- [ ] Создание ордера → запись в БД
- [ ] Realtime: изменение ордера → UI обновляется мгновенно
- [ ] Создание позиции → Realtime обновление
- [ ] Fallback polling работает при отключении Realtime
- [ ] Telegram команды работают без ошибок

**Production тестирование (Render):**
- [ ] Деплой успешен
- [ ] База данных подключается
- [ ] Данные НЕ теряются при редеплое
- [ ] Realtime subscriptions активны
- [ ] UI обновляется в реальном времени
- [ ] Нет утечек памяти (connections не накапливаются)

#### 9.2 Тестовый сценарий

```typescript
// Файл: src/tests/realtimeTest.ts

import prisma from './prisma'
import realtimeService from './services/RealtimeService'

async function testRealtime() {
  console.log('🧪 Starting Realtime test...')

  // Подписаться на ордера
  realtimeService.subscribeToOrders((payload) => {
    console.log('✅ Realtime event received:', payload)
  })

  // Подождать подключение
  await new Promise((resolve) => setTimeout(resolve, 2000))

  // Создать тестовый ордер
  const order = await prisma.order.create({
    data: {
      userId: 7295309649n,
      type: 'LIMIT',
      side: 'BUY',
      tokenAddress: 'So11111111111111111111111111111111111111112',
      amount: 1.0,
      price: 100.0,
      status: 'PENDING',
    },
  })

  console.log('📝 Order created:', order.id)

  // Подождать Realtime событие (должно прийти < 1 секунды)
  await new Promise((resolve) => setTimeout(resolve, 3000))

  // Обновить ордер
  await prisma.order.update({
    where: { id: order.id },
    data: { status: 'FILLED' },
  })

  console.log('✏️ Order updated')

  // Подождать Realtime событие
  await new Promise((resolve) => setTimeout(resolve, 3000))

  // Удалить ордер
  await prisma.order.delete({
    where: { id: order.id },
  })

  console.log('🗑️ Order deleted')
  console.log('✅ Test completed!')

  process.exit(0)
}

testRealtime()
```

Запустить:
```bash
npx tsx src/tests/realtimeTest.ts
```

Ожидаемый вывод:
```
✅ Realtime event received: { eventType: 'INSERT', new: {...}, table: 'Order' }
✅ Realtime event received: { eventType: 'UPDATE', new: {...}, table: 'Order' }
✅ Realtime event received: { eventType: 'DELETE', old: {...}, table: 'Order' }
```

---

### 10. Оптимизация и мониторинг

#### 10.1 Connection pooling

Supabase автоматически использует connection pooling через Supavisor (port 6543).

**Проверить в `DATABASE_URL`:**
```
postgresql://...pooler.supabase.com:6543/postgres
                    ^^^^^^            ^^^^
                  pooler mode       pooling port
```

#### 10.2 Мониторинг Realtime connections

```typescript
// В AutoRefreshService добавить:
private monitorRealtimeHealth() {
  setInterval(() => {
    const channelsCount = realtimeService.getActiveChannelsCount()
    console.log(`[Realtime] Active channels: ${channelsCount}`)
    
    // Alert если слишком много connections
    if (channelsCount > 10) {
      console.warn('[Realtime] Too many channels! Check for leaks.')
    }
  }, 60000) // Каждую минуту
}
```

#### 10.3 Graceful shutdown

```typescript
// В bot.ts добавить:
process.once('SIGINT', async () => {
  console.log('🛑 Shutting down gracefully...')
  
  // Отписаться от Realtime
  await realtimeService.unsubscribeAll()
  
  // Закрыть Prisma
  await prisma.$disconnect()
  
  // Остановить бота
  bot.stop('SIGINT')
  
  process.exit(0)
})

process.once('SIGTERM', async () => {
  console.log('🛑 Shutting down gracefully...')
  await realtimeService.unsubscribeAll()
  await prisma.$disconnect()
  bot.stop('SIGTERM')
  process.exit(0)
})
```

---

### 11. Откат (Rollback plan)

**Если что-то пошло не так:**

#### 11.1 Быстрый откат на SQLite

```prisma
// prisma/schema.prisma
datasource db {
  provider = "sqlite"
  url      = "file:./prisma/dev.db"
}
```

```bash
# Откатить миграции
npx prisma migrate reset

# Вернуть старую миграцию
git checkout HEAD~1 prisma/migrations
```

#### 11.2 Проблемы с Realtime

Отключить Realtime, оставить только Supabase PostgreSQL:

```typescript
// В AutoRefreshService.ts
private useRealtime: boolean = false // Отключить Realtime
```

Бот будет работать только на polling (5 секунд), но без мгновенных обновлений.

---

## 📊 Метрики успеха

После миграции должны быть достигнуты:

- ✅ **Персистентность:** Данные НЕ теряются при редеплое
- ✅ **Скорость UI:** Обновление < 2 секунд (Realtime) вместо 30 секунд
- ✅ **Надежность:** 99.9% uptime БД (гарантия Supabase)
- ✅ **Без изменений логики:** Весь код с `prisma.*` работает идентично
- ✅ **Мониторинг:** Логи Realtime events в консоли
- ✅ **Graceful shutdown:** Нет "висящих" connections

---

## 🚨 Важные предупреждения

### ⚠️ Безопасность

1. **НИКОГДА не коммитить** `SUPABASE_SERVICE_ROLE_KEY` в Git
2. Использовать `service_role` key только для server-side (bot)
3. Для будущего web UI использовать `anon` key + RLS policies

### ⚠️ Realtime limits (Free tier)

- **Max 200 concurrent connections** (тебе нужно 3-5, ОК)
- **Max 2 concurrent clients** (один бот = один client, ОК)
- **Events per second: 10** (более чем достаточно)

### ⚠️ PostgreSQL vs SQLite отличия

- `INTEGER PRIMARY KEY` не auto-increment в PostgreSQL → используй `SERIAL`
- `AUTOINCREMENT` не существует → используй `@default(autoincrement())`
- Prisma автоматически конвертирует, но проверь миграции!

---

## 📁 Структура файлов после миграции

```
DEX_BOT/
├── prisma/
│   ├── schema.prisma          # ✏️ provider = "postgresql"
│   ├── migrations/            # 🆕 Новые PostgreSQL миграции
│   │   └── 20241228_init_postgresql/
│   └── dev.db                 # ❌ Удалить (старый SQLite)
├── src/
│   ├── services/
│   │   ├── SupabaseClient.ts  # 🆕 Supabase connection
│   │   ├── RealtimeService.ts # 🆕 Realtime subscriptions
│   │   ├── AutoRefreshService.ts # ✏️ Добавить Realtime
│   │   ├── TradingPanel.ts    # ✏️ Показать Realtime статус
│   │   └── StateManager.ts    # ✅ Без изменений
│   ├── tests/
│   │   └── realtimeTest.ts    # 🆕 Тест Realtime
│   └── bot.ts                 # ✏️ Добавить graceful shutdown
├── .env                       # ✏️ Обновить DATABASE_URL + Supabase keys
├── .env.example               # 🆕 Шаблон для других разработчиков
└── package.json               # ✏️ Добавить @supabase/supabase-js
```

---

## 🎯 Чек-лист выполнения (для LLM разработчика)

### Фаза 1: Подготовка (10 минут)
- [ ] Создать проект в Supabase (регион EU Central)
- [ ] Скопировать DATABASE_URL, SUPABASE_URL, ключи
- [ ] Добавить в `.env` файл
- [ ] Создать `.env.example` без секретов

### Фаза 2: Prisma миграция (15 минут)
- [ ] **КРИТИЧНО:** Обновить `PrismaClient.ts` - УДАЛИТЬ SQLite адаптер
- [ ] **КРИТИЧНО:** Обновить `StateManager.ts` - конвертировать userId в BigInt
- [ ] **КРИТИЧНО:** Обновить `PositionTracker.ts` - конвертировать userId в BigInt
- [ ] Обновить `provider` в `schema.prisma` на `postgresql`
- [ ] Изменить тип `userId` с Int на BigInt в моделях UserPanelState и Position
- [ ] Удалить старые SQLite миграции: `rm -rf prisma/migrations`
- [ ] Создать новую миграцию: `npx prisma migrate dev --name init_postgresql`
- [ ] Проверить что все таблицы созданы в Supabase Dashboard
- [ ] Запустить `npx prisma generate`

### Фаза 3: Realtime (30 минут)
- [ ] Установить `@supabase/supabase-js`
- [ ] Создать `src/services/SupabaseClient.ts`
- [ ] Создать `src/services/RealtimeService.ts` со всеми subscriptions
- [ ] Добавить подписки: Orders, Positions, Trades
- [ ] Протестировать тестом `realtimeTest.ts`

### Фаза 4: Интеграция (20 минут)
- [ ] Обновить `AutoRefreshService.ts` с Realtime
- [ ] Добавить fallback polling (5 секунд)
- [ ] Обновить `TradingPanel.ts` с индикатором Realtime
- [ ] Добавить graceful shutdown в `bot.ts`
- [ ] Добавить мониторинг Realtime connections

### Фаза 5: Тестирование (15 минут)
- [ ] Запустить локально: `npm run dev`
- [ ] Создать ордер → проверить Realtime событие
- [ ] Обновить позицию → проверить UI обновление
- [ ] Остановить бот (Ctrl+C) → проверить graceful shutdown
- [ ] Проверить что нет висящих connections в Supabase

### Фаза 6: Production deploy (10 минут)
- [ ] Добавить переменные окружения в Render
- [ ] Обновить Build Command: `npm install && npx prisma migrate deploy && npm run build`
- [ ] Задеплоить на Render
- [ ] Проверить логи - нет ошибок подключения к БД
- [ ] Проверить что Realtime работает в production
- [ ] Сделать редеплой → проверить что данные НЕ потерялись ✅

---

## 📞 Поддержка и отладка

### Частые проблемы:

**1. "Connection refused" к Supabase**
- Проверь правильность DATABASE_URL
- Проверь что используешь pooler port (6543), не direct port (5432)
- Проверь firewall/сеть

**2. "Realtime subscriptions не работают"**
- Проверь что `SUPABASE_SERVICE_ROLE_KEY` правильный
- Проверь логи: должно быть "subscribed" status
- Проверь что таблицы существ