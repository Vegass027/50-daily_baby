# Техническое задание: Торговая панель DEX-бота в Telegram

## Обзор проекта

Необходимо разработать торговую панель для DEX-бота в Telegram, которая работает по принципу **единого контекста токена** с переключаемыми режимами работы. Панель реализуется через Telegram Bot API с использованием inline-кнопок и динамическим обновлением сообщений.

**Ключевое отличие:** Панель открывается автоматически, когда пользователь отправляет боту адрес контракта токена в чат (без команды `/trade`).

---

---

## Архитектура решения

### Принцип работы
Вся торговая панель — это **одно редактируемое сообщение** в Telegram с:
- Текстовым блоком (информация)
- Inline-клавиатурой (управление)

При любом действии пользователя:
1. Обрабатывается callback
2. Обновляется текст сообщения
3. Обновляется inline-клавиатура
4. **Контекст токена сохраняется в памяти сессии**

---

## Структура состояния (State)

Для каждого пользователя хранить:

```python
user_state = {
    "user_id": int,
    "message_id": int,  # ID сообщения с панелью
    "token_address": str,  # Адрес текущего токена
    "mode": str,  # "buy" | "sell" | "limit" | "track"
    "token_data": {
        "name": str,
        "ticker": str,
        "market_cap": float,
        "liquidity": float,
        "current_price": float
    },
    "user_data": {
        "sol_balance": float,
        "usd_balance": float,
        "has_active_order": bool
    },
    "action_data": {
        # Динамические данные для текущего режима
        "selected_amount": float,
        "slippage": float,
        "limit_price": float,
        "position": dict
    }
}
```

---

## Компоненты интерфейса

### 1. Текстовый блок (динамический)

Формируется функцией `generate_panel_text(user_state)` и включает:

#### Блок Header (всегда)
```
🪙 {token_name} ({ticker})
📝 {short_contract_address}
━━━━━━━━━━━━━━━━
```

#### Блок Token Info (всегда)
```
📊 Market Cap: ${market_cap}
💧 Liquidity: ${liquidity}
━━━━━━━━━━━━━━━━
```

#### Блок User Info (всегда)
```
💼 Balance: {sol_balance} SOL (${usd_balance})
📌 Active Order: {Yes/No}
━━━━━━━━━━━━━━━━
```

#### Блок Action Area (зависит от режима)

**Для режима Buy:**
```
💰 Quick Buy
Selected: ${amount} USD
Slippage: {slippage}%
```

**Для режима Sell:**
```
💸 Quick Sell
Amount: {amount} tokens
Slippage: {slippage}%
```

**Для режима Limit:**
```
⏳ Limit Order
Target Price: ${limit_price}
Amount: ${amount}
Status: {Active/Inactive}
```

**Для режима Track:**
```
📈 Position Tracking
Entry: ${entry_price}
Current: ${current_price}
Size: {position_size} tokens
PNL: ${pnl_usd} ({pnl_percent}%)
```

---

### 2. Inline-клавиатура (динамическая)

Генерируется функцией `generate_keyboard(user_state)`.

#### Режимная панель (всегда первая строка)
```
[✅ Buy] [Sell] [Limit] [Track]
```
- Активный режим: ✅ или подсветка через emoji
- Callback data: `mode:buy`, `mode:sell`, `mode:limit`, `mode:track`

#### Action-кнопки (зависят от режима)

**Для Buy/Sell:**
```
[$10] [$50] [$100]
[Slippage: 1%] [Gas: Auto]
[🟢 Execute Trade]
```

**Для Limit:**
```
[Set Price] [Set Amount]
[📍 Place Order] or [❌ Cancel Order]
```

**Для Track:**
```
[🔄 Refresh] [📊 Chart]
```

#### Универсальные кнопки (всегда последняя строка)
```
[🔄 Refresh Data] [❌ Close Panel]
```

---

## Логика работы

### Инициализация панели (КЛЮЧЕВОЕ ИЗМЕНЕНИЕ)

**Триггер:** Пользователь отправляет в чат текст, содержащий адрес контракта Solana

**Алгоритм определения адреса контракта:**
1. Получить текстовое сообщение от пользователя
2. Проверить, является ли текст валидным адресом Solana (base58, длина 32-44 символа)
3. Попытаться загрузить данные токена по этому адресу
4. Если данные получены — открыть панель
5. Если нет — игнорировать сообщение или показать ошибку

**Валидация адреса Solana:**
```python
import base58

def is_valid_solana_address(text: str) -> bool:
    """
    Проверяет, является ли строка валидным адресом Solana
    """
    try:
        # Убрать пробелы
        text = text.strip()
        
        # Проверить длину (обычно 32-44 символа)
        if len(text) < 32 or len(text) > 44:
            return False
        
        # Попытаться декодировать base58
        decoded = base58.b58decode(text)
        
        # Адрес Solana должен быть 32 байта
        if len(decoded) != 32:
            return False
            
        return True
    except:
        return False
```

**Процесс открытия панели:**

```python
async def handle_message(update, context):
    """
    Обработчик всех текстовых сообщений
    """
    text = update.message.text
    user_id = update.effective_user.id
    
    # Проверить, является ли это адресом контракта
    if not is_valid_solana_address(text):
        return  # Игнорировать, если это не адрес
    
    token_address = text.strip()
    
    # Показать индикатор загрузки
    loading_msg = await update.message.reply_text("⏳ Загрузка данных токена...")
    
    try:
        # Загрузить данные токена
        token_data = await fetch_token_data(token_address)
        
        if not token_data:
            await loading_msg.edit_text("❌ Токен не найден или некорректный адрес")
            return
        
        # Создать состояние пользователя
        user_state = create_user_state(
            user_id=user_id,
            token_address=token_address,
            token_data=token_data
        )
        
        # Заменить сообщение загрузки на панель
        await loading_msg.edit_text(
            text=generate_panel_text(user_state),
            reply_markup=generate_keyboard(user_state)
        )
        
        # Сохранить message_id
        user_state["message_id"] = loading_msg.message_id
        save_user_state(user_state)
        
    except Exception as e:
        logger.error(f"Error loading token: {e}")
        await loading_msg.edit_text("❌ Ошибка загрузки токена. Попробуйте снова.")
```

**Альтернативный вариант с автоматическим определением:**

Если пользователь отправляет сообщение, которое содержит адрес среди другого текста:

```python
import re

def extract_solana_address(text: str) -> str | None:
    """
    Извлекает адрес Solana из текста
    """
    # Паттерн для base58 адресов (буквы и цифры, без 0, O, I, l)
    pattern = r'\b[1-9A-HJ-NP-Za-km-z]{32,44}\b'
    
    matches = re.findall(pattern, text)
    
    for match in matches:
        if is_valid_solana_address(match):
            return match
    
    return None

async def handle_message(update, context):
    text = update.message.text
    
    # Попытаться извлечь адрес
    token_address = extract_solana_address(text)
    
    if not token_address:
        return  # Это обычное сообщение, не адрес
    
    # ... далее логика открытия панели
```

---

### Переключение режимов

**Callback pattern:** `mode:{mode_name}`

**Процесс:**
1. Получить текущее состояние пользователя
2. Изменить `user_state["mode"]`
3. Обновить текст и клавиатуру сообщения
4. **Контекст токена НЕ меняется**

```python
async def handle_mode_switch(update, context):
    query = update.callback_query
    new_mode = query.data.split(":")[1]
    
    user_state = get_user_state(query.from_user.id)
    user_state["mode"] = new_mode
    
    await query.edit_message_text(
        text=generate_panel_text(user_state),
        reply_markup=generate_keyboard(user_state)
    )
    
    save_user_state(user_state)
    await query.answer()  # Убрать "часики" загрузки
```

---

### Действия в режимах

#### Buy/Sell режим

**Callback patterns:**
- `amount:{value}` — выбор суммы
- `slippage:{value}` — настройка slippage
- `execute:buy` / `execute:sell` — выполнение сделки

**Процесс выполнения сделки:**
1. Показать предупреждение: "⏳ Processing..."
2. Создать транзакцию (Jupiter Swap API)
3. Подписать и отправить транзакцию
4. Ждать подтверждения
5. Обновить панель с результатом

```python
async def handle_execute_trade(update, context):
    query = update.callback_query
    user_state = get_user_state(query.from_user.id)
    
    # Показать процесс
    await query.answer("⏳ Processing trade...")
    
    try:
        # Выполнить swap
        tx_signature = await execute_swap(
            token_address=user_state["token_address"],
            amount=user_state["action_data"]["selected_amount"],
            slippage=user_state["action_data"]["slippage"],
            action=user_state["mode"]  # "buy" or "sell"
        )
        
        # Обновить состояние
        await refresh_user_balances(user_state)
        
        # Показать успех
        await query.answer(f"✅ Trade completed! TX: {tx_signature[:8]}...")
        
        # Обновить панель
        await query.edit_message_text(
            text=generate_panel_text(user_state),
            reply_markup=generate_keyboard(user_state)
        )
        
    except Exception as e:
        await query.answer(f"❌ Error: {str(e)}", show_alert=True)
```

---

#### Limit режим

**Callback patterns:**
- `limit:set_price` — открыть диалог установки цены
- `limit:set_amount` — открыть диалог установки суммы
- `limit:place` — разместить ордер
- `limit:cancel` — отменить ордер

**Установка цены через диалог:**

```python
async def handle_set_limit_price(update, context):
    query = update.callback_query
    user_state = get_user_state(query.from_user.id)
    
    # Установить флаг ожидания ввода
    user_state["waiting_for"] = "limit_price"
    save_user_state(user_state)
    
    await query.answer()
    await context.bot.send_message(
        chat_id=query.from_user.id,
        text="💵 Введите целевую цену в USD:"
    )

async def handle_text_input(update, context):
    """
    Обработчик текстовых вводов (цена, сумма)
    """
    user_state = get_user_state(update.effective_user.id)
    
    # Если не ждем ввода, проверяем на адрес токена
    if not user_state.get("waiting_for"):
        # Это может быть адрес токена
        await handle_message(update, context)
        return
    
    waiting_for = user_state["waiting_for"]
    
    if waiting_for == "limit_price":
        try:
            price = float(update.message.text)
            user_state["action_data"]["limit_price"] = price
            user_state["waiting_for"] = None
            
            # Обновить панель
            await context.bot.edit_message_text(
                chat_id=update.effective_user.id,
                message_id=user_state["message_id"],
                text=generate_panel_text(user_state),
                reply_markup=generate_keyboard(user_state)
            )
            
            await update.message.reply_text("✅ Цена установлена")
            
        except ValueError:
            await update.message.reply_text("❌ Некорректная цена")
```

**Процесс размещения ордера:**
1. Валидация параметров (цена, сумма)
2. Создание ордера в базе данных
3. Запуск фонового мониторинга цены
4. Обновление статуса в панели

