import { Telegraf } from 'telegraf';
import { Keypair } from '@solana/web3.js';
import { SolanaProvider } from './chains/SolanaProvider';
import { PumpFunStrategy } from './trading/strategies/solana/PumpFunStrategy';
import { JupiterStrategy } from './trading/strategies/solana/JupiterStrategy';
import { TradeRouter } from './trading/router/TradeRouter';
import { DisplayHelper } from './utils/DisplayHelper';
import { UserSettings } from './trading/router/ITradingStrategy';
import { WalletManager } from './wallet/WalletManager';
import { WalletPanel } from './wallet/WalletPanel';
import { TradingPanel } from './panels/TradingPanel';
import { PumpFunLimitOrderManager } from './trading/managers/PumpFunLimitOrderManager';
import { JupiterLimitOrderManager } from './trading/managers/JupiterLimitOrderManager';
import { PriceMonitor } from './trading/managers/PriceMonitor';
import dotenv from 'dotenv';
import bs58 from 'bs58';

dotenv.config();

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const rpcUrl = process.env.ALCHEMY_SOLANA_RPC || process.env.QUICKNODE_RPC_URL;

if (!botToken || !rpcUrl) {
  console.error('TELEGRAM_BOT_TOKEN and a RPC_URL (ALCHEMY_SOLANA_RPC or QUICKNODE_RPC_URL) must be provided!');
  process.exit(1);
}

const ALLOWED_USERS = (process.env.ALLOWED_TELEGRAM_USERS || '').split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));

const bot = new Telegraf(botToken);
const solanaProvider = new SolanaProvider(rpcUrl);

let tradeRouter: TradeRouter;
let tradingPanel: TradingPanel | null = null;
let priceMonitor: PriceMonitor | null = null;
let pumpFunLimitOrderManager: PumpFunLimitOrderManager | null = null;
let jupiterLimitOrderManager: JupiterLimitOrderManager | null = null;

let userSettings: UserSettings = {
  slippage: 1.0,
  mevProtection: true,
  speedStrategy: 'normal',
  useJito: true,
  jitoTipMultiplier: 1.0,
};

const walletManager = new WalletManager(rpcUrl);
const walletPanel = new WalletPanel(walletManager, bot);

bot.use((ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId || !ALLOWED_USERS.includes(userId)) {
    console.log(`Access denied for user ${userId}`);
    return ctx.reply('⛔ Access denied. You are not authorized to use this bot.');
  }
  return next();
});

// Обработка callback queries от inline keyboards
bot.action('trade_panel', async (ctx) => {
  console.log('📊 Opening trading panel...');
  await ctx.answerCbQuery();
  if (tradingPanel) {
    await tradingPanel.showMainMenu(ctx);
  } else {
    await ctx.reply('⏳ Торговая панель недоступна. Убедитесь, что кошелек загружен.');
  }
});

// Обработка callback queries от TradingPanel
bot.on('callback_query', async (ctx) => {
  try {
    const callbackData = ctx.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
    
    console.log('🎯 [GENERAL HANDLER] Received callback query:', callbackData);
    console.log('🎯 [GENERAL HANDLER] tradingPanel exists:', !!tradingPanel);
    
    // Пропускаем 'trade_panel' - он обрабатывается отдельно через bot.action()
    if (callbackData === 'trade_panel') {
      console.log('🎯 [GENERAL HANDLER] Skipping trade_panel callback');
      return;
    }
    
    console.log('🎯 [GENERAL HANDLER] About to call tradingPanel.handleCallback()');
    
    // Обработка callback queries от TradingPanel
    if (tradingPanel) {
      await tradingPanel.handleCallback(ctx);
      console.log('🎯 [GENERAL HANDLER] tradingPanel.handleCallback() completed');
    } else {
      console.log('🎯 [GENERAL HANDLER] tradingPanel is null, skipping');
    }
  } catch (error) {
    console.error('❌ Error in callback_query handler:', error);
  }
});

// Обработка callback queries для кнопок "Купить" и "Продать"
bot.action('buy_token', async (ctx) => {
  console.log('🛒 Buy token button pressed');
  await ctx.answerCbQuery();
  if (tradingPanel) {
    await tradingPanel.showMainMenu(ctx);
  }
});

