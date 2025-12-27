import { Telegraf, Context } from 'telegraf';
import dotenv from 'dotenv';
// import rateLimit from 'telegraf-ratelimit'; // ВРЕМЕННО ОТКЛЮЧЕНО
import { WalletManager } from './wallet/WalletManager';
import { WalletPanel } from './wallet/WalletPanel';
import bs58 from 'bs58';

// Загрузка переменных окружения
dotenv.config();

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const rpcUrl = process.env.QUICKNODE_RPC_URL;

if (!botToken || !rpcUrl) {
  console.error('TELEGRAM_BOT_TOKEN and QUICKNODE_RPC_URL must be provided!');
  process.exit(1);
}

const ALLOWED_USERS = (process.env.ALLOWED_TELEGRAM_USERS || '').split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));

const bot = new Telegraf(botToken);

// Middleware для проверки whitelist
bot.use((ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId || !ALLOWED_USERS.includes(userId)) {
    console.log(`Access denied for user ${userId}`);
    return ctx.reply('⛔ Access denied. You are not authorized to use this bot.');
  }
  return next();
});

// Middleware для ограничения запросов (10 команд в минуту) - ВРЕМЕННО ОТКЛЮЧЕНО
// const limitConfig = {
//   window: 60000,
//   limit: 10,
//   onLimitExceeded: (ctx: Context) => {
//     ctx.reply('⏳ Too many requests. Please wait a minute.');
//   },
// };
// bot.use(rateLimit(limitConfig));

// Инициализация walletManager и walletPanel до определения обработчиков
const walletManager = new WalletManager(rpcUrl);
const walletPanel = new WalletPanel(walletManager, bot);

// Базовая команда /start
bot.start(async (ctx) => {
  console.log('Received /start command from user:', ctx.from?.id);
  
  try {
    await ctx.reply(
      '👋 Welcome to the Solana DEX Trading Bot!\n\n' +
      'Your user ID is: ' + ctx.from.id + '\n' +
      'You are authorized to use this bot.\n\n' +
      '🎛️ **Панель управления кошельком:**'
    );
    
    // Показываем главную панель
    console.log('Showing main menu...');
    await walletPanel.showMainMenu(ctx);
    console.log('Main menu shown successfully');
  } catch (error) {
    console.error('Error in /start command:', error);
    await ctx.reply('❌ Произошла ошибка при запуске бота.');
  }
});

// Команда /help
bot.help((ctx) => {
  ctx.reply(
    '📋 **Список команд:**\n\n' +
    '🔐 **Управление кошельком:**\n' +
    '/wallet - 🎛️ Панель управления кошельком (рекомендуется)\n' +
    '/create_wallet - Создать новый кошелек\n' +
    '/import_wallet [key] - Импортировать существующий кошелек\n' +
    '/export_private_key - Получить приватный ключ (⚠️ осторожно!)\n' +
    '/address - Показать адрес кошелька\n' +
    '/balance - Показать баланс SOL\n\n' +
    '⚙️ **Настройки:**\n' +
    '/settings - Текущие настройки\n\n' +
    'ℹ️ **Другое:**\n' +
    '/help - Показать это сообщение'
  );
});

// Команды управления кошельком

bot.command('create_wallet', async (ctx) => {
    try {
        const publicKey = await walletManager.createWallet();
        ctx.reply(`✅ Новый кошелек успешно создан!\n\nАдрес: \`${publicKey.toBase58()}\``, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error(error);
        ctx.reply('❌ Произошла ошибка при создании кошелька.');
    }
});

bot.command('import_wallet', async (ctx) => {
    const privateKey = ctx.message.text.split(' ')[1];
    if (!privateKey) {
        return ctx.reply('Пожалуйста, укажите приватный ключ после команды. \nПример: `/import_wallet YOUR_PRIVATE_KEY`');
    }

    try {
        const publicKey = await walletManager.importWallet(privateKey);
        ctx.reply(`✅ Кошелек успешно импортирован!\n\nАдрес: \`${publicKey.toBase58()}\``, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error(error);
        ctx.reply('❌ Ошибка импорта. Убедитесь, что вы предоставили корректный приватный ключ в формате bs58.');
    } finally {
        // В целях безопасности удаляем сообщение с приватным ключом
        try {
            await ctx.deleteMessage();
        } catch (e) {
            console.error('Не удалось удалить сообщение с ключом:', e);
        }
    }
});

bot.command('address', async (ctx) => {
    const keypair = await walletManager.getWallet();
    if (keypair) {
        ctx.reply(`Ваш адрес кошелька: \`${keypair.publicKey.toBase58()}\``, { parse_mode: 'Markdown' });
    } else {
        ctx.reply('Кошелек не найден. Создайте или импортируйте его.');
    }
});

bot.command('export_private_key', async (ctx) => {
    try {
        const keypair = await walletManager.getWallet();
        if (!keypair) {
            return ctx.reply('Кошелек не найден. Создайте или импортируйте его.');
        }
        
        const privateKey = bs58.encode(keypair.secretKey);
        ctx.reply(`⚠️ **ВАЖНО:** Никогда не делитесь этим ключом!\n\nВаш приватный ключ: \`${privateKey}\`\n\nСохраните его в безопасном месте.`, { parse_mode: 'Markdown' });
    } catch (error) {
        console.error(error);
        ctx.reply('❌ Не удалось получить приватный ключ.');
    }
});

bot.command('balance', async (ctx) => {
    try {
        const balance = await walletManager.getBalance();
        if (typeof balance === 'number') {
            ctx.reply(`Баланс: \`${balance.toFixed(4)} SOL\``, { parse_mode: 'Markdown' });
        } else {
            ctx.reply(balance);
        }
    } catch (error) {
        console.error(error);
        ctx.reply('❌ Не удалось получить баланс. Проверьте RPC подключение.');
    }
});


// Запуск бота
bot.launch(() => {
  console.log('Bot started successfully.');
  console.log('Allowed users:', ALLOWED_USERS);
  console.log('Bot is listening for commands...');
}).catch((error) => {
  console.error('Error starting bot:', error);
});

// Обработка ошибок
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}`, err);
});

// Graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));