```python
async def handle_place_limit_order(update, context):
    query = update.callback_query
    user_state = get_user_state(query.from_user.id)
    
    # Проверить, заполнены ли все параметры
    if not user_state["action_data"].get("limit_price"):
        await query.answer("⚠️ Сначала установите цену", show_alert=True)
        return
    
    if not user_state["action_data"].get("selected_amount"):
        await query.answer("⚠️ Сначала установите сумму", show_alert=True)
        return
    
    order = {
        "user_id": user_state["user_id"],
        "token_address": user_state["token_address"],
        "target_price": user_state["action_data"]["limit_price"],
        "amount": user_state["action_data"]["selected_amount"],
        "status": "active",
        "created_at": datetime.now()
    }
    
    # Сохранить ордер
    order_id = await create_limit_order(order)
    
    # Обновить состояние
    user_state["user_data"]["has_active_order"] = True
    user_state["action_data"]["order_id"] = order_id
    
    await query.answer("✅ Лимитный ордер размещен")
    
    # Обновить панель
    await query.edit_message_text(
        text=generate_panel_text(user_state),
        reply_markup=generate_keyboard(user_state)
    )
```

---

#### Track режим

**Callback patterns:**
- `track:refresh` — обновить данные позиции
- `track:chart` — показать график (опционально)

**Процесс отслеживания:**
1. Загрузить историю сделок пользователя
2. Рассчитать среднюю цену входа
3. Получить текущую цену токена
4. Рассчитать PNL
5. Отобразить результаты

```python
async def handle_track_mode(user_state):
    # Получить позицию пользователя
    position = await get_user_position(
        user_id=user_state["user_id"],
        token_address=user_state["token_address"]
    )
    
    if not position:
        user_state["action_data"]["position"] = None
        return
    
    # Рассчитать PNL
    current_price = user_state["token_data"]["current_price"]
    entry_value = position["entry_price"] * position["size"]
    current_value = current_price * position["size"]
    
    pnl_usd = current_value - entry_value
    pnl_percent = (pnl_usd / entry_value) * 100 if entry_value > 0 else 0
    
    user_state["action_data"]["position"] = {
        "entry_price": position["entry_price"],
        "current_price": current_price,
        "size": position["size"],
        "pnl_usd": pnl_usd,
        "pnl_percent": pnl_percent
    }
```

---

## Обновление данных

### Автоматическое обновление (websocket/polling)

Запустить фоновую задачу для каждой активной панели:

```python
async def auto_refresh_panel(user_state):
    """
    Автоматическое обновление панели каждые 5 секунд
    """
    while panel_is_active(user_state):
        try:
            # Обновить данные токена
            token_data = await fetch_token_data(user_state["token_address"])
            user_state["token_data"] = token_data
            
            # Обновить баланс пользователя
            await refresh_user_balances(user_state)
            
            # Если активен режим Track, обновить позицию
            if user_state["mode"] == "track":
                await handle_track_mode(user_state)
            
            # Обновить панель (только текст)
            await bot.edit_message_text(
                chat_id=user_state["user_id"],
                message_id=user_state["message_id"],
                text=generate_panel_text(user_state),
                reply_markup=generate_keyboard(user_state)
            )
            
        except Exception as e:
            logger.error(f"Auto-refresh error: {e}")
        
        await asyncio.sleep(5)  # Обновление каждые 5 секунд

def panel_is_active(user_state):
    """
    Проверить, активна ли панель
    """
    # Панель неактивна, если пользователь закрыл ее или прошло > 1 часа
    if user_state.get("closed"):
        return False
    
    created_at = user_state.get("created_at")
    if created_at and (datetime.now() - created_at).seconds > 3600:
        return False
    
    return True
```

### Ручное обновление

**Callback:** `refresh:data`

Принудительно обновить все данные панели.

```python
async def handle_refresh(update, context):
    query = update.callback_query
    user_state = get_user_state(query.from_user.id)
    
    await query.answer("🔄 Обновление...")
    
    # Обновить все данные
    token_data = await fetch_token_data(user_state["token_address"])
    user_state["token_data"] = token_data
    
    await refresh_user_balances(user_state)
    
    if user_state["mode"] == "track":
        await handle_track_mode(user_state)
    
    # Обновить панель
    await query.edit_message_text(
        text=generate_panel_text(user_state),
        reply_markup=generate_keyboard(user_state)
    )
```

---

## Обработка ошибок

### Критические ошибки
- **Невалидный адрес токена:** Показать ошибку, не создавать панель
- **Токен не найден:** "❌ Токен не найден. Проверьте адрес."
- **Недостаточно баланса:** Предупредить перед выполнением сделки
- **Ошибка RPC:** Показать сообщение "⚠️ Network error. Try again."
- **Транзакция не прошла:** Показать причину, откатить состояние

### Обработка в коде

```python
try:
    result = await execute_swap(...)
except InsufficientFundsError:
    await query.answer("❌ Недостаточно средств", show_alert=True)
except RPCError as e:
    await query.answer("⚠️ Ошибка сети. Попробуйте снова.", show_alert=True)
    logger.error(f"RPC error: {e}")
except TransactionError as e:
    await query.answer(f"❌ Транзакция не прошла: {e}", show_alert=True)
except Exception as e:
    logger.error(f"Trade error: {e}")
    await query.answer("❌ Ошибка выполнения сделки", show_alert=True)
```

---

## Безопасность

### Обязательные проверки
1. **Подтверждение сделок:** Для сумм > $100 показывать alert с подтверждением
2. **Rate limiting:** Ограничить частоту выполнения сделок (макс 1 в 3 секунды)
3. **Валидация callback data:** Проверять, что callback принадлежит пользователю
4. **Хранение приватных ключей:** Использовать шифрование (AES-256)
5. **Проверка адресов:** Валидировать все адреса контрактов перед использованием

```python
def validate_callback(query, user_state):
    """
    Проверить, что callback выполнен правильным пользователем
    """
    if query.from_user.id != user_state["user_id"]:
        raise PermissionError("Unauthorized callback")
    
    if query.message.message_id != user_state["message_id"]:
        raise ValueError("Invalid message context")

async def confirm_large_trade(query, amount_usd):
    """
    Запросить подтверждение для больших сумм
    """
    if amount_usd > 100:
        # Показать предупреждение
        await query.answer(
            f"⚠️ Вы собираетесь совершить сделку на ${amount_usd}. Подтвердите действие.",
            show_alert=True
        )
        # TODO: Добавить дополнительную кнопку подтверждения
```

---

## Оптимизация производительности

### Кэширование
- **Данные токенов:** Кэшировать на 30 секунд (Redis)
- **Балансы пользователей:** Кэшировать на 10 секунд
- **RPC calls:** Batch requests где возможно

```python
from functools import lru_cache
from datetime import datetime, timedelta

# Простой кэш в памяти
cache = {}

async def fetch_token_data_cached(token_address: str):
    """
    Загрузить данные токена с кэшированием
    """
    cache_key = f"token:{token_address}"
    
    if cache_key in cache:
        cached_data, cached_time = cache[cache_key]
        if datetime.now() - cached_time < timedelta(seconds=30):
            return cached_data
    
    # Загрузить данные
    data = await fetch_token_data(token_address)
    cache[cache_key] = (data, datetime.now())
    
    return data
```

### Минимизация API calls
- Обновлять только измененные части UI
- Использовать `edit_message_text` вместо отправки новых сообщений
- Группировать RPC запросы

---

## Структура проекта

```
dex_bot/
├── bot.py                 # Точка входа, регистрация хэндлеров
├── handlers/
│   ├── __init__.py
│   ├── message.py        # Обработка текстовых сообщений (адреса токенов)
│   ├── callbacks.py      # Обработка callback кнопок
│   └── commands.py       # Обработка команд (/start, /help)
├── ui/
│   ├── __init__.py
│   ├── panel.py          # Генерация текста панели
│   └── keyboards.py      # Генерация inline-клавиатур
├── blockchain/
│   ├── __init__.py
│   ├── solana.py         # Работа с Solana (валидация адресов)
│   ├── jupiter.py        # Jupiter Aggregator API
│   └── tokens.py         # Загрузка данных токенов
├── database/
│   ├── __init__.py
│   ├── models.py         # Модели данных (User, Order, Position)
│   └── repository.py     # CRUD операции
├── services/
│   ├── __init__.py
│   ├── state_manager.py  # Управление состояниями пользователей
│   ├── order_monitor.py  # Мониторинг лимитных ордеров
│   ├── price_tracker.py  # Отслеживание цен
│   └── auto_refresh.py   # Автоматическое обновление панелей
├── utils/
│   ├── __init__.py
│   ├── validation.py     # Валидация адресов и данных
│   ├── formatting.py     # Форматирование чисел, дат
│   └── cache.py          # Кэширование данных
├── config.py             # Конфигурация (API keys, настройки)
└── requirements.txt      # Зависимости проекта
```

---

## Пример работы бота

### Сценарий 1: Открытие панели

**Пользователь:**
```
4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R
```

**Бот (сначала):**
```
⏳ Загрузка данных токена...
```

**Бот (через 1-2 секунды):**
```
🪙 Raydium (RAY)
📝 4k3D...kX6R
━━━━━━━━━━━━━━━━
📊 Market Cap: $245M
💧 Liquidity: $12.5M
━━━━━━━━━━━━━━━━
💼 Balance: 2.45 SOL ($482)
📌 Active Order: No
━━━━━━━━━━━━━━━━
💰 Quick Buy
Selected: $50 USD
Slippage: 1%

[✅ Buy] [Sell] [Limit] [Track]
[$10] [$50] [$100]
[Slippage: 1%] [Gas: Auto]
[🟢 Execute Trade]
[🔄 Refresh] [❌ Close]
```

### Сценарий 2: Переключение на Sell

**Пользователь нажимает:** `[Sell]`

**Бот (моментально обновляет сообщение):**
```
🪙 Raydium (RAY)
📝 4k3D...kX6R
━━━━━━━━━━━━━━━━
📊 Market Cap: $245M
💧 Liquidity: $12.5M
━━━━━━━━━━━━━━━━
💼 Balance: 2.45 SOL ($482)
📌 Active Order: No
━━━━━━━━━━━━━━━━
💸 Quick Sell
Amount: 100% (250 RAY)
Slippage: 1%

[Buy] [✅ Sell] [Limit] [Track]
[25%] [50%] [100%]
[Slippage: 1%] [Gas: Auto]
[🔴 Execute Sell]
[🔄 Refresh] [❌ Close]
```

### Сценарий 3: Выполнение покупки

**Пользователь:**
1. Нажимает `[Buy]`
2. Нажимает `[$50]`
3. Нажимает `[🟢 Execute Trade]`

**Бот:**
```
⏳ Processing trade...
```

**Бот (через 3-5 секунд):**
```
✅ Trade completed! TX: a4b8c2d1...
```

