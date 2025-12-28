# 🚀 Деплой DEX бота на Render с Supabase PostgreSQL + Realtime

## 📋 Обзор

Этот документ описывает процесс деплоя Telegram DEX бота на Solana на платформу Render с использованием Supabase PostgreSQL базы данных и Realtime subscriptions для мгновенного обновления UI.

## ✅ Предварительные требования

### Необходимые сервисы:
- ✅ **Supabase проект** - уже создан (`ocgnklghukdpefnekzhy`)
- ✅ **GitHub репозиторий** - `https://github.com/Vegass027/50-daily_baby`
- ✅ **Render аккаунт** - бесплатный план достаточен

### Переменные окружения для Render:

```env
# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token
ALLOWED_TELEGRAM_USERS=7295309649

# Master password для шифрования кошельков
MASTER_PASSWORD=your_secure_password

# Solana RPC (Mainnet)
ALCHEMY_SOLANA_RPC="https://solana-mainnet.g.alchemy.com/v2/YOUR_API_KEY"
QUICKNODE_RPC_URL=""

# Jupiter API
JUPITER_API_KEY=your_jupiter_api_key
JUPITER_API_URL=https://api.jup.ag

# Сеть
SOLANA_NETWORK=mainnet-beta

# Настройки по умолчанию
DEFAULT_SPEED_STRATEGY=normal
DEFAULT_MEV_PROTECTION=true
DEFAULT_SLIPPAGE=1.0

# Webhook для алертов (Discord/Slack)
WEBHOOK_URL=https://discord.com/api/webhooks/xxx

# Dry-run mode (false для production)
DRY_RUN_MODE=false

# Database (Supabase PostgreSQL) - ОБЯЗАТЕЛЬНО!
DATABASE_URL="postgresql://postgres.ocgnklghukdpefnekzhy:YOUR_PASSWORD@aws-1-eu-west-1.pooler.supabase.com:6543/postgres"

# Supabase - ОБЯЗАТЕЛЬНО!
SUPABASE_URL="https://ocgnklghukdpefnekzhy.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

## 🐳 Docker Конфигурация

### Dockerfile (уже обновлен):

```dockerfile
# Используем официальный Node.js образ
FROM node:20-alpine

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем package files
COPY package*.json ./

# Устанавливаем зависимости (включая @prisma/adapter-pg для PostgreSQL)
RUN npm ci --only=production

# Копируем исходный код
COPY . .

# Собираем TypeScript
RUN npm run build

# Генерируем Prisma Client для PostgreSQL
RUN npx prisma generate

# Создаем директорию для данных
RUN mkdir -p /app/data

# Открываем порт (для health check, если нужно)
EXPOSE 3000

# Запускаем бота
CMD ["node", "dist/bot.js"]
```

### .dockerignore (уже создан):

```
# Node modules
node_modules/
npm-debug.log*

# Environment files
.env
.env.local
.env.*.local

# Git
.git/
.gitignore

# Build artifacts
dist/
*.tsbuildinfo