bot.action('sell_token', async (ctx) => {
  console.log('📈 Sell token button pressed');
  await ctx.answerCbQuery();
  if (tradingPanel) {
    await tradingPanel.showMainMenu(ctx);
  }
});

bot.action('get_quote', async (ctx) => {
  console.log('💹 Get quote button pressed');
  await ctx.answerCbQuery();
  if (tradingPanel) {
    await tradingPanel.showMainMenu(ctx);
  }
});

bot.start(async (ctx) => {
  await ctx.reply(
    '👋 Добро пожаловать!\n\n' +
    '📊 **Торговля:**\n' +
    '/trade - панель управления торговлей (кнопки)\n' +
    '/buy [token] [amount] - купить токен\n' +
    '/sell [token] [amount] - продать токен\n' +
    '/quote [token] [amount] - получить котировку\n\n' +
    '🔐 **Управление кошельком:**\n' +
    '/wallet - 🎛️ панель управления кошельком\n' +
    '/balance - проверить баланс\n\n' +
    '⚙️ **Настройки:**\n' +
    '/settings - посмотреть/изменить настройки\n\n' +
    '/help - список всех команд'
  );
  await walletPanel.showMainMenu(ctx);
});

bot.help((ctx) => {
  ctx.reply(
    '📋 **Список команд:**\n\n' +
    '📈 **Торговля:**\n' +
    '/trade - 📊 Панель управления торговлей (рекомендуется)\n' +
    '/buy [mint] [SOL_amount] - Купить токен за SOL\n' +
    '/sell [mint] [token_amount] - Продать токен за SOL\n' +
    '/quote [mint] [SOL_amount] - Посмотреть примерную цену покупки\n\n' +
    '🔐 **Управление кошельком:**\n' +
    '/wallet - 🎛️ Панель управления кошельком\n' +
    '/create_wallet - Создать новый кошелек\n' +
    '/import_wallet [key] - Импортировать кошелек\n' +
    '/export_private_key - Показать приватный ключ (⚠️)\n' +
    '/address - Показать адрес кошелька\n' +
    '/balance - Показать баланс\n\n' +
    '⚙️ **Настройки:**\n' +
    '/settings - Текущие торговые настройки\n\n' +
    'ℹ️ **Другое:**\n' +
    '/help - Показать это сообщение'
  );
});

bot.command('trade', async (ctx) => {
  if (!tradingPanel) {
    return ctx.reply('⏳ Торговый модуль не готов. Убедитесь, что кошелек загружен.');
  }
  await tradingPanel.showMainMenu(ctx);
});

bot.command('balance', async (ctx) => {
  try {
    const wallet = await walletManager.getWallet();
    if (!wallet) {
        return ctx.reply('❌ Кошелек не найден. Создайте или импортируйте его через /wallet.');
    }
    const balanceRaw = await solanaProvider.getBalance(wallet.publicKey.toString());
    const balanceFormatted = DisplayHelper.formatBalance('Solana', balanceRaw);
    await ctx.reply(`💰 Баланс: ${balanceFormatted}\nАдрес: \`${wallet.publicKey.toString()}\``, { parse_mode: 'Markdown' });
  } catch (error: any) {
    await ctx.reply(`❌ Ошибка: ${error.message}`);
  }
});