**Бот обновляет панель с новыми балансами:**
```
🪙 Raydium (RAY)
📝 4k3D...kX6R
━━━━━━━━━━━━━━━━
📊 Market Cap: $245M
💧 Liquidity: $12.5M
━━━━━━━━━━━━━━━━
💼 Balance: 1.95 SOL ($384)
📌 Active Order: No
━━━━━━━━━━━━━━━━
💰 Quick Buy
Selected: $50 USD
Slippage: 1%

[✅ Buy] [Sell] [Limit] [Track]
[$10] [$50] [$100]
[Slippage: 1%] [Gas: Auto]
[🟢 Execute Trade]
[🔄 Refresh] [❌ Close]
```

### Сценарий 4: Открытие второго токена

Пользователь может отправить адрес другого токена — откроется вторая независимая панель.

---

## Функционал Take Profit и Stop Loss

### Концепция

Для **каждого типа ордера** (Market Buy/Sell, Limit) пользователь может установить:
- **Take Profit (TP)** — автоматическая продажа при достижении целевой прибыли
- **Stop Loss (SL)** — автоматическая продажа при достижении уровня убытка

**Важно:** TP/SL работают для позиций, созданных через бота. Бот отслеживает позиции и автоматически выполняет ордера при достижении целевых уровней.

---

### Расширение структуры состояния

```python
user_state = {
    "user_id": int,
    "message_id": int,
    "token_address": str,
    "mode": str,
    "token_data": {...},
    "user_data": {...},
    "action_data": {
        "selected_amount": float,
        "slippage": float,
        "limit_price": float,
        "position": dict,
        # НОВОЕ: TP/SL настройки
        "tp_enabled": bool,
        "tp_price": float,  # Целевая цена для Take Profit
        "tp_percent": float,  # Или процент прибыли (например, +20%)
        "sl_enabled": bool,
        "sl_price": float,  # Цена для Stop Loss
        "sl_percent": float,  # Или процент убытка (например, -10%)
    }
}
```

### Расширение модели Position в БД

```python
class Position:
    id: int
    user_id: int
    token_address: str
    entry_price: float
    size: float  # Количество токенов
    entry_value_usd: float  # Стоимость входа в USD
    created_at: datetime
    
    # TP/SL настройки
    tp_enabled: bool
    tp_price: float
    sl_enabled: bool
    sl_price: float
    
    # Статус
    status: str  # "active", "closed_tp", "closed_sl", "closed_manual"
    closed_at: datetime | None
    exit_price: float | None
    pnl_usd: float | None
```

---

### UI компоненты для TP/SL

#### 1. Блок настройки TP/SL (отображается во всех режимах)

Добавляется в `Action Area` каждого режима:

```
━━━━━━━━━━━━━━━━
🎯 Risk Management
Take Profit: {Enabled/Disabled} {price or %}
Stop Loss: {Enabled/Disabled} {price or %}
```

#### 2. Кнопки управления TP/SL

Добавляются в inline-клавиатуру **под основными кнопками действий**:

```
[🎯 Set TP] [🛡️ Set SL]
```

Когда TP или SL включены:

```
[✅ TP: $2.50] [✅ SL: $1.80]
```

При нажатии на активную кнопку — отключение или редактирование.

---

### Режим Buy с TP/SL

**Полный текст панели:**

```
🪙 Raydium (RAY)
📝 4k3D...kX6R
━━━━━━━━━━━━━━━━
📊 Market Cap: $245M
💧 Liquidity: $12.5M
Current Price: $2.15
━━━━━━━━━━━━━━━━
💼 Balance: 2.45 SOL ($482)
📌 Active Order: No
━━━━━━━━━━━━━━━━
💰 Quick Buy
Selected: $50 USD
Slippage: 1%
━━━━━━━━━━━━━━━━
🎯 Risk Management
Take Profit: ✅ $2.50 (+16.3%)
Stop Loss: ✅ $1.90 (-11.6%)
```

**Inline-клавиатура:**

```
[✅ Buy] [Sell] [Limit] [Track]
[$10] [$50] [$100]
[Slippage: 1%] [Gas: Auto]
[✅ TP: $2.50] [✅ SL: $1.90]
[🟢 Execute Trade]
[🔄 Refresh] [❌ Close]
```

---

### Режим Sell с TP/SL

Для режима **Sell** TP/SL работают наоборот:
- **Take Profit** — покупка обратно по более низкой цене (для шорт-позиций)
- **Stop Loss** — покупка обратно по более высокой цене при росте

**Примечание:** В DEX на Solana нет нативных шортов, поэтому для Sell режима TP/SL обычно **НЕ используются**. Но если бот поддерживает шорты через другие протоколы, логика аналогична.

**Рекомендация:** В режиме Sell показывать TP/SL только если есть **существующая long-позиция**.

---

### Режим Limit с TP/SL

**Полный текст панели:**

```
🪙 Raydium (RAY)
📝 4k3D...kX6R
━━━━━━━━━━━━━━━━
📊 Market Cap: $245M
💧 Liquidity: $12.5M
Current Price: $2.15
━━━━━━━━━━━━━━━━
💼 Balance: 2.45 SOL ($482)
📌 Active Order: No
━━━━━━━━━━━━━━━━
⏳ Limit Order
Target Price: $2.00
Amount: $50
Status: Not placed
━━━━━━━━━━━━━━━━
🎯 Risk Management (after execution)
Take Profit: ✅ $2.40 (+20%)
Stop Loss: ✅ $1.80 (-10%)
```

**Inline-клавиатура:**

```
[Buy] [Sell] [✅ Limit] [Track]
[Set Price: $2.00] [Set Amount: $50]
[✅ TP: $2.40] [✅ SL: $1.80]
[📍 Place Order]
[🔄 Refresh] [❌ Close]
```

**Важно:** TP/SL для лимитного ордера активируются **после его исполнения**.

---

### Режим Track с TP/SL

**Полный текст панели:**

```
🪙 Raydium (RAY)
📝 4k3D...kX6R
━━━━━━━━━━━━━━━━
📊 Market Cap: $245M
💧 Liquidity: $12.5M
Current Price: $2.28
━━━━━━━━━━━━━━━━
💼 Balance: 1.95 SOL ($384)
📌 Active Order: No
━━━━━━━━━━━━━━━━
📈 Position Tracking
Entry: $2.15
Current: $2.28
Size: 23.26 RAY
Value: $53.03
PNL: +$3.03 (+6.05%)
━━━━━━━━━━━━━━━━
🎯 Active Risk Management
Take Profit: ✅ $2.50 (9.6% to target)
Stop Loss: ✅ $1.90 (16.7% below)
```

**Inline-клавиатура:**

```
[Buy] [Sell] [Limit] [✅ Track]
[Edit TP: $2.50] [Edit SL: $1.90]
[🔴 Close Position] [📊 Chart]
[🔄 Refresh] [❌ Close Panel]
```

---

### Логика установки TP/SL

#### Callback patterns для TP/SL

```
tp_sl:set_tp          # Открыть диалог установки Take Profit
tp_sl:set_sl          # Открыть диалог установки Stop Loss
tp_sl:disable_tp      # Отключить Take Profit
tp_sl:disable_sl      # Отключить Stop Loss
tp_sl:mode:price      # Установка по цене
tp_sl:mode:percent    # Установка по проценту
```

#### Установка Take Profit

**Пользователь нажимает:** `[🎯 Set TP]`

**Бот отправляет отдельное сообщение:**

```
🎯 Take Profit Setup

Выберите способ установки:

[💵 By Price] [📊 By Percent]
[❌ Cancel]
```

**Если выбран "By Price":**

```python
async def handle_set_tp_price(update, context):
    query = update.callback_query
    user_state = get_user_state(query.from_user.id)
    
    user_state["waiting_for"] = "tp_price"
    save_user_state(user_state)
    
    await query.answer()
    await query.message.reply_text(
        "💵 Введите целевую цену для Take Profit в USD:\n"
        f"Текущая цена: ${user_state['token_data']['current_price']}"
    )
```

**Если выбран "By Percent":**

```python
async def handle_set_tp_percent(update, context):
    query = update.callback_query
    user_state = get_user_state(query.from_user.id)
    
    user_state["waiting_for"] = "tp_percent"
    save_user_state(user_state)
    
    await query.answer()
    await query.message.reply_text(
        "📊 Введите процент прибыли для Take Profit (например: 20 для +20%):\n"
        f"Текущая цена: ${user_state['token_data']['current_price']}"
    )
```

**Обработка ввода:**

```python
async def handle_tp_sl_input(update, context):
    user_state = get_user_state(update.effective_user.id)
    waiting_for = user_state.get("waiting_for")
    
    if waiting_for == "tp_price":
        try:
            tp_price = float(update.message.text)
            current_price = user_state["token_data"]["current_price"]
            
            # Валидация: TP должен быть выше текущей цены для long
            if tp_price <= current_price:
                await update.message.reply_text(
                    "⚠️ Take Profit должен быть выше текущей цены"
                )
                return
            
            # Рассчитать процент
            tp_percent = ((tp_price - current_price) / current_price) * 100
            
            user_state["action_data"]["tp_enabled"] = True
            user_state["action_data"]["tp_price"] = tp_price
            user_state["action_data"]["tp_percent"] = tp_percent
            user_state["waiting_for"] = None
            
            save_user_state(user_state)
            
            # Обновить панель
            await context.bot.edit_message_text(
                chat_id=user_state["user_id"],
                message_id=user_state["message_id"],
                text=generate_panel_text(user_state),
                reply_markup=generate_keyboard(user_state)
            )
            
            await update.message.reply_text(
                f"✅ Take Profit установлен: ${tp_price} (+{tp_percent:.1f}%)"
            )
            
        except ValueError:
            await update.message.reply_text("❌ Некорректная цена")
    
    elif waiting_for == "tp_percent":
        try:
            tp_percent = float(update.message.text)
            current_price = user_state["token_data"]["current_price"]
            
            # Валидация: TP должен быть положительным
            if tp_percent <= 0:
                await update.message.reply_text(
                    "⚠️ Процент должен быть положительным"
                )
                return
            
            # Рассчитать цену
            tp_price = current_price * (1 + tp_percent / 100)
            
            user_state["action_data"]["tp_enabled"] = True
            user_state["action_data"]["tp_price"] = tp_price
            user_state["action_data"]["tp_percent"] = tp_percent
            user_state["waiting_for"] = None
            
            save_user_state(user_state)
            
            # Обновить панель
            await context.bot.edit_message_text(
                chat_id=user_state["user_id"],
                message_id=user_state["message_id"],
                text=generate_panel_text(user_state),
                reply_markup=generate_keyboard(user_state)
            )
            
            await update.message.reply_text(
                f"✅ Take Profit установлен: ${tp_price:.4f} (+{tp_percent}%)"
            )
            
        except ValueError:
            await update.message.reply_text("❌ Некорректный процент")
```

#### Установка Stop Loss

