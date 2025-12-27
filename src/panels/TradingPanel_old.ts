import { Telegraf, Context } from 'telegraf';
import { InlineKeyboardButton } from 'telegraf/types';
import { TradeRouter } from '../trading/router/TradeRouter';
import { PumpFunLimitOrderManager } from '../trading/managers/PumpFunLimitOrderManager';
import { DisplayHelper } from '../utils/DisplayHelper';
import { UserSettings } from '../trading/router/ITradingStrategy';
import { LimitOrder, OrderType, OrderStatus } from '../trading/managers/ILimitOrderManager';
import { WalletManager } from '../wallet/WalletManager';

/**
 * Панель управления торговлей через inline keyboards
 */
export class TradingPanel {
  private bot: Telegraf;
  private tradeRouter: TradeRouter;
  private limitOrderManager: PumpFunLimitOrderManager;
  private walletManager: WalletManager;
  private userSettings: UserSettings;
  
  // Временное хранилище для пользовательского ввода
  private pendingActions: Map<number, { action: string; data: any }> = new Map();

  constructor(
    bot: Telegraf,
    tradeRouter: TradeRouter,
    limitOrderManager: PumpFunLimitOrderManager,
    walletManager: WalletManager,
    userSettings: UserSettings
  ) {
    this.bot = bot;
    this.tradeRouter = tradeRouter;
    this.limitOrderManager = limitOrderManager;
    this.walletManager = walletManager;
    this.userSettings = userSettings;
  }