bot.command('buy', async (ctx) => {
  if (!tradeRouter) {
    return ctx.reply('⏳ Торговый модуль инициализируется или кошелек не загружен. Попробуйте снова через несколько секунд.');
  }
  try {
    const args = ctx.message.text.split(' ').slice(1);
    if (args.length < 2) {
      return ctx.reply('❌ /buy [tokenMint] [amount]\nПример: /buy EPjF... 0.5');
    }

    const [tokenMint, amountStr] = args;
    const amountLamports = DisplayHelper.parseAmount('Solana', amountStr);
    const amountSOL = DisplayHelper.lamportsToSOL(amountLamports);
    
    const wallet = await walletManager.getWallet();
    if (!wallet) {
        return ctx.reply('❌ Кошелек не найден. Создайте или импортируйте его через /wallet.');
    }

    await ctx.reply(`🔍 Покупка ${amountSOL} SOL токена ${tokenMint}...`);

    const quote = await tradeRouter.getQuote('Solana', tokenMint, amountLamports, wallet);

    await ctx.reply(
      `📊 Котировка от ${quote.strategy}:\n` +
      `Получите: ~${DisplayHelper.formatTokenAmount(quote.outputAmount, 6)}\n` +
      `Price Impact: ${DisplayHelper.formatPriceImpact(quote.priceImpact)}\n` +
      `Fee: ${DisplayHelper.formatBalance('Solana', quote.fee)}\n\n⏳ Отправка...`
    );

    const result = await tradeRouter.buy('Solana', tokenMint, amountLamports, userSettings, wallet);
    const explorerUrl = DisplayHelper.getSolscanUrl(result.signature);

    await ctx.reply(
      `✅ Покупка успешна!\n` +
      `Стратегия: ${result.strategy}\n` +
      `Signature: ${DisplayHelper.formatSignature(result.signature)}\n\n` +
      `🔍 Solscan:\n${explorerUrl}`
    );
  } catch (error: any) {
    console.error('Error in /buy command:', error);
    await ctx.reply(`❌ Ошибка покупки: ${error.message}`);
  }
});

bot.command('quote', async (ctx) => {
    if (!tradeRouter) {
        return ctx.reply('⏳ Торговый модуль не готов. Убедитесь, что кошелек загружен.');
    }
    try {
        const args = ctx.message.text.split(' ').slice(1);
        if (args.length < 2) {
            return ctx.reply('❌ /quote [tokenMint] [amount]\nПример: /quote EPjF... 0.5');
        }

        const [tokenMint, amountStr] = args;
        const amountLamports = DisplayHelper.parseAmount('Solana', amountStr);
        const wallet = await walletManager.getWallet();
         if (!wallet) {
            return ctx.reply('❌ Кошелек не найден.');
        }

        const quote = await tradeRouter.getQuote('Solana', tokenMint, amountLamports, wallet);

        await ctx.reply(
            `📊 Котировка от ${quote.strategy}:\n` +
            `За ${DisplayHelper.lamportsToSOL(quote.inputAmount)} SOL вы получите ~${DisplayHelper.formatTokenAmount(quote.outputAmount, 6)}\n` +
            `Price Impact: ${DisplayHelper.formatPriceImpact(quote.priceImpact)}`
        );
    } catch (error: any) {
        await ctx.reply(`❌ Ошибка получения котировки: ${error.message}`);
    }
});

bot.command('settings', async (ctx) => {
  if (!tradeRouter) {
    return ctx.reply('⏳ Торговый модуль не готов. Убедитесь, что кошелек загружен.');
  }
  const strategies = tradeRouter.getStrategiesForChain('Solana');
  const strategyList = strategies.map(s => `  • ${s.name} (priority: ${s.priority})`).join('\n');

  await ctx.reply(
    `⚙️ **Текущие настройки:**\n\n` +
    `Slippage: \`${userSettings.slippage}%\`\n` +
    `MEV Защита: ${userSettings.mevProtection ? '✅ Включена' : '❌ Выключена'}\n` +
    `Скорость: \`${userSettings.speedStrategy}\`\n\n` +
    `🔎 **Доступные стратегии:**\n${strategyList}`,
    { parse_mode: 'Markdown' }
  );
});

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

// Обработка текстовых сообщений (для создания ордеров)
bot.on('text', async (ctx, next) => {
  console.log('💬 Received text message:', ctx.message?.text);
  try {
    if (tradingPanel && await tradingPanel.handleUserInput(ctx)) {
      // Сообщение было обработано TradingPanel
      console.log('✅ Message handled by trading panel');
      return;
    }
    console.log('ℹ️ Message not handled by trading panel');
    // Передаем управление следующему обработчику
    next();
  } catch (error) {
    console.error('❌ Error in text handler:', error);
    // Передаем управление следующему обработчику даже при ошибке
    next();
  }
});