Логика аналогична Take Profit, но с валидацией:
- SL должен быть **ниже** текущей цены для long-позиций
- Процент должен быть отрицательным или вводиться как положительное число с учетом убытка

```python
async def handle_sl_input(update, context):
    user_state = get_user_state(update.effective_user.id)
    waiting_for = user_state.get("waiting_for")
    
    if waiting_for == "sl_price":
        try:
            sl_price = float(update.message.text)
            current_price = user_state["token_data"]["current_price"]
            
            # Валидация: SL должен быть ниже текущей цены для long
            if sl_price >= current_price:
                await update.message.reply_text(
                    "⚠️ Stop Loss должен быть ниже текущей цены"
                )
                return
            
            # Рассчитать процент (будет отрицательным)
            sl_percent = ((sl_price - current_price) / current_price) * 100
            
            user_state["action_data"]["sl_enabled"] = True
            user_state["action_data"]["sl_price"] = sl_price
            user_state["action_data"]["sl_percent"] = sl_percent
            user_state["waiting_for"] = None
            
            save_user_state(user_state)
            
            await context.bot.edit_message_text(
                chat_id=user_state["user_id"],
                message_id=user_state["message_id"],
                text=generate_panel_text(user_state),
                reply_markup=generate_keyboard(user_state)
            )
            
            await update.message.reply_text(
                f"✅ Stop Loss установлен: ${sl_price} ({sl_percent:.1f}%)"
            )
            
        except ValueError:
            await update.message.reply_text("❌ Некорректная цена")
    
    elif waiting_for == "sl_percent":
        try:
            sl_percent_input = float(update.message.text)
            current_price = user_state["token_data"]["current_price"]
            
            # Принимаем как положительное число (10 = -10%)
            if sl_percent_input <= 0:
                await update.message.reply_text(
                    "⚠️ Введите положительное число (например: 10 для -10%)"
                )
                return
            
            # Конвертируем в отрицательный процент
            sl_percent = -sl_percent_input
            
            # Рассчитать цену
            sl_price = current_price * (1 + sl_percent / 100)
            
            user_state["action_data"]["sl_enabled"] = True
            user_state["action_data"]["sl_price"] = sl_price
            user_state["action_data"]["sl_percent"] = sl_percent
            user_state["waiting_for"] = None
            
            save_user_state(user_state)
            
            await context.bot.edit_message_text(
                chat_id=user_state["user_id"],
                message_id=user_state["message_id"],
                text=generate_panel_text(user_state),
                reply_markup=generate_keyboard(user_state)
            )
            
            await update.message.reply_text(
                f"✅ Stop Loss установлен: ${sl_price:.4f} ({sl_percent}%)"
            )
            
        except ValueError:
            await update.message.reply_text("❌ Некорректный процент")
```

---

### Выполнение сделок с TP/SL

#### Market Buy с TP/SL

Когда пользователь нажимает `[🟢 Execute Trade]`:

```python
async def handle_execute_buy_with_tp_sl(update, context):
    query = update.callback_query
    user_state = get_user_state(query.from_user.id)
    
    await query.answer("⏳ Executing trade...")
    
    try:
        # 1. Выполнить покупку
        tx_result = await execute_swap(
            token_address=user_state["token_address"],
            amount_usd=user_state["action_data"]["selected_amount"],
            slippage=user_state["action_data"]["slippage"],
            action="buy"
        )
        
        # 2. Создать позицию в БД
        position = await create_position(
            user_id=user_state["user_id"],
            token_address=user_state["token_address"],
            entry_price=tx_result["execution_price"],
            size=tx_result["tokens_received"],
            entry_value_usd=user_state["action_data"]["selected_amount"],
            tp_enabled=user_state["action_data"].get("tp_enabled", False),
            tp_price=user_state["action_data"].get("tp_price"),
            sl_enabled=user_state["action_data"].get("sl_enabled", False),
            sl_price=user_state["action_data"].get("sl_price")
        )
        
        # 3. Запустить мониторинг TP/SL
        if position.tp_enabled or position.sl_enabled:
            await start_tp_sl_monitor(position.id)
        
        # 4. Обновить балансы
        await refresh_user_balances(user_state)
        
        # 5. Показать результат
        await query.answer(
            f"✅ Buy completed!\n"
            f"Price: ${tx_result['execution_price']}\n"
            f"Amount: {tx_result['tokens_received']} tokens",
            show_alert=True
        )
        
        # 6. Обновить панель
        await query.edit_message_text(
            text=generate_panel_text(user_state),
            reply_markup=generate_keyboard(user_state)
        )
        
    except Exception as e:
        await query.answer(f"❌ Error: {str(e)}", show_alert=True)
```

#### Limit Order с TP/SL

Когда пользователь размещает лимитный ордер:

```python
async def handle_place_limit_with_tp_sl(update, context):
    query = update.callback_query
    user_state = get_user_state(query.from_user.id)
    
    # Создать лимитный ордер
    limit_order = await create_limit_order(
        user_id=user_state["user_id"],
        token_address=user_state["token_address"],
        target_price=user_state["action_data"]["limit_price"],
        amount_usd=user_state["action_data"]["selected_amount"],
        tp_enabled=user_state["action_data"].get("tp_enabled", False),
        tp_price=user_state["action_data"].get("tp_price"),
        sl_enabled=user_state["action_data"].get("sl_enabled", False),
        sl_price=user_state["action_data"].get("sl_price")
    )
    
    # Запустить мониторинг лимитного ордера
    await start_limit_order_monitor(limit_order.id)
    
    await query.answer("✅ Лимитный ордер размещен с TP/SL")
```

Когда лимитный ордер исполняется:

```python
async def on_limit_order_executed(limit_order):
    """
    Вызывается когда лимитный ордер исполнен
    """
    # Создать позицию
    position = await create_position(
        user_id=limit_order.user_id,
        token_address=limit_order.token_address,
        entry_price=limit_order.execution_price,
        size=limit_order.tokens_received,
        entry_value_usd=limit_order.amount_usd,
        tp_enabled=limit_order.tp_enabled,
        tp_price=limit_order.tp_price,
        sl_enabled=limit_order.sl_enabled,
        sl_price=limit_order.sl_price
    )
    
    # Запустить мониторинг TP/SL
    if position.tp_enabled or position.sl_enabled:
        await start_tp_sl_monitor(position.id)
    
    # Уведомить пользователя
    await send_notification(
        user_id=limit_order.user_id,
        text=f"✅ Лимитный ордер исполнен!\n"
             f"Токен: {position.token_address[:8]}...\n"
             f"Цена: ${position.entry_price}\n"
             f"Размер: {position.size} tokens"
    )
```

---

### Мониторинг TP/SL (фоновый процесс)

**Сервис `tp_sl_monitor.py`:**

```python
import asyncio
from datetime import datetime

class TPSLMonitor:
    """
    Мониторинг Take Profit и Stop Loss для активных позиций
    """
    
    def __init__(self):
        self.active_monitors = {}  # position_id -> Task
    
    async def start_monitor(self, position_id: int):
        """
        Запустить мониторинг для позиции
        """
        if position_id in self.active_monitors:
            return  # Уже мониторится
        
        task = asyncio.create_task(self._monitor_position(position_id))
        self.active_monitors[position_id] = task
    
    async def stop_monitor(self, position_id: int):
        """
        Остановить мониторинг позиции
        """
        if position_id in self.active_monitors:
            task = self.active_monitors[position_id]
            task.cancel()
            del self.active_monitors[position_id]
    
    async def _monitor_position(self, position_id: int):
        """
        Основной цикл мониторинга позиции
        """
        try:
            while True:
                # Загрузить позицию
                position = await get_position(position_id)
                
                if not position or position.status != "active":
                    break  # Позиция закрыта или не найдена
                
                # Получить текущую цену
                current_price = await get_token_price(position.token_address)
                
                # Проверить Take Profit
                if position.tp_enabled and current_price >= position.tp_price:
                    await self._execute_take_profit(position, current_price)
                    break
                
                # Проверить Stop Loss
                if position.sl_enabled and current_price <= position.sl_price:
                    await self._execute_stop_loss(position, current_price)
                    break
                
                # Подождать перед следующей проверкой
                await asyncio.sleep(2)  # Проверка каждые 2 секунды
                
        except asyncio.CancelledError:
            pass  # Мониторинг остановлен
        except Exception as e:
            logger.error(f"Error monitoring position {position_id}: {e}")
        finally:
            if position_id in self.active_monitors:
                del self.active_monitors[position_id]
    
    async def _execute_take_profit(self, position, current_price: float):
        """
        Выполнить Take Profit (продажа)
        """
        try:
            # Выполнить продажу
            tx_result = await execute_swap(
                token_address=position.token_address,
                amount_tokens=position.size,
                action="sell",
                slippage=1.0  # Можно использовать настройки пользователя
            )
            
            # Рассчитать PNL
            exit_value = tx_result["usd_received"]
            pnl_usd = exit_value - position.entry_value_usd
            
            # Закрыть позицию
            await close_position(
                position_id=position.id,
                exit_price=tx_result["execution_price"],
                pnl_usd=pnl_usd,
                status="closed_tp"
            )
            
            # Уведомить пользователя
            await send_notification(
                user_id=position.user_id,
                text=f"🎯 Take Profit сработал!\n"
                     f"Токен: {position.token_address[:8]}...\n"
                     f"Цена выхода: ${tx_result['execution_price']}\n"
                     f"PNL: ${pnl_usd:+.2f} ({(pnl_usd/position.entry_value_usd)*100:+.1f}%)\n"
                     f"TX: {tx_result['signature'][:8]}..."
            )
            
        except Exception as e:
            logger.error(f"Error executing TP for position {position.id}: {e}")
            await send_notification(
                user_id=position.user_id,
                text=f"⚠️ Ошибка выполнения Take Profit: {str(e)}"
            )
    
    async def _execute_stop_loss(self, position, current_price: float):
        """
        Выполнить Stop Loss (продажа)
        """
        try:
            # Выполнить продажу
            tx_result = await execute_swap(
                token_address=position.token_address,
                amount_tokens=position.size,
                action="sell",
                slippage=2.0  # Более высокий slippage для SL
            )
            
            # Рассчитать PNL
            exit_value = tx_result["usd_received"]
            pnl_usd = exit_value - position.entry_value_usd
            
            # Закрыть позицию
            await close_position(
                position_id=position.id,
                exit_price=tx_result["execution_price"],
                pnl_usd=pnl_usd,
                status="closed_sl"
            )
            
            # Уведомить пользователя
            await send_notification(
                user_id=position.user_id,
                text=f"🛡️ Stop Loss сработал!\n"
                     f"Токен: {position.token_address[:8]}...\n"
                     f"Цена выхода: ${tx_result['execution_price']}\n"
                     f"PNL: ${pnl_usd:+.2f} ({(pnl_usd/position.entry_value_usd)*100:+.1f}%)\n"
                     f"TX: {tx_result['signature'][:8]}..."
            )
            
        except Exception as e:
            logger.error(f"Error executing SL for position {position.id}: {e}")
            await send_notification(
                user_id=position.user_id,
                text=f"⚠️ Ошибка выполнения Stop Loss: {str(e)}"
            )

# Глобальный экземпляр монитора
tp_sl_monitor = TPSLMonitor()
```