  /**
   * Показать главное меню торговли
   */
  async showMainMenu(ctx: Context): Promise<void> {
    const keyboard = this.createMainMenuKeyboard();
    
    await ctx.reply(
      '📊 **Главное меню торговли**\n\n' +
      'Выберите действие:',
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
      }
    );
  }

  /**
   * Показать меню лимитных ордеров
   */
  async showLimitOrdersMenu(ctx: Context): Promise<void> {
    const keyboard = this.createLimitOrdersMenuKeyboard();
    
    await ctx.reply(
      '📋 **Лимитные ордера**\n\n' +
      'Управляйте своими лимитными ордерами:',
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
      }
    );
  }

  /**
   * Показать список ордеров
   */
  async showOrdersList(ctx: Context): Promise<void> {
    const orders = await this.limitOrderManager.getAllOrders();
    
    if (orders.length === 0) {
      await ctx.reply(
        '📋 **Мои ордера**\n\n' +
        'У вас нет лимитных ордеров.\n\n' +
        'Создайте первый ордер через меню ниже.',
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: this.createBackToLimitOrdersMenuKeyboard() },
        }
      );
      return;
    }

    let message = '📋 **Мои ордера**\n\n';
    
    for (let i = 0; i < Math.min(orders.length, 10); i++) {
      const order = orders[i];
      const statusEmoji = this.getStatusEmoji(order.status);
      const typeEmoji = order.params.orderType === OrderType.BUY ? '🛒' : '📈';
      
      message += `${statusEmoji} ${typeEmoji} \`${order.id.slice(0, 12)}...\`\n`;
      message += `   ${order.params.orderType.toUpperCase()} | `;
      message += `Цена: ${order.params.price.toFixed(8)} SOL\n`;
      
      if (order.params.takeProfitPercent) {
        message += `   🎯 Take Profit: +${order.params.takeProfitPercent}%\n`;
      }
      
      if (order.params.stopLossPercent) {
        message += `   🛡️ Stop Loss: -${order.params.stopLossPercent}%\n`;
      }
      
      message += `   Статус: ${order.status}\n\n`;
    }

    if (orders.length > 10) {
      message += `... и еще ${orders.length - 10} ордеров\n\n`;
    }

    const stats = await this.limitOrderManager.getStats();
    message += `📊 Статистика: ${stats.pending} активных, ${stats.filled} исполнено, ${stats.cancelled} отменено`;

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: this.createBackToLimitOrdersMenuKeyboard() },
    });
  }

  /**
   * Показать настройки
   */
  async showSettings(ctx: Context): Promise<void> {
    const keyboard = this.createSettingsKeyboard();
    
    await ctx.reply(
      '⚙️ **Настройки торговли**\n\n' +
      'Текущие параметры:',
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
      }
    );
  }

  /**
   * Начать создание лимитного ордера
   */
  async startCreateOrder(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    // Сохраняем действие
    this.pendingActions.set(userId, { action: 'create_order_token', data: {} });

    await ctx.reply(
      '➕ **Создание лимитного ордера**\n\n' +
      'Шаг 1/5: Введите адрес токена (mint)\n\n' +
      'Пример: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt`',
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: this.createCancelKeyboard() },
      }
    );
  }

  /**
   * Обработка ввода пользователя
   */
  async handleUserInput(ctx: Context): Promise<boolean> {
    const userId = ctx.from?.id;
    if (!userId) return false;

    const pending = this.pendingActions.get(userId);
    if (!pending) return false;

    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : undefined;
    if (!text) return false;

    try {
      switch (pending.action) {
        case 'create_order_token':
          return await this.handleOrderTokenInput(ctx, text);
        case 'create_order_type':
          return await this.handleOrderTypeInput(ctx, text);
        case 'create_order_amount':
          return await this.handleOrderAmountInput(ctx, text);
        case 'create_order_price':
          return await this.handleOrderPriceInput(ctx, text);
        case 'create_order_takeprofit':
          return await this.handleOrderTakeProfitInput(ctx, text);
        default:
          return false;
      }
    } catch (error) {
      await ctx.reply(`❌ Ошибка: ${(error as Error).message}`, {
        reply_markup: { inline_keyboard: this.createCancelKeyboard() },
      });
      return true;
    }
  }

  /**
   * Обработка ввода адреса токена
   */
  private async handleOrderTokenInput(ctx: Context, text: string): Promise<boolean> {
    const userId = ctx.from?.id;
    if (!userId) return false;

    // Валидация адреса
    if (!text.match(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)) {
      await ctx.reply(
        '❌ Неверный формат адреса токена.\n\n' +
        'Пожалуйста, введите корректный Solana адрес (32-44 символа).',
        { reply_markup: { inline_keyboard: this.createCancelKeyboard() } }
      );
      return true;
    }

    // Сохраняем и переходим к следующему шагу
    this.pendingActions.set(userId, { 
      action: 'create_order_type', 
      data: { tokenMint: text } 
    });

    const keyboard = this.createOrderTypeKeyboard();

    await ctx.reply(
      '✅ Адрес токена сохранен\n\n' +
      'Шаг 2/5: Выберите тип ордера',
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
      }
    );

    return true;
  }

  /**
   * Обработка выбора типа ордера
   */
  private async handleOrderTypeInput(ctx: Context, text: string): Promise<boolean> {
    const userId = ctx.from?.id;
    if (!userId) return false;

    const pending = this.pendingActions.get(userId);
    if (!pending) return false;

    let orderType: OrderType;
    if (text.toLowerCase() === 'buy' || text === '🛒 Купить') {
      orderType = OrderType.BUY;
    } else if (text.toLowerCase() === 'sell' || text === '📈 Продать') {
      orderType = OrderType.SELL;
    } else {
      await ctx.reply(
        '❌ Неверный тип ордера.\n\n' +
        'Пожалуйста, выберите тип из меню.',
        { reply_markup: { inline_keyboard: this.createOrderTypeKeyboard() } }
      );
      return true;
    }

    this.pendingActions.set(userId, { 
      action: 'create_order_amount', 
      data: { ...pending.data, orderType } 
    });

    await ctx.reply(
      `✅ Тип ордера: ${orderType.toUpperCase()}\n\n` +
      'Шаг 3/5: Введите количество\n\n' +
      'Примеры:\n' +
      '• `0.5` - для SOL\n' +
      '• `1000` - для токенов',
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: this.createCancelKeyboard() },
      }
    );

    return true;
  }

  /**
   * Обработка ввода количества
   */
  private async handleOrderAmountInput(ctx: Context, text: string): Promise<boolean> {
    const userId = ctx.from?.id;
    if (!userId) return false;

    const pending = this.pendingActions.get(userId);
    if (!pending) return false;

    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply(
        '❌ Неверное количество.\n\n' +
        'Пожалуйста, введите положительное число.',
        { reply_markup: { inline_keyboard: this.createCancelKeyboard() } }
      );
      return true;
    }

    this.pendingActions.set(userId, { 
      action: 'create_order_price', 
      data: { ...pending.data, amount } 
    });

    await ctx.reply(
      `✅ Количество: ${amount}\n\n` +
      'Шаг 4/5: Введите целевую цену (в SOL за 1 токен)\n\n' +
      'Пример: `0.00001`',
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: this.createCancelKeyboard() },
      }
    );

    return true;
  }

  /**
   * Обработка ввода цены
   */
  private async handleOrderPriceInput(ctx: Context, text: string): Promise<boolean> {
    const userId = ctx.from?.id;
    if (!userId) return false;

    const pending = this.pendingActions.get(userId);
    if (!pending) return false;

    const price = parseFloat(text);
    if (isNaN(price) || price <= 0) {
      await ctx.reply(
        '❌ Неверная цена.\n\n' +
        'Пожалуйста, введите положительное число.',
        { reply_markup: { inline_keyboard: this.createCancelKeyboard() } }
      );
      return true;
    }

    this.pendingActions.set(userId, { 
      action: 'create_order_takeprofit', 
      data: { ...pending.data, price } 
    });

    const keyboard = this.createTakeProfitKeyboard();

    await ctx.reply(
      `✅ Цена: ${price.toFixed(8)} SOL\n\n` +
      'Шаг 5/5: Хотите добавить Take Profit?\n\n' +
      'Take Profit автоматически продаст токены при достижении целевой цены.',
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
      }
    );

    return true;
  }

  /**
   * Обработка ввода Take Profit
   */
  private async handleOrderTakeProfitInput(ctx: Context, text: string): Promise<boolean> {
    const userId = ctx.from?.id;
    if (!userId) return false;

    const pending = this.pendingActions.get(userId);
    if (!pending) return false;

    let takeProfitPercent: number | undefined;
    
    if (text.toLowerCase() !== 'skip' && text !== '⏭️ Пропустить') {
      takeProfitPercent = parseFloat(text);
      if (isNaN(takeProfitPercent) || takeProfitPercent <= 0 || takeProfitPercent > 1000) {
        await ctx.reply(
          '❌ Неверный процент Take Profit.\n\n' +
          'Пожалуйста, введите число от 1 до 1000 или выберите "Пропустить".',
          { reply_markup: { inline_keyboard: this.createTakeProfitKeyboard() } }
        );
        return true;
      }
    }

    // Создаем ордер
    const orderParams = {
      tokenMint: pending.data.tokenMint,
      orderType: pending.data.orderType,
      amount: pending.data.amount,
      price: pending.data.price,
      slippage: this.userSettings.slippage,
      takeProfitPercent,
    };

    try {
      const orderId = await this.limitOrderManager.createOrder(orderParams);
      
      // Очищаем pending action
      this.pendingActions.delete(userId);

      const keyboard = this.createBackToLimitOrdersMenuKeyboard();

      await ctx.reply(
        `✅ **Лимитный ордер создан!**\n\n` +
        `ID: \`${orderId}\`\n` +
        `Тип: ${orderParams.orderType.toUpperCase()}\n` +
        `Количество: ${orderParams.amount}\n` +
        `Цена: ${orderParams.price.toFixed(8)} SOL\n` +
        (takeProfitPercent ? `Take Profit: +${takeProfitPercent}%\n` : '') +
        `Slippage: ${orderParams.slippage}%\n\n` +
        `Ордер будет исполнен автоматически при достижении целевой цены.`,
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: keyboard },
        }
      );
    } catch (error) {
      await ctx.reply(
        `❌ Ошибка создания ордера: ${(error as Error).message}`,
        { reply_markup: { inline_keyboard: this.createCancelKeyboard() } }
      );
    }

    return true;
  }

  /**
   * Отменить все ордера
   */
  async cancelAllOrders(ctx: Context): Promise<void> {
    const activeOrders = await this.limitOrderManager.getActiveOrders();
    
    if (activeOrders.length === 0) {
      await ctx.reply(
        '📋 Нет активных ордеров для отмены.',
        {
          reply_markup: { inline_keyboard: this.createBackToLimitOrdersMenuKeyboard() },
        }
      );
      return;
    }

    for (const order of activeOrders) {
      try {
        await this.limitOrderManager.cancelOrder(order.id);
      } catch (error) {
        console.error(`Error cancelling order ${order.id}:`, error);
      }
    }

    await ctx.reply(
      `✅ Все активные ордера отменены (${activeOrders.length} шт.)`,
      {
        reply_markup: { inline_keyboard: this.createBackToLimitOrdersMenuKeyboard() },
      }
    );
  }

  /**
   * Показать детали ордера
   */
  async showOrderDetails(ctx: Context, orderId: string): Promise<void> {
    const order = await this.limitOrderManager.getOrder(orderId);
    
    if (!order) {
      await ctx.reply(
        `❌ Ордер \`${orderId}\` не найден.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const statusEmoji = this.getStatusEmoji(order.status);
    const typeEmoji = order.params.orderType === OrderType.BUY ? '🛒' : '📈';
    
    let message = `${statusEmoji} **Детали ордера**\n\n`;
    message += `ID: \`${order.id}\`\n`;
    message += `Тип: ${typeEmoji} ${order.params.orderType.toUpperCase()}\n`;
    message += `Токен: \`${order.params.tokenMint}\`\n`;
    message += `Количество: ${order.params.amount}\n`;
    message += `Цена: ${order.params.price.toFixed(8)} SOL\n`;
    message += `Slippage: ${order.params.slippage}%\n`;
    
    if (order.params.takeProfitPercent) {
      message += `🎯 Take Profit: +${order.params.takeProfitPercent}%\n`;
    }
    
    if (order.params.stopLossPercent) {
      message += `🛡️ Stop Loss: -${order.params.stopLossPercent}%\n`;
    }
    
    message += `\nСтатус: ${order.status}\n`;
    message += `Создан: ${DisplayHelper.formatTimestamp(order.createdAt)}`;
    
    if (order.filledAt) {
      message += `\nИсполнен: ${DisplayHelper.formatTimestamp(order.filledAt)}`;
      message += `\nЦена исполнения: ${order.filledPrice?.toFixed(8)} SOL`;
    }
    
    if (order.txSignature) {
      message += `\n\n🔍 [Solscan](https://solscan.io/tx/${order.txSignature})`;
    }

    const keyboard = this.createOrderDetailsKeyboard(orderId, order.status);

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard },
    });
  }

  /**
   * Отменить ордер
   */
  async cancelOrder(ctx: Context, orderId: string): Promise<void> {
    try {
      await this.limitOrderManager.cancelOrder(orderId);
      
      await ctx.reply(
        `✅ Ордер \`${orderId.slice(0, 12)}...\` отменен.`,
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: this.createBackToOrdersListKeyboard() },
        }
      );
    } catch (error) {
      await ctx.reply(
        `❌ Ошибка отмены ордера: ${(error as Error).message}`,
        { reply_markup: { inline_keyboard: this.createBackToOrdersListKeyboard() } }
      );
    }
  }

  /**
   * Обработать callback query
   */
  async handleCallback(ctx: Context): Promise<void> {
    const callbackData = ctx.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
    
    console.log('🎯 [TradingPanel.handleCallback] Received callback:', callbackData);
    
    if (!callbackData) {
      console.log('🎯 [TradingPanel.handleCallback] No callback data, returning');
      return;
    }

    const [action, ...params] = callbackData.split(':');
    
    console.log('🎯 [TradingPanel.handleCallback] Parsed action:', action, 'params:', params);

    try {
      await ctx.answerCbQuery();

      switch (action) {
        case 'main_menu':
          console.log('🎯 [TradingPanel.handleCallback] Action: main_menu');
          await this.showMainMenu(ctx);
          break;
        case 'limit_orders':
          console.log('🎯 [TradingPanel.handleCallback] Action: limit_orders');
          await this.showLimitOrdersMenu(ctx);
          break;
        case 'orders_list':
          console.log('🎯 [TradingPanel.handleCallback] Action: orders_list');
          await this.showOrdersList(ctx);
          break;
        case 'create_order':
          console.log('🎯 [TradingPanel.handleCallback] Action: create_order');
          await this.startCreateOrder(ctx);
          break;
        case 'cancel_all_orders':
          console.log('🎯 [TradingPanel.handleCallback] Action: cancel_all_orders');
          await this.cancelAllOrders(ctx);
          break;
        case 'order_details':
          console.log('🎯 [TradingPanel.handleCallback] Action: order_details, params:', params);
          if (params[0]) {
            await this.showOrderDetails(ctx, params[0]);
          }
          break;
        case 'cancel_order':
          console.log('🎯 [TradingPanel.handleCallback] Action: cancel_order, params:', params);
          if (params[0]) {
            await this.cancelOrder(ctx, params[0]);
          }
          break;
        case 'settings':
          console.log('🎯 [TradingPanel.handleCallback] Action: settings');
          await this.showSettings(ctx);
          break;
        case 'toggle_mev':
          console.log('🎯 [TradingPanel.handleCallback] Action: toggle_mev');
          await this.toggleMEV(ctx);
          break;
        case 'change_slippage':
          console.log('🎯 [TradingPanel.handleCallback] Action: change_slippage');
          await this.changeSlippage(ctx);
          break;
        case 'change_speed':
          console.log('🎯 [TradingPanel.handleCallback] Action: change_speed');
          await this.changeSpeed(ctx);
          break;
        case 'cancel_action':
          console.log('🎯 [TradingPanel.handleCallback] Action: cancel_action');
          await this.cancelAction(ctx);
          break;
        case 'buy_token':
          console.log('🎯 [TradingPanel.handleCallback] Action: buy_token - NOT IMPLEMENTED');
          await ctx.reply('🛒 Функция покупки токена в разработке');
          break;
        case 'sell_token':
          console.log('🎯 [TradingPanel.handleCallback] Action: sell_token - NOT IMPLEMENTED');
          await ctx.reply('📈 Функция продажи токена в разработке');
          break;
        case 'get_quote':
          console.log('🎯 [TradingPanel.handleCallback] Action: get_quote - NOT IMPLEMENTED');
          await ctx.reply('💹 Функция котировки в разработке');
          break;
        case 'order_type':
          console.log('🎯 [TradingPanel.handleCallback] Action: order_type, params:', params);
          // Обработка выбора типа ордера через callback
          if (params[0] && (params[0] === 'buy' || params[0] === 'sell')) {
            const userId = ctx.from?.id;
            if (userId) {
              const pending = this.pendingActions.get(userId);
              if (pending) {
                const orderType = params[0] === 'buy' ? 'BUY' : 'SELL';
                console.log('🎯 [TradingPanel.handleCallback] Setting order type to:', orderType);
                // Вызываем обработчик текстового ввода с текстом "buy" или "sell"
                await this.handleOrderTypeInput(ctx, params[0]);
              } else {
                console.log('🎯 [TradingPanel.handleCallback] No pending action for user');
              }
            }
          }
          break;
        case 'take_profit':
          console.log('🎯 [TradingPanel.handleCallback] Action: take_profit, params:', params);
          // Обработка выбора take profit через callback
          if (params[0]) {
            const userId = ctx.from?.id;
            if (userId) {
              const pending = this.pendingActions.get(userId);
              if (pending) {
                console.log('🎯 [TradingPanel.handleCallback] Setting take profit to:', params[0]);
                // Вызываем обработчик текстового ввода с выбранным значением
                await this.handleOrderTakeProfitInput(ctx, params[0]);
              } else {
                console.log('🎯 [TradingPanel.handleCallback] No pending action for user');
              }
            }
          }
          break;
        case 'set_slippage':
          console.log('🎯 [TradingPanel.handleCallback] Action: set_slippage, params:', params);
          if (params[0]) {
            const slippage = parseFloat(params[0]);
            if (!isNaN(slippage)) {
              this.userSettings.slippage = slippage;
              console.log('🎯 [TradingPanel.handleCallback] Slippage set to:', slippage);
              await this.showSettings(ctx);
            }
          }
          break;
        case 'set_speed':
          console.log('🎯 [TradingPanel.handleCallback] Action: set_speed, params:', params);
          if (params[0] && ['low', 'normal', 'aggressive'].includes(params[0])) {
            this.userSettings.speedStrategy = params[0] as any;
            console.log('🎯 [TradingPanel.handleCallback] Speed set to:', params[0]);
            await this.showSettings(ctx);
          }
          break;
        default:
          console.log(`🎯 [TradingPanel.handleCallback] Unknown callback action: ${action}`);
      }
    } catch (error) {
      console.error('🎯 [TradingPanel.handleCallback] Error handling callback:', error);
      await ctx.reply(`❌ Ошибка: ${(error as Error).message}`);
    }
  }

  /**
   * Переключить MEV защиту
   */
  private async toggleMEV(ctx: Context): Promise<void> {
    this.userSettings.mevProtection = !this.userSettings.mevProtection;
    
    await this.showSettings(ctx);
  }

  /**
   * Изменить slippage
   */
  private async changeSlippage(ctx: Context): Promise<void> {
    const slippageOptions = [0.5, 1.0, 2.0, 3.0, 5.0, 10.0];
    const keyboard = slippageOptions.map(sl => [{
      text: `${sl}% ${this.userSettings.slippage === sl ? '✅' : ''}`,
      callback_data: `set_slippage:${sl}`,
    }]);

    await ctx.reply(
      '📊 **Выберите slippage**\n\n' +
      `Текущий: ${this.userSettings.slippage}%`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
      }
    );
  }

  /**
   * Изменить скорость
   */
  private async changeSpeed(ctx: Context): Promise<void> {
    const speedOptions = ['low', 'normal', 'aggressive'];
    const keyboard = speedOptions.map(speed => [{
      text: `${speed.toUpperCase()} ${this.userSettings.speedStrategy === speed ? '✅' : ''}`,
      callback_data: `set_speed:${speed}`,
    }]);

    await ctx.reply(
      '⚡ **Выберите скорость**\n\n' +
      `Текущая: ${this.userSettings.speedStrategy.toUpperCase()}`,
      {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard },
      }
    );
  }

  /**
   * Отменить текущее действие
   */
  private async cancelAction(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    this.pendingActions.delete(userId);
    
    await ctx.reply(
      '❌ Действие отменено.',
      {
        reply_markup: { inline_keyboard: this.createMainMenuKeyboard() },
      }
    );
  }

  // ===== KEYBOARD HELPERS =====

  private createMainMenuKeyboard(): InlineKeyboardButton[][] {
    return [
      [
        { text: '🛒 Купить токен', callback_data: 'buy_token' },
        { text: '📈 Продать токен', callback_data: 'sell_token' },
      ],
      [
        { text: '💹 Котировка', callback_data: 'get_quote' },
        { text: '📋 Лимитные ордера', callback_data: 'limit_orders' },
      ],
      [
        { text: '⚙️ Настройки', callback_data: 'settings' },
      ],
    ];
  }

  private createLimitOrdersMenuKeyboard(): InlineKeyboardButton[][] {
    return [
      [
        { text: '➕ Создать ордер', callback_data: 'create_order' },
        { text: '📜 Мои ордера', callback_data: 'orders_list' },
      ],
      [
        { text: '❌ Отменить все', callback_data: 'cancel_all_orders' },
      ],
      [
        { text: '🔙 Назад', callback_data: 'main_menu' },
      ],
    ];
  }

  private createBackToLimitOrdersMenuKeyboard(): InlineKeyboardButton[][] {
    return [
      [
        { text: '🔙 Назад к ордерам', callback_data: 'limit_orders' },
      ],
    ];
  }

  private createBackToOrdersListKeyboard(): InlineKeyboardButton[][] {
    return [
      [
        { text: '🔙 Назад к списку', callback_data: 'orders_list' },
      ],
    ];
  }

  private createSettingsKeyboard(): InlineKeyboardButton[][] {
    return [
      [
        { text: `📊 Slippage: ${this.userSettings.slippage}%`, callback_data: 'change_slippage' },
      ],
      [
        { text: `🛡️ MEV защита: ${this.userSettings.mevProtection ? '✅ Включена' : '❌ Выключена'}`, callback_data: 'toggle_mev' },
      ],
      [
        { text: `⚡ Скорость: ${this.userSettings.speedStrategy.toUpperCase()}`, callback_data: 'change_speed' },
      ],
      [
        { text: '🔙 Назад', callback_data: 'main_menu' },
      ],
    ];
  }

  private createOrderTypeKeyboard(): InlineKeyboardButton[][] {
    return [
      [
        { text: '🛒 Купить', callback_data: 'order_type:buy' },
        { text: '📈 Продать', callback_data: 'order_type:sell' },
      ],
      [
        { text: '❌ Отмена', callback_data: 'cancel_action' },
      ],
    ];
  }

  private createTakeProfitKeyboard(): InlineKeyboardButton[][] {
    return [
      [
        { text: '🎯 +10%', callback_data: 'take_profit:10' },
        { text: '🎯 +25%', callback_data: 'take_profit:25' },
        { text: '🎯 +50%', callback_data: 'take_profit:50' },
      ],
      [
        { text: '🎯 +100%', callback_data: 'take_profit:100' },
        { text: '🎯 +200%', callback_data: 'take_profit:200' },
      ],
      [
        { text: '⏭️ Пропустить', callback_data: 'take_profit:skip' },
        { text: '❌ Отмена', callback_data: 'cancel_action' },
      ],
    ];
  }

  private createOrderDetailsKeyboard(orderId: string, status: OrderStatus): InlineKeyboardButton[][] {
    const keyboard: InlineKeyboardButton[][] = [
      [
        { text: '🔙 Назад к списку', callback_data: 'orders_list' },
      ],
    ];

    if (status === OrderStatus.PENDING) {
      keyboard.unshift([
        { text: '❌ Отменить ордер', callback_data: `cancel_order:${orderId}` },
      ]);
    }

    return keyboard;
  }

  private createCancelKeyboard(): InlineKeyboardButton[][] {
    return [
      [
        { text: '❌ Отмена', callback_data: 'cancel_action' },
      ],
    ];
  }

  private getStatusEmoji(status: OrderStatus): string {
    switch (status) {
      case OrderStatus.PENDING:
        return '⏳';
      case OrderStatus.FILLED:
        return '✅';
      case OrderStatus.CANCELLED:
        return '❌';
      case OrderStatus.EXPIRED:
        return '⏰';
      case OrderStatus.ERROR:
        return '⚠️';
      default:
        return '❓';
    }
  }
}