# Testing
coverage/
.nyc_output/

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Prisma (SQLite - больше не нужен)
prisma/dev.db
prisma/*.db
prisma/*.db-journal

# Logs
logs/
*.log
```

## 📦 Деплой на Render

### Способ 1: Через Render Dashboard (рекомендуется)

1. **Создать новый Web Service:**
   - Перейти на https://dashboard.render.com
   - Нажать "New +"
   - Выбрать "Web Service"
   - Connect GitHub репозиторий: `Vegass027/50-daily_baby`

2. **Настроить Build & Deploy:**
   - **Name:** `solana-dex-bot`
   - **Region:** Frankfurt (eu-west-1) - ближе к Supabase
   - **Branch:** `main`
   - **Root Directory:** `/`
   - **Runtime:** `Node 20`
   - **Build Command:**
     ```
     npm install && npm run migrate:deploy && npm run build
     ```
   - **Start Command:**
     ```
     npm start
     ```

3. **Настроить Environment Variables:**
   Добавить следующие переменные (все обязательны!):
   
   ```
   TELEGRAM_BOT_TOKEN=your_bot_token
   ALLOWED_TELEGRAM_USERS=7295309649
   MASTER_PASSWORD=your_secure_password
   ALCHEMY_SOLANA_RPC=https://solana-mainnet.g.alchemy.com/v2/YOUR_API_KEY
   JUPITER_API_KEY=your_jupiter_api_key
   SOLANA_NETWORK=mainnet-beta
   DEFAULT_SPEED_STRATEGY=normal
   DEFAULT_MEV_PROTECTION=true
   DEFAULT_SLIPPAGE=1.0
   DRY_RUN_MODE=false
   DATABASE_URL=postgresql://postgres.ocgnklghukdpefnekzhy:YOUR_PASSWORD@aws-1-eu-west-1.pooler.supabase.com:6543/postgres
   SUPABASE_URL=https://ocgnklghukdpefnekzhy.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   ```

4. **Настроить Health Check (опционально):**
   - **Path:** `/`
   - **Interval:** `60s`
   - **Timeout:** `30s`

### Способ 2: Через Render CLI

```bash
# Установить Render CLI
npm install -g @render/cli

# Авторизоваться
render login

# Создать сервис
render create web-service --name solana-dex-bot \
  --region frankfurt \
  --repo https://github.com/Vegass027/50-daily_baby \
  --branch main \
  --runtime node20 \
  --build-cmd "npm install && npm run migrate:deploy && npm run build" \
  --start-cmd "npm start" \
  --env TELEGRAM_BOT_TOKEN=your_bot_token \
  --env ALLOWED_TELEGRAM_USERS=7295309649 \
  --env DATABASE_URL="postgresql://postgres.ocgnklghukdpefnekzhy:YOUR_PASSWORD@aws-1-eu-west-1.pooler.supabase.com:6543/postgres" \
  --env SUPABASE_URL="https://ocgnklghukdpefnekzhy.supabase.co" \
  --env SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
```

## 🔍 Проверка после деплоя

### 1. Проверить логи:
```bash
# Через Render Dashboard
# Logs → solana-dex-bot

# Или через CLI
render logs solana-dex-bot --tail
```

**Ожидаемые логи:**
```
🗄️ Connecting to database...
✅ Database connected
🚀 Starting bot initialization...
📡 Connecting to Solana provider...
✅ Solana provider connected
🔐 Loading wallet...
✅ Wallet loaded: ...
🎯 Initializing trading strategies...
✅ Trading strategies created
🔀 Initializing trade router...
✅ Trade router initialized.
📊 Initializing price monitor...
✅ Price monitor initialized.
📋 Initializing PumpFun limit order manager...
✅ PumpFun limit order manager initialized.
📋 Starting PumpFun order monitoring...
✅ PumpFun limit order manager initialized and monitoring started.
📋 Initializing Jupiter limit order manager...
✅ Jupiter limit order manager initialized.
📋 Starting Jupiter order monitoring...
✅ Jupiter limit order manager initialized and monitoring started.
🗄️ Initializing StateManager...
✅ StateManager initialized.
📊 Initializing TokenDataFetcher...
✅ TokenDataFetcher initialized.
📈 Initializing PositionTracker...
✅ PositionTracker initialized.
🎯 Initializing TPSLManager...
✅ TPSLManager initialized.
🎨 Initializing trading panel...
✅ Trading panel initialized.
🔄 Initializing AutoRefreshService...
✅ AutoRefreshService initialized.
✅ AutoRefreshService Realtime subscriptions initialized.
[Realtime] Orders subscription status: SUBSCRIBED
[Realtime] Positions subscription status: SUBSCRIBED
[Realtime] Trades subscription status: SUBSCRIBED
✅ AutoRefreshService linked to TradingPanel.
🔁 Restoring active panels...
✅ Active panels restored.
🤖 Launching Telegram bot...
✅ Bot running! Allowed users: [ 7295309649 ]
```

### 2. Проверить Realtime соединение:
В логах должно быть видно:
```
[Realtime] Orders subscription status: SUBSCRIBED
[Realtime] Positions subscription status: SUBSCRIBED
[Realtime] Trades subscription status: SUBSCRIBED
[Realtime] Active channels: 3
```

### 3. Проверить работу бота:
- Отправить `/start` - должно появиться приветственное сообщение
- Отправить адрес токена - должна открыться торговая панель с индикатором `🟢 Live`
- Создать лимитный ордер - должен появиться в БД и UI обновиться мгновенно

### 4. Проверить Supabase:
- Перейти в https://supabase.com/dashboard/project/ocgnklghukdpefnekzhy/database
- Проверить таблицы: Order, Position, Trade, UserPanelState, LinkedOrder
- Проверить Realtime: Database → Replication → supabase_realtime

## ⚠️ Возможные проблемы и решения

### Проблема 1: База данных не подключается

**Симптомы:**
```
Error: connect ECONNREFUSED 143.198.0.0:6543
```

**Решение:**
1. Проверить `DATABASE_URL` в Environment Variables
2. Убедиться что пароль правильный
3. Проверить что Supabase проект активен

### Проблема 2: Realtime не работает

**Симптомы:**
```
[Realtime] Orders subscription status: TIMED_OUT
[AutoRefreshService] Realtime disconnected, using polling
```

**Решение:**
1. Проверить что Realtime включен в Supabase Dashboard
   - Database → Replication → supabase_realtime
   - Убедиться что таблицы добавлены: Order, Position, Trade, UserPanelState, LinkedOrder

2. Проверить `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY`

### Проблема 3: Ошибка Prisma при деплое

**Симптомы:**
```
Error: PrismaClientValidationError: Using engine type "client" requires either "adapter" or "accelerateUrl"
```

**Решение:**
1. Убедиться что `@prisma/adapter-pg` установлен
2. Проверить что `PrismaClient` создан с адаптером в `src/services/PrismaClient.ts`

### Проблема 4: Данные теряются при редеплое

**Симптомы:**
После редеплоя все ордера и позиции исчезают

**Решение:**
1. Убедиться что используется Supabase PostgreSQL (не SQLite)
2. Проверить что `DATABASE_URL` указывает на Supabase (не на локальный файл)
3. Проверить что миграции применены: `npm run migrate:deploy`

## 📊 Мониторинг

### Логи в Render:
- Dashboard → solana-dex-bot → Logs
- Фильтрация по ключевым словам: `[Realtime]`, `[AutoRefreshService]`, `[Bot]`

### Метрики Realtime:
```
[Realtime] Active channels: 3
```
Если число каналов > 10, проверить на утечки.

### Supabase Dashboard:
- Database → Tables → Проверить данные
- Database → Replication → Проверить Realtime статус
- Logs → Проверить ошибки

## 🔄 Обновление после деплоя

### Обновление кода:
```bash
git pull origin main
npm install
npm run build
```

### Переразвертывание на Render:
```bash
git push origin main
```
Render автоматически запустит новый деплой.

## 🎯 Best Practices

1. **Использовать Dry Run сначала:**
   ```env
   DRY_RUN_MODE=true
   ```
   Тестировать все команды без реальных транзакций

2. **Мониторинг логов:**
   - Проверять логи каждые 5-10 минут после деплоя
   - Искать ошибки Realtime подключения

3. **Graceful Shutdown:**
   Бот автоматически отключает Realtime при SIGINT/SIGTERM
   Нет висящих соединений

4. **Backup данных:**
   Supabase автоматически делает бэкапы
   Данные НЕ теряются при редеплое

5. **Health Checks:**
   Настроить health check для автоматического перезапуска при падении

## 📚 Дополнительные ресурсы

- [Supabase Docs](https://supabase.com/docs)
- [Render Docs](https://render.com/docs)
- [Prisma Docs](https://www.prisma.io/docs)
- [Realtime Subscriptions](https://supabase.com/docs/guides/realtime)