---

### Обновление генератора текста панели

```python
def generate_panel_text(user_state: dict) -> str:
    """
    Генерация текста торговой панели
    """
    token = user_state["token_data"]
    user = user_state["user_data"]
    action = user_state["action_data"]
    mode = user_state["mode"]
    
    # Header (всегда)
    text = f"🪙 {token['name']} ({token['ticker']})\n"
    text += f"📝 {shorten_address(user_state['token_address'])}\n"
    text += "━━━━━━━━━━━━━━━━\n"
    
    # Token Info (всегда)
    text += f"📊 Market Cap: ${format_number(token['market_cap'])}\n"
    text += f"💧 Liquidity: ${format_number(token['liquidity'])}\n"
    text += f"💰 Current Price: ${token['current_price']:.4f}\n"
    text += "━━━━━━━━━━━━━━━━\n"
    
    # User Info (всегда)
    text += f"💼 Balance: {user['sol_balance']:.2f} SOL (${user['usd_balance']:.2f})\n"
    text += f"📌 Active Order: {'Yes' if user['has_active_order'] else 'No'}\n"
    text += "━━━━━━━━━━━━━━━━\n"
    
    # Action Area (зависит от режима)
    if mode == "buy":
        text += "💰 Quick Buy\n"
        text += f"Selected: ${action['selected_amount']} USD\n"
        text += f"Slippage: {action['slippage']}%\n"
    
    elif mode == "sell":
        text += "💸 Quick Sell\n"
        text += f"Amount: {action.get('sell_percent', 100)}% "
        if action.get('token_balance'):
            text += f"({action['token_balance']} tokens)\n"
        else:
            text += "\n"
        text += f"Slippage: {action['slippage']}%\n"
    
    elif mode == "limit":
        text += "⏳ Limit Order\n"
        text += f"Target Price: ${action.get('limit_price', 'Not set')}\n"
        text += f"Amount: ${action.get('selected_amount', 'Not set')}\n"
        if action.get('order_status'):
            text += f"Status: {action['order_status']}\n"
    
    elif mode == "track":
        text += "📈 Position Tracking\n"
        position = action.get('position')
        if position:
            text += f"Entry: ${position['entry_price']:.4f}\n"
            text += f"Current: ${position['current_price']:.4f}\n"
            text += f"Size: {position['size']:.2f} tokens\n"
            text += f"Value: ${position['size'] * position['current_price']:.2f}\n"
            pnl_emoji = "🟢" if position['pnl_usd'] >= 0 else "🔴"
            text += f"PNL: {pnl_emoji} ${position['pnl_usd']:+.2f} ({position['pnl_percent']:+.2f}%)\n"
        else:
            text += "No active position for this token\n"
    
    # TP/SL Block (всегда, если настроено)
    if action.get('tp_enabled') or action.get('sl_enabled'):
        text += "━━━━━━━━━━━━━━━━\n"
        text += "🎯 Risk Management\n"
        
        if action.get('tp_enabled'):
            tp_price = action['tp_price']
            tp_percent = action['tp_percent']
            
            # Рассчитать расстояние до TP
            if mode == "track" and action.get('position'):
                current = action['position']['current_price']
                distance = ((tp_price - current) / current) * 100
                text += f"Take Profit: ✅ ${tp_price:.4f} ({distance:+.1f}% to target)\n"
            else:
                text += f"Take Profit: ✅ ${tp_price:.4f} (+{tp_percent:.1f}%)\n"
        else:
            text += "Take Profit: ❌ Not set\n"
        
        if action.get('sl_enabled'):
            sl_price = action['sl_price']
            sl_percent = action['sl_percent']
            
            # Рассчитать расстояние до SL
            if mode == "track" and action.get('position'):
                current = action['position']['current_price']
                distance = ((current - sl_price) / current) * 100
                text += f"Stop Loss: ✅ ${sl_price:.4f} ({distance:.1f}% below)\n"
            else:
                text += f"Stop Loss: ✅ ${sl_price:.4f} ({sl_percent:.1f}%)\n"
        else:
            text += "Stop Loss: ❌ Not set\n"
    
    return text


def generate_keyboard(user_state: dict) -> InlineKeyboardMarkup:
    """
    Генерация inline-клавиатуры
    """
    mode = user_state["mode"]
    action = user_state["action_data"]
    
    keyboard = []
    
    # Строка 1: Режимы
    mode_row = []
    modes = {
        "buy": "✅ Buy" if mode == "buy" else "Buy",
        "sell": "✅ Sell" if mode == "sell" else "Sell",
        "limit": "✅ Limit" if mode == "limit" else "Limit",
        "track": "✅ Track" if mode == "track" else "Track"
    }
    
    for mode_key, mode_label in modes.items():
        mode_row.append(
            InlineKeyboardButton(mode_label, callback_data=f"mode:{mode_key}")
        )
    keyboard.append(mode_row)
    
    # Строки 2-N: Кнопки действий (зависят от режима)
    if mode == "buy":
        # Строка выбора суммы
        amount_row = []
        for amount in [10, 50, 100]:
            label = f"${amount}"
            if action.get('selected_amount') == amount:
                label = f"✅ {label}"
            amount_row.append(
                InlineKeyboardButton(label, callback_data=f"amount:{amount}")
            )
        keyboard.append(amount_row)
        
        # Строка настроек
        settings_row = [
            InlineKeyboardButton(
                f"Slippage: {action.get('slippage', 1)}%",
                callback_data="settings:slippage"
            ),
            InlineKeyboardButton("Gas: Auto", callback_data="settings:gas")
        ]
        keyboard.append(settings_row)
        
        # Строка TP/SL
        tp_sl_row = []
        if action.get('tp_enabled'):
            tp_sl_row.append(
                InlineKeyboardButton(
                    f"✅ TP: ${action['tp_price']:.2f}",
                    callback_data="tp_sl:edit_tp"
                )
            )
        else:
            tp_sl_row.append(
                InlineKeyboardButton("🎯 Set TP", callback_data="tp_sl:set_tp")
            )
        
        if action.get('sl_enabled'):
            tp_sl_row.append(
                InlineKeyboardButton(
                    f"✅ SL: ${action['sl_price']:.2f}",
                    callback_data="tp_sl:edit_sl"
                )
            )
        else:
            tp_sl_row.append(
                InlineKeyboardButton("🛡️ Set SL", callback_data="tp_sl:set_sl")
            )
        keyboard.append(tp_sl_row)
        
        # Кнопка выполнения
        keyboard.append([
            InlineKeyboardButton("🟢 Execute Buy", callback_data="execute:buy")
        ])
    
    elif mode == "sell":
        # Строка выбора процента
        percent_row = []
        for percent in [25, 50, 100]:
            label = f"{percent}%"
            if action.get('sell_percent') == percent:
                label = f"✅ {label}"
            percent_row.append(
                InlineKeyboardButton(label, callback_data=f"sell_percent:{percent}")
            )
        keyboard.append(percent_row)
        
        # Строка настроек
        settings_row = [
            InlineKeyboardButton(
                f"Slippage: {action.get('slippage', 1)}%",
                callback_data="settings:slippage"
            ),
            InlineKeyboardButton("Gas: Auto", callback_data="settings:gas")
        ]
        keyboard.append(settings_row)
        
        # Кнопка выполнения
        keyboard.append([
            InlineKeyboardButton("🔴 Execute Sell", callback_data="execute:sell")
        ])
    
    elif mode == "limit":
        # Кнопки установки параметров
        keyboard.append([
            InlineKeyboardButton(
                f"Set Price: ${action.get('limit_price', '?')}",
                callback_data="limit:set_price"
            ),
            InlineKeyboardButton(
                f"Set Amount: ${action.get('selected_amount', '?')}",
                callback_data="limit:set_amount"
            )
        ])
        
        # Строка TP/SL
        tp_sl_row = []
        if action.get('tp_enabled'):
            tp_sl_row.append(
                InlineKeyboardButton(
                    f"✅ TP: ${action['tp_price']:.2f}",
                    callback_data="tp_sl:edit_tp"
                )
            )
        else:
            tp_sl_row.append(
                InlineKeyboardButton("🎯 Set TP", callback_data="tp_sl:set_tp")
            )
        
        if action.get('sl_enabled'):
            tp_sl_row.append(
                InlineKeyboardButton(
                    f"✅ SL: ${action['sl_price']:.2f}",
                    callback_data="tp_sl:edit_sl"
                )
            )
        else:
            tp_sl_row.append(
                InlineKeyboardButton("🛡️ Set SL", callback_data="tp_sl:set_sl")
            )
        keyboard.append(tp_sl_row)
        
        # Кнопка размещения/отмены ордера
        if action.get('order_status') == 'active':
            keyboard.append([
                InlineKeyboardButton("❌ Cancel Order", callback_data="limit:cancel")
            ])
        else:
            keyboard.append([
                InlineKeyboardButton("📍 Place Order", callback_data="limit:place")
            ])
    
    elif mode == "track":
        # Кнопки редактирования TP/SL (если позиция есть)
        if action.get('position'):
            tp_sl_row = []
            if action.get('tp_enabled'):
                tp_sl_row.append(
                    InlineKeyboardButton(
                        f"Edit TP: ${action['tp_price']:.2f}",
                        callback_data="tp_sl:edit_tp"
                    )
                )
            else:
                tp_sl_row.append(
                    InlineKeyboardButton("🎯 Set TP", callback_data="tp_sl:set_tp")
                )
            
            if action.get('sl_enabled'):
                tp_sl_row.append(
                    InlineKeyboardButton(
                        f"Edit SL: ${action['sl_price']:.2f}",
                        callback_data="tp_sl:edit_sl"
                    )
                )
            else:
                tp_sl_row.append(
                    InlineKeyboardButton("🛡️ Set SL", callback_data="tp_sl:set_sl")
                )
            keyboard.append(tp_sl_row)
            
            # Кнопка закрытия позиции
            keyboard.append([
                InlineKeyboardButton("🔴 Close Position", callback_data="track:close_position")
            ])
        
        # Кнопка графика (опционально)
        keyboard.append([
            InlineKeyboardButton("📊 Chart", callback_data="track:chart")
        ])
    
    # Последняя строка: Универсальные кнопки
    keyboard.append([
        InlineKeyboardButton("🔄 Refresh", callback_data="refresh:data"),
        InlineKeyboardButton("❌ Close", callback_data="panel:close")
    ])
    
    return InlineKeyboardMarkup(keyboard)


def format_number(num: float) -> str:
    """
    Форматирование больших чисел (1.2M, 450K)
    """
    if num >= 1_000_000_000:
        return f"{num / 1_000_000_000:.1f}B"
    elif num >= 1_000_000:
        return f"{num / 1_000_000:.1f}M"
    elif num >= 1_000:
        return f"{num / 1_000:.1f}K"
    else:
        return f"{num:.2f}"


def shorten_address(address: str) -> str:
    """
    Сократить адрес для отображения
    """
    return f"{address[:4]}...{address[-4:]}"
```