async function main() {
  try {
    console.log('🚀 Starting bot initialization...');
    console.log('📡 Connecting to Solana provider...');
    await solanaProvider.connect();
    console.log('✅ Solana provider connected');
    
    console.log('🔐 Loading wallet...');
    const wallet = await walletManager.getWallet();
    
    if (wallet) {
      console.log(`✅ Wallet loaded: ${wallet.publicKey.toString()}`);
      console.log('💰 Getting balance...');
      const balance = await solanaProvider.getBalance(wallet.publicKey.toString());
      console.log(`💰 Balance: ${DisplayHelper.formatBalance('Solana', balance)}`);
      
      // Initialize trading components
      console.log('🎯 Initializing trading strategies...');
      const pumpFunStrategy = new PumpFunStrategy(solanaProvider, wallet);
      const jupiterStrategy = new JupiterStrategy(solanaProvider, wallet);
      console.log('✅ Trading strategies created');
      
      console.log('🔀 Initializing trade router...');
      tradeRouter = new TradeRouter([pumpFunStrategy, jupiterStrategy]);
      console.log('✅ Trade router initialized.');
      
      // Initialize PriceMonitor
      console.log('📊 Initializing price monitor...');
      priceMonitor = new PriceMonitor(solanaProvider.connection, pumpFunStrategy);
      console.log('✅ Price monitor initialized.');
      
      // Initialize PumpFun LimitOrderManager
      console.log('📋 Initializing PumpFun limit order manager...');
      pumpFunLimitOrderManager = new PumpFunLimitOrderManager(
        pumpFunStrategy,
        priceMonitor,
        wallet,
        userSettings
      );
      console.log('📋 Initializing PumpFun limit order manager...');
      await pumpFunLimitOrderManager.initialize();
      console.log('📋 Starting PumpFun order monitoring...');
      await pumpFunLimitOrderManager.monitorOrders();
      console.log('✅ PumpFun limit order manager initialized and monitoring started.');
      
      // Initialize Jupiter LimitOrderManager
      console.log('📋 Initializing Jupiter limit order manager...');
      jupiterLimitOrderManager = new JupiterLimitOrderManager(
        jupiterStrategy,
        wallet,
        userSettings
      );
      console.log('📋 Initializing Jupiter limit order manager...');
      await jupiterLimitOrderManager.initialize();
      console.log('📋 Starting Jupiter order monitoring...');
      await jupiterLimitOrderManager.monitorOrders();
      console.log('✅ Jupiter limit order manager initialized and monitoring started.');
      
      // Initialize TradingPanel (используем PumpFun менеджер по умолчанию)
      console.log('🎨 Initializing trading panel...');
      tradingPanel = new TradingPanel(
        bot,
        tradeRouter,
        pumpFunLimitOrderManager,
        walletManager,
        userSettings
      );
      console.log('✅ Trading panel initialized.');
      
      console.log('✅ Trading panel initialized.');
      
    } else {
      console.warn('⚠️ Wallet not found. Trading commands will be unavailable until a wallet is created or imported.');
    }
    
    console.log('🤖 Launching Telegram bot...');
    console.log('📡 Starting bot.launch()...');
    try {
      await bot.launch();
      console.log('✅ Bot running! Allowed users:', ALLOWED_USERS);
      console.log('Bot is listening for commands...');
    } catch (launchError) {
      console.error('❌ Error during bot.launch():', launchError);
      throw launchError;
    }
    
  } catch (error) {
    console.error('❌ Error during bot initialization:', error);
    process.exit(1);
  }
}

process.once('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  if (pumpFunLimitOrderManager) {
    pumpFunLimitOrderManager.stopMonitoring();
  }
  if (jupiterLimitOrderManager) {
    jupiterLimitOrderManager.stopMonitoring();
  }
  if (priceMonitor) {
    priceMonitor.stopAllMonitoring();
  }
  bot.stop('SIGINT');
});

process.once('SIGTERM', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  if (pumpFunLimitOrderManager) {
    pumpFunLimitOrderManager.stopMonitoring();
  }
  if (jupiterLimitOrderManager) {
    jupiterLimitOrderManager.stopMonitoring();
  }
  if (priceMonitor) {
    priceMonitor.stopAllMonitoring();
  }
  bot.stop('SIGTERM');
});

main();