---

### Редактирование TP/SL в режиме Track

Когда пользователь нажимает `[Edit TP]` или `[Edit SL]` в режиме Track:

```python
async def handle_edit_tp_in_track(update, context):
    """
    Редактирование Take Profit для активной позиции
    """
    query = update.callback_query
    user_state = get_user_state(query.from_user.id)
    
    # Проверить, есть ли активная позиция
    position = user_state["action_data"].get("position")
    if not position:
        await query.answer("⚠️ Нет активной позиции", show_alert=True)
        return
    
    # Отправить меню выбора
    keyboard = [
        [
            InlineKeyboardButton("💵 By Price", callback_data="tp_sl:mode:price:tp"),
            InlineKeyboardButton("📊 By Percent", callback_data="tp_sl:mode:percent:tp")
        ],
        [InlineKeyboardButton("❌ Disable TP", callback_data="tp_sl:disable_tp")],
        [InlineKeyboardButton("« Back", callback_data="tp_sl:cancel")]
    ]
    
    await query.message.reply_text(
        "🎯 Edit Take Profit\n\n"
        f"Current TP: ${user_state['action_data']['tp_price']:.4f}\n"
        f"Current Price: ${position['current_price']:.4f}\n\n"
        "Choose how to set new TP:",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )
    await query.answer()


async def handle_disable_tp(update, context):
    """
    Отключить Take Profit
    """
    query = update.callback_query
    user_state = get_user_state(query.from_user.id)
    
    # Отключить TP в состоянии
    user_state["action_data"]["tp_enabled"] = False
    user_state["action_data"]["tp_price"] = None
    user_state["action_data"]["tp_percent"] = None
    
    # Обновить позицию в БД
    position_id = user_state["action_data"]["position"].get("id")
    if position_id:
        await update_position_tp_sl(
            position_id=position_id,
            tp_enabled=False,
            tp_price=None
        )
    
    save_user_state(user_state)
    
    # Обновить панель
    await context.bot.edit_message_text(
        chat_id=user_state["user_id"],
        message_id=user_state["message_id"],
        text=generate_panel_text(user_state),
        reply_markup=generate_keyboard(user_state)
    )
    
    await query.message.reply_text("✅ Take Profit отключен")
    await query.answer()


async def handle_update_position_tp_sl(position_id: int, tp_enabled: bool = None, 
                                       tp_price: float = None, sl_enabled: bool = None,
                                       sl_price: float = None):
    """
    Обновить TP/SL для позиции в БД
    """
    position = await get_position(position_id)
    
    if tp_enabled is not None:
        position.tp_enabled = tp_enabled
    if tp_price is not None:
        position.tp_price = tp_price
    if sl_enabled is not None:
        position.sl_enabled = sl_enabled
    if sl_price is not None:
        position.sl_price = sl_price
    
    await save_position(position)
    
    # Если TP/SL отключены оба, остановить мониторинг
    if not position.tp_enabled and not position.sl_enabled:
        await tp_sl_monitor.stop_monitor(position_id)
    # Если включили хотя бы один, запустить мониторинг
    elif position.tp_enabled or position.sl_enabled:
        await tp_sl_monitor.start_monitor(position_id)
```

---

### Ручное закрытие позиции

Когда пользователь нажимает `[🔴 Close Position]`:

```python
async def handle_close_position(update, context):
    """
    Ручное закрытие позиции
    """
    query = update.callback_query
    user_state = get_user_state(query.from_user.id)
    
    position = user_state["action_data"].get("position")
    if not position:
        await query.answer("⚠️ Нет активной позиции", show_alert=True)
        return
    
    # Подтверждение
    await query.answer("⏳ Closing position...")
    
    try:
        # Выполнить продажу
        tx_result = await execute_swap(
            token_address=user_state["token_address"],
            amount_tokens=position["size"],
            action="sell",
            slippage=1.0
        )
        
        # Рассчитать PNL
        exit_value = tx_result["usd_received"]
        pnl_usd = exit_value - position["entry_value_usd"]
        
        # Закрыть позицию в БД
        await close_position(
            position_id=position["id"],
            exit_price=tx_result["execution_price"],
            pnl_usd=pnl_usd,
            status="closed_manual"
        )
        
        # Остановить мониторинг TP/SL
        await tp_sl_monitor.stop_monitor(position["id"])
        
        # Обновить состояние
        user_state["action_data"]["position"] = None
        await refresh_user_balances(user_state)
        
        # Показать результат
        await query.answer(
            f"✅ Position closed\n"
            f"PNL: ${pnl_usd:+.2f} ({(pnl_usd/position['entry_value_usd'])*100:+.1f}%)",
            show_alert=True
        )
        
        # Обновить панель
        await query.edit_message_text(
            text=generate_panel_text(user_state),
            reply_markup=generate_keyboard(user_state)
        )
        
    except Exception as e:
        await query.answer(f"❌ Error: {str(e)}", show_alert=True)
```

---

## Дополнительные возможности TP/SL

### Trailing Stop Loss

**Концепция:** Stop Loss автоматически повышается вслед за ценой, фиксируя прибыль.

**Пример:** 
- Входная цена: $2.00
- Trailing SL: -10% от максимума
- Цена растет до $3.00 → SL поднимается до $2.70
- Цена падает до $2.70 → срабатывает SL

**Реализация:**

```python
class TrailingStopLoss:
    """
    Trailing Stop Loss для позиции
    """
    
    def __init__(self, position_id: int, trailing_percent: float):
        self.position_id = position_id
        self.trailing_percent = trailing_percent
        self.highest_price = None
    
    async def update(self, current_price: float):
        """
        Обновить Trailing SL
        """
        # Обновить максимум
        if self.highest_price is None or current_price > self.highest_price:
            self.highest_price = current_price
            
            # Рассчитать новый SL
            new_sl_price = self.highest_price * (1 - self.trailing_percent / 100)
            
            # Обновить позицию
            await update_position_tp_sl(
                position_id=self.position_id,
                sl_price=new_sl_price
            )
            
            logger.info(
                f"Trailing SL updated: highest={self.highest_price:.4f}, "
                f"new_sl={new_sl_price:.4f}"
            )
        
        # Проверить срабатывание
        position = await get_position(self.position_id)
        if current_price <= position.sl_price:
            return True  # Trailing SL сработал
        
        return False
```

**Добавление в UI:**

```python
# В настройках SL добавить опцию Trailing
keyboard = [
    [InlineKeyboardButton("💵 Fixed Price", callback_data="sl:mode:fixed")],
    [InlineKeyboardButton("📊 Fixed Percent", callback_data="sl:mode:percent")],
    [InlineKeyboardButton("🔄 Trailing %", callback_data="sl:mode:trailing")],
    [InlineKeyboardButton("❌ Cancel", callback_data="tp_sl:cancel")]
]
```

---

### Partial Take Profit (Частичный TP)

**Концепция:** Продавать позицию частями при достижении разных уровней прибыли.

**Пример:**
- TP1: +10% → продать 30% позиции
- TP2: +20% → продать еще 30%
- TP3: +50% → продать остаток 40%

**Структура данных:**

```python
position = {
    ...
    "partial_tp_enabled": True,
    "partial_tp_levels": [
        {"percent": 10, "sell_amount": 30, "status": "pending"},
        {"percent": 20, "sell_amount": 30, "status": "pending"},
        {"percent": 50, "sell_amount": 40, "status": "pending"}
    ]
}
```

**Мониторинг:**

```python
async def check_partial_tp(position, current_price: float):
    """
    Проверить и выполнить частичные TP
    """
    for level in position["partial_tp_levels"]:
        if level["status"] == "pending":
            # Рассчитать целевую цену
            target_price = position["entry_price"] * (1 + level["percent"] / 100)
            
            if current_price >= target_price:
                # Продать часть позиции
                sell_amount = position["size"] * (level["sell_amount"] / 100)
                
                await execute_swap(
                    token_address=position["token_address"],
                    amount_tokens=sell_amount,
                    action="sell"
                )
                
                # Обновить статус
                level["status"] = "executed"
                await save_position(position)
                
                # Уведомить
                await send_notification(
                    user_id=position["user_id"],
                    text=f"🎯 Partial TP {level['percent']}% executed!\n"
                         f"Sold {level['sell_amount']}% of position"
                )
```

---

## Расширенная структура проекта

```
dex_bot/
├── bot.py
├── handlers/
│   ├── __init__.py
│   ├── message.py
│   ├── callbacks.py
│   ├── commands.py
│   └── tp_sl_handlers.py      # NEW: Обработчики TP/SL
├── ui/
│   ├── __init__.py
│   ├── panel.py
│   └── keyboards.py
├── blockchain/
│   ├── __init__.py
│   ├── solana.py
│   ├── jupiter.py
│   └── tokens.py
├── database/
│   ├── __init__.py
│   ├── models.py
│   └── repository.py
├── services/
│   ├── __init__.py
│   ├── state_manager.py
│   ├── order_monitor.py
│   ├── price_tracker.py
│   ├── auto_refresh.py
│   ├── tp_sl_monitor.py       # NEW: Мониторинг TP/SL
│   └── trailing_sl.py         # NEW: Trailing Stop Loss
├── utils/
│   ├── __init__.py
│   ├── validation.py
│   ├── formatting.py
│   └── cache.py
├── config.py
└── requirements.txt
```

---

## Критерии приемки (обновленные)

### Функциональные требования

✅ Панель создается автоматически при отправке адреса токена  
✅ Все 4 режима работают без потери контекста токена  
✅ Переключение режимов обновляет только Action Area  
✅ Header, Token Info, User Info всегда видны  
✅ Выполнение сделок работает в режиме Buy/Sell  
✅ Лимитные ордера размещаются и отменяются  
✅ Режим Track показывает PNL позиции  
✅ Данные обновляются автоматически (каждые 5 сек)  

**NEW: TP/SL функционал:**  
✅ Пользователь может установить TP и SL для Market Buy ордеров  
✅ Пользователь может установить TP и SL для Limit ордеров  
✅ TP/SL можно установить по цене или по проценту  
✅ TP/SL отображается в панели для всех режимов  
✅ Фоновый сервис мониторит активные позиции  
✅ TP/SL автоматически исполняется при достижении целевой цены  
✅ Пользователь получает уведомление о срабатывании TP/SL  
✅ Пользователь может редактировать TP/SL в режиме Track  
✅ Пользователь может отключить TP/SL  
✅ При ручном закрытии позиции TP/SL отключается автоматически  

### Нефункциональные требования

✅ Панель отвечает на действия за < 1 секунды  
✅ Транзакции выполняются за < 5 секунд  
✅ TP/SL проверяется каждые 2 секунды  
✅ Обработка ошибок с понятными сообщениями  
✅ Код покрыт логированием  
✅ Состояния пользователей сохраняются при перезапуске бота  
✅ Мониторинг TP/SL возобновляется после перезапуска  

---

## Сценарии использования с TP/SL

### Сценарий 1: Market Buy с TP/SL

**Действия пользователя:**
1. Отправить адрес токена
2. Выбрать режим Buy
3. Выбрать сумму $50
4. Нажать `[🎯 Set TP]`
5. Выбрать "By Percent"
6. Ввести `20` (для +20%)
7. Нажать `[🛡️ Set SL]`
8. Выбрать "By Percent"
9. Ввести `10` (для -10%)
10. Нажать `[🟢 Execute Trade]`

**Результат:**
- Бот покупает токены
- Создается позиция с TP = +20% и SL = -10%
- Запускается мониторинг
- Позиция автоматически закроется при достижении TP или SL

---

### Сценарий 2: Редактирование TP во время трейдинга

**Действия пользователя:**
1. Открыть панель токена (позиция уже есть)
2. Переключиться в режим Track
3. Видеть текущий PNL: +$5.50 (+11%)
4. Нажать `[Edit TP: $2.50]`
5. Выбрать "By Price"
6. Ввести новую цену `2.80`
7. Подтвердить

**Результат:**
- TP обновлен до $2.80
- Мониторинг продолжается с новой целевой ценой
- Панель показывает обновленный TP

---

### Сценарий 3: Срабатывание Take Profit

**Процесс (автоматический):**
1. Позиция: 100 токенов, вход $2.00, TP $2.40 (+20%)
2. Цена растет: $2.10 → $2.25 → $2.40
3. Мониторинг обнаруживает: current_price >= tp_price
4. Бот автоматически продает все 100 токенов
5. Позиция закрывается со статусом "closed_tp"
6. Пользователь получает уведомление:
```
🎯 Take Profit сработал!
Токен: 4k3D...kX6R
Цена выхода: $2.41
PNL: +$41.00 (+20.5%)
TX: a4b8c2d1...
```

---

### Сценарий 4: Срабатывание Stop Loss

**Процесс (автоматический):**
1. Позиция: 100 токенов, вход $2.00, SL $1.80 (-10%)
2. Цена падает: $1.95 → $1.85 → $1.80
3. Мониторинг обнаруживает: current_price <= sl_price
4. Бот автоматически продает все 100 токенов
5. Позиция закрывается со статусом "closed_sl"
6. Пользователь получает уведомление:
```
🛡️ Stop Loss сработал!
Токен: 4k3D...kX6R
Цена выхода: $1.79
PNL: -$21.00 (-10.5%)
TX: b5c9d3e2...
```

---

## Обработка edge-cases для TP/SL

### 1. Недостаточная ликвидность при исполнении

```python
async def execute_tp_sl_with_retry(position, action: str, max_retries: int = 3):
    """
    Выполнить TP/SL с повторными попытками
    """
    for attempt in range(max_retries):
        try:
            # Попытка выполнить продажу
            tx_result = await execute_swap(
                token_address=position.token_address,
                amount_tokens=position.size,
                action="sell",
                slippage=1.0 + (attempt * 0.5)  # Увеличить slippage при повторах
            )
            return tx_result
            
        except InsufficientLiquidityError as e:
            if attempt == max_retries - 1:
                # Последняя попытка не удалась
                logger.error(f"Failed to execute {action} after {max_retries} attempts: {e}")
                
                # Уведомить пользователя
                await send_notification(
                    user_id=position.user_id,
                    text=f"⚠️ {action} не удалось выполнить из-за недостаточной ликвидности.\n"
                         f"Позиция остается открытой. Попробуйте закрыть вручную."
                )
                raise
            
            # Подождать перед следующей попыткой
            await asyncio.sleep(2)
            logger.warning(f"{action} attempt {attempt + 1} failed, retrying...")
```

### 2. Одновременное срабатывание TP и SL (невозможно, но на всякий случай)

```python
async def check_tp_sl_collision(position, current_price: float):
    """
    Проверить, не произошло ли одновременное срабатывание
    """
    tp_triggered = position.tp_enabled and current_price >= position.tp_price
    sl_triggered = position.sl_enabled and current_price <= position.sl_price
    
    if tp_triggered and sl_triggered:
        # Это не должно происходить в нормальных условиях
        logger.error(f"Position {position.id}: TP and SL both triggered!")
        
        # Приоритет: SL (защита капитала важнее)
        return "sl"
    elif tp_triggered:
        return "tp"
    elif sl_triggered:
        return "sl"
    else:
        return None
```

### 3. Изменение цены во время исполнения транзакции

```python
async def execute_with_price_check(position, expected_price: float, tolerance: float = 0.02):
    """
    Выполнить сделку с проверкой проскальзывания цены
    """
    # Получить текущую цену перед исполнением
    pre_tx_price = await get_token_price(position.token_address)
    
    # Проверить, не ушла ли цена сильно в другую сторону
    price_diff_percent = abs(pre_tx_price - expected_price) / expected_price
    
    if price_diff_percent > tolerance:
        logger.warning(
            f"Price moved significantly before execution: "
            f"expected={expected_price}, actual={pre_tx_price}"
        )
        
        # Уведомить пользователя
        await send_notification(
            user_id=position.user_id,
            text=f"⚠️ Цена изменилась на {price_diff_percent*100:.1f}% перед исполнением.\n"
                 f"Ожидаемая: ${expected_price:.4f}\n"
                 f"Текущая: ${pre_tx_price:.4f}\n"
                 f"Выполняю сделку..."
        )
    
    # Выполнить транзакцию
    return await execute_swap(
        token_address=position.token_address,
        amount_tokens=position.size,
        action="sell"
    )
```

### 4. Восстановление мониторинга после перезапуска бота

```python
async def restore_tp_sl_monitoring():
    """
    Восстановить мониторинг TP/SL после перезапуска бота
    """
    # Загрузить все активные позиции с TP/SL
    active_positions = await get_active_positions_with_tp_sl()
    
    logger.info(f"Restoring TP/SL monitoring for {len(active_positions)} positions")
    
    for position in active_positions:
        try:
            # Запустить мониторинг
            await tp_sl_monitor.start_monitor(position.id)
            logger.info(f"Restored monitoring for position {position.id}")
            
        except Exception as e:
            logger.error(f"Failed to restore monitoring for position {position.id}: {e}")

# Вызывать при старте бота
async def on_bot_startup():
    """
    Действия при запуске бота
    """
    logger.info("Bot starting up...")
    
    # Восстановить мониторинг
    await restore_tp_sl_monitoring()
    
    # Восстановить мониторинг лимитных ордеров
    await restore_limit_order_monitoring()
    
    logger.info("Bot startup complete")
```

---

## Оптимизация мониторинга TP/SL

### Группировка проверок по токенам

Вместо отдельной задачи для каждой позиции, группировать позиции одного токена:

```python
class OptimizedTPSLMonitor:
    """
    Оптимизированный мониторинг TP/SL с группировкой по токенам
    """
    
    def __init__(self):
        self.token_monitors = {}  # token_address -> Task
        self.positions_by_token = {}  # token_address -> [position_ids]
    
    async def start_monitor(self, position_id: int):
        """
        Добавить позицию в мониторинг
        """
        position = await get_position(position_id)
        token_address = position.token_address
        
        # Добавить позицию в список для этого токена
        if token_address not in self.positions_by_token:
            self.positions_by_token[token_address] = []
        
        if position_id not in self.positions_by_token[token_address]:
            self.positions_by_token[token_address].append(position_id)
        
        # Если для этого токена еще нет монитора, создать
        if token_address not in self.token_monitors:
            task = asyncio.create_task(self._monitor_token(token_address))
            self.token_monitors[token_address] = task
    
    async def stop_monitor(self, position_id: int):
        """
        Убрать позицию из мониторинга
        """
        position = await get_position(position_id)
        token_address = position.token_address
        
        if token_address in self.positions_by_token:
            if position_id in self.positions_by_token[token_address]:
                self.positions_by_token[token_address].remove(position_id)
            
            # Если больше нет позиций для этого токена, остановить монитор
            if not self.positions_by_token[token_address]:
                if token_address in self.token_monitors:
                    self.token_monitors[token_address].cancel()
                    del self.token_monitors[token_address]
                del self.positions_by_token[token_address]
    
    async def _monitor_token(self, token_address: str):
        """
        Мониторить все позиции одного токена
        """
        try:
            while True:
                # Получить текущую цену ОДИН раз для всех позиций этого токена
                current_price = await get_token_price(token_address)
                
                # Проверить все позиции этого токена
                position_ids = self.positions_by_token.get(token_address, [])
                
                for position_id in position_ids[:]:  # Копия списка для безопасной модификации
                    try:
                        position = await get_position(position_id)
                        
                        if not position or position.status != "active":
                            # Убрать неактивную позицию
                            await self.stop_monitor(position_id)
                            continue
                        
                        # Проверить TP
                        if position.tp_enabled and current_price >= position.tp_price:
                            await self._execute_take_profit(position, current_price)
                            await self.stop_monitor(position_id)
                            continue
                        
                        # Проверить SL
                        if position.sl_enabled and current_price <= position.sl_price:
                            await self._execute_stop_loss(position, current_price)
                            await self.stop_monitor(position_id)
                            continue
                            
                    except Exception as e:
                        logger.error(f"Error checking position {position_id}: {e}")
                
                # Подождать перед следующей проверкой
                await asyncio.sleep(2)
                
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Error monitoring token {token_address}: {e}")
    
    async def _execute_take_profit(self, position, current_price: float):
        """Выполнить Take Profit"""
        # Реализация аналогична предыдущей
        pass
    
    async def _execute_stop_loss(self, position, current_price: float):
        """Выполнить Stop Loss"""
        # Реализация аналогична предыдущей
        pass

# Использовать оптимизированный монитор
tp_sl_monitor = OptimizedTPSLMonitor()
```

**Преимущества:**
- Один RPC запрос на токен вместо запроса на каждую позицию
- Меньше фоновых задач (одна на токен вместо одной на позицию)
- Более эффективное использование ресурсов

---

## Уведомления и логирование

### Типы уведомлений

```python
class NotificationService:
    """
    Сервис для отправки уведомлений пользователям
    """
    
    @staticmethod
    async def send_tp_executed(user_id: int, position, tx_result):
        """
        Уведомление о срабатывании Take Profit
        """
        pnl_percent = (position.pnl_usd / position.entry_value_usd) * 100
        
        text = (
            "🎯 <b>Take Profit Executed!</b>\n\n"
            f"Token: <code>{position.token_address[:8]}...</code>\n"
            f"Entry Price: ${position.entry_price:.4f}\n"
            f"Exit Price: ${tx_result['execution_price']:.4f}\n"
            f"Size: {position.size:.2f} tokens\n\n"
            f"💰 PNL: <b>${position.pnl_usd:+.2f}</b> ({pnl_percent:+.1f}%)\n\n"
            f"TX: <a href='https://solscan.io/tx/{tx_result['signature']}'>View</a>"
        )
        
        await bot.send_message(
            chat_id=user_id,
            text=text,
            parse_mode="HTML",
            disable_web_page_preview=True
        )
    
    @staticmethod
    async def send_sl_executed(user_id: int, position, tx_result):
        """
        Уведомление о срабатывании Stop Loss
        """
        pnl_percent = (position.pnl_usd / position.entry_value_usd) * 100
        
        text = (
            "🛡️ <b>Stop Loss Executed</b>\n\n"
            f"Token: <code>{position.token_address[:8]}...</code>\n"
            f"Entry Price: ${position.entry_price:.4f}\n"
            f"Exit Price: ${tx_result['execution_price']:.4f}\n"
            f"Size: {position.size:.2f} tokens\n\n"
            f"📉 PNL: <b>${position.pnl_usd:+.2f}</b> ({pnl_percent:+.1f}%)\n\n"
            f"TX: <a href='https://solscan.io/tx/{tx_result['signature']}'>View</a>"
        )
        
        await bot.send_message(
            chat_id=user_id,
            text=text,
            parse_mode="HTML",
            disable_web_page_preview=True
        )
    
    @staticmethod
    async def send_tp_sl_approaching(user_id: int, position, current_price: float, 
                                     target_type: str, distance_percent: float):
        """
        Уведомление о приближении к TP/SL
        """
        if target_type == "tp":
            text = (
                "🎯 <b>Approaching Take Profit</b>\n\n"
                f"Token: <code>{position.token_address[:8]}...</code>\n"
                f"Current Price: ${current_price:.4f}\n"
                f"Target Price: ${position.tp_price:.4f}\n"
                f"Distance: {distance_percent:.1f}%"
            )
        else:  # sl
            text = (
                "🛡️ <b>Approaching Stop Loss</b>\n\n"
                f"Token: <code>{position.token_address[:8]}...</code>\n"
                f"Current Price: ${current_price:.4f}\n"
                f"Target Price: ${position.sl_price:.4f}\n"
                f"Distance: {distance_percent:.1f}%"
            )
        
        await bot.send_message(
            chat_id=user_id,
            text=text,
            parse_mode="HTML"
        )
```

### Добавление уведомлений о приближении к целям

```python
async def _monitor_position_with_alerts(self, position_id: int):
    """
    Мониторинг с уведомлениями о приближении
    """
    alerts_sent = {"tp_5": False, "tp_2": False, "sl_5": False, "sl_2": False}
    
    while True:
        position = await get_position(position_id)
        current_price = await get_token_price(position.token_address)
        
        # Проверить TP
        if position.tp_enabled:
            distance_to_tp = ((position.tp_price - current_price) / current_price) * 100
            
            # Уведомление при 5% до цели
            if 0 < distance_to_tp <= 5 and not alerts_sent["tp_5"]:
                await NotificationService.send_tp_sl_approaching(
                    position.user_id, position, current_price, "tp", distance_to_tp
                )
                alerts_sent["tp_5"] = True
            
            # Уведомление при 2% до цели
            if 0 < distance_to_tp <= 2 and not alerts_sent["tp_2"]:
                await NotificationService.send_tp_sl_approaching(
                    position.user_id, position, current_price, "tp", distance_to_tp
                )
                alerts_sent["tp_2"] = True
            
            # Срабатывание
            if current_price >= position.tp_price:
                await self._execute_take_profit(position, current_price)
                break
        
        # Проверить SL (аналогично)
        if position.sl_enabled:
            distance_to_sl = ((current_price - position.sl_price) / current_price) * 100
            
            if 0 < distance_to_sl <= 5 and not alerts_sent["sl_5"]:
                await NotificationService.send_tp_sl_approaching(
                    position.user_id, position, current_price, "sl", distance_to_sl
                )
                alerts_sent["sl_5"] = True
            
            if 0 < distance_to_sl <= 2 and not alerts_sent["sl_2"]:
                await NotificationService.send_tp_sl_approaching(
                    position.user_id, position, current_price, "sl", distance_to_sl
                )
                alerts_sent["sl_2"] = True
            
            if current_price <= position.sl_price:
                await self._execute_stop_loss(position, current_price)
                break
        
        await asyncio.sleep(2)
```

---

## Логирование для аудита

```python
class TPSLAuditLogger:
    """
    Логирование всех событий TP/SL для аудита
    """
    
    @staticmethod
    async def log_tp_sl_set(user_id: int, position_id: int, tp_price: float = None, 
                           sl_price: float = None):
        """
        Логировать установку TP/SL
        """
        event = {
            "timestamp": datetime.now().isoformat(),
            "event_type": "tp_sl_set",
            "user_id": user_id,
            "position_id": position_id,
            "tp_price": tp_price,
            "sl_price": sl_price
        }
        await save_audit_log(event)
    
    @staticmethod
    async def log_tp_sl_triggered(position_id: int, trigger_type: str, 
                                  trigger_price: float, execution_price: float):
        """
        Логировать срабатывание TP/SL
        """
        event = {
            "timestamp": datetime.now().isoformat(),
            "event_type": f"{trigger_type}_triggered",
            "position_id": position_id,
            "trigger_price": trigger_price,
            "execution_price": execution_price,
            "slippage": abs(execution_price - trigger_price) / trigger_price * 100
        }
        await save_audit_log(event)
    
    @staticmethod
    async def log_tp_sl_execution_failed(position_id: int, trigger_type: str, 
                                        error: str):
        """
        Логировать ошибку исполнения TP/SL
        """
        event = {
            "timestamp": datetime.now().isoformat(),
            "event_type": f"{trigger_type}_failed",
            "position_id": position_id,
            "error": str(error)
        }
        await save_audit_log(event)
```

---

## Настройки пользователя для TP/SL

Добавить возможность сохранять дефолтные настройки TP/SL:

```python
class UserPreferences:
    """
    Предпочтения пользователя
    """
    user_id: int
    
    # Дефолтные настройки TP/SL
    default_tp_enabled: bool = False
    default_tp_percent: float = 20.0
    
    default_sl_enabled: bool = False
    default_sl_percent: float = 10.0
    
    # Настройки уведомлений
    notify_tp_approaching: bool = True
    notify_sl_approaching: bool = True
    notify_on_execution: bool = True
    
    # Настройки мониторинга
    monitoring_interval_seconds: int = 2
    enable_trailing_sl: bool = False


async def apply_default_tp_sl(user_state: dict):
    """
    Применить дефолтные настройки TP/SL из предпочтений пользователя
    """
    prefs = await get_user_preferences(user_state["user_id"])
    
    if prefs.default_tp_enabled:
        current_price = user_state["token_data"]["current_price"]
        tp_price = current_price * (1 + prefs.default_tp_percent / 100)
        
        user_state["action_data"]["tp_enabled"] = True
        user_state["action_data"]["tp_price"] = tp_price
        user_state["action_data"]["tp_percent"] = prefs.default_tp_percent
    
    if prefs.default_sl_enabled:
        current_price = user_state["token_data"]["current_price"]
        sl_price = current_price * (1 - prefs.default_sl_percent / 100)
        
        user_state["action_data"]["sl_enabled"] = True
        user_state["action_data"]["sl_price"] = sl_price
        user_state["action_data"]["sl_percent"] = -prefs.default_sl_percent
```

Добавить команду для настройки:

```
/settings
```

**Меню настроек:**

```
⚙️ Settings

Default Take Profit: ✅ Enabled (+20%)
Default Stop Loss: ✅ Enabled (-10%)

[Edit Default TP]
[Edit Default SL]
[Disable Defaults]

Notifications:
✅ Approaching alerts
✅ Execution alerts

[Toggle Notifications]
[❌ Close]
```

---

## Финальные замечания

### Безопасность

1. **Защита от манипуляций:** Проверять, что цены получены из надежного источника (не один RPC endpoint)
2. **Rate limiting:** Ограничить частоту установки/изменения TP/SL (макс 5 раз в минуту)
3. **Валидация:** Всегда проверять, что TP выше, а SL ниже текущей цены

### Производительность

1. **Batch processing:** Группировать позиции одного токена
2. **Кэширование цен:** Использовать единую цену для всех проверок в одном цикле
3. **Оптимизация БД:** Индексы на `status`, `token_address`, `tp_enabled`, `sl_enabled`

### Мониторинг системы

Добавить метрики:
- Количество активных позиций с TP/SL
- Среднее время до срабатывания TP/SL
- Процент успешных исполнений
- Средний slippage при исполнении

---

## Итоговый чеклист для разработчика

**Основной функционал:**
- [ ] Автоматическое открытие панели по адресу токена
- [ ] 4 режима работы (Buy/Sell/Limit/Track)
- [ ] Сохранение контекста токена
- [ ] Автообновление данных

**TP/SL для Market ордеров:**
- [ ] Установка TP по цене
- [ ] Установка TP по проценту
- [ ] Установка SL по цене
- [ ] Установка SL по проценту
- [ ] Отображение TP/SL в UI
- [ ] Создание позиции с TP/SL после покупки
- [ ] Запуск мониторинга TP/SL

**TP/SL для Limit ордеров:**
- [ ] Установка TP/SL при создании лимитного ордера
- [ ] Автоматический перенос TP/SL в позицию после исполнения
- [ ] Отображение статуса TP/SL в режиме Limit

**Мониторинг и исполнение:**
- [ ] Фоновый сервис мониторинга TP/SL
- [ ] Группировка проверок по токенам
- [ ] Автоматическое исполнение TP
- [ ] Автоматическое исполнение SL
- [ ] Обработка ошибок при исполнении
- [ ] Повторные попытки при ошибках

**Режим Track:**
- [ ] Отображение текущего PNL
- [ ] Редактирование TP/SL
- [ ] Отключение TP/SL
- [ ] Ручное закрытие позиции
- [ ] Отображение расстояния до целей

**Уведомления:**
- [ ] Уведомление о срабатывании TP
- [ ] Уведомление о срабатывании SL
- [ ] Уведомления о приближении к целям (опционально)
- [ ] Уведомления об ошибках исполнения

**Восстановление и персистентность:**
- [ ] Восстановление мониторинга после перезапуска
- [ ] Сохранение настроек TP/SL в БД
- [ ] Восстановление активных позиций

**Дополнительно (по желанию):**
- [ ] Trailing Stop Loss
- [ ] Partial Take Profit
- [ ] Дефолтные настройки TP/SL
- [ ] Меню настроек пользователя

---

**Документ готов к передаче разработчику. Все функции описаны, примеры кода предоставлены.**