import { Telegraf, Context } from 'telegraf';
import { InlineKeyboardButton } from 'telegraf/types';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TradeRouter } from '../trading/router/TradeRouter';
import { ILimitOrderManager, LimitOrderParams, OrderType } from '../trading/managers/ILimitOrderManager';
import { UserSettings } from '../trading/router/ITradingStrategy';
import { WalletManager } from '../wallet/WalletManager';
import { StateManager } from '../services/StateManager';
import { TokenDataFetcher } from '../services/TokenDataFetcher';
import { PositionTracker } from '../services/PositionTracker';
import { TPSLManager } from '../services/TPSLManager';
import { AutoRefreshService } from '../services/AutoRefreshService';
import { SolanaProvider } from '../chains/SolanaProvider';
import realtimeService from '../services/RealtimeService';
import {
  UserPanelState,
  PanelMode,
  TokenData,
  UserData,
  ActionData,
  PositionData
} from '../types/panel';

/**
 * Переработанная торговая панель с единым контекстом токена
 */
export class TradingPanel {
  private lastTradeTime: Map<number, number> = new Map();
  private readonly TRADE_COOLDOWN = 3000; // 3 секунды
  private bot: Telegraf;
  private tradeRouter: TradeRouter;
  private limitOrderManager: ILimitOrderManager;
  private walletManager: WalletManager;
  private userSettings: UserSettings;
  private stateManager: StateManager;
  private tokenDataFetcher: TokenDataFetcher;
  private positionTracker: PositionTracker;
  private tpslManager: TPSLManager;
  private autoRefreshService: AutoRefreshService | null;
  private solanaProvider: SolanaProvider;

  constructor(
    bot: Telegraf,
    tradeRouter: TradeRouter,
    limitOrderManager: ILimitOrderManager,
    walletManager: WalletManager,
    userSettings: UserSettings,
    stateManager: StateManager,
    tokenDataFetcher: TokenDataFetcher,
    positionTracker: PositionTracker,
    tpslManager: TPSLManager,
    autoRefreshService: AutoRefreshService | null,
    solanaProvider: SolanaProvider
  ) {
    this.bot = bot;
    this.tradeRouter = tradeRouter;
    this.limitOrderManager = limitOrderManager;
    this.walletManager = walletManager;
    this.userSettings = userSettings;
    this.stateManager = stateManager;
    this.tokenDataFetcher = tokenDataFetcher;
    this.positionTracker = positionTracker;
    this.tpslManager = tpslManager;
    this.autoRefreshService = autoRefreshService;
    this.solanaProvider = solanaProvider;
  }

  /**
   * Установить AutoRefreshService (для разрешения циклической зависимости)
   */
  setAutoRefreshService(service: AutoRefreshService): void {
    this.autoRefreshService = service;
  }

  /**
   * Сгенерировать текст панели
   */
  generatePanelText(state: UserPanelState): string {
    const { token_data, user_data, mode, action_data } = state;
    
    // Индикатор Realtime соединения
    const realtimeStatus = realtimeService.isConnected() ? '🟢 Live' : '🟡 Polling';

    let text = `🪙 ${token_data.name} (${token_data.ticker}) ${realtimeStatus}\n`;
    text += `📝 \`${state.token_address.slice(0, 8)}...${state.token_address.slice(-8)}\`\n`;
    text += `━━━━━━━━━━━━━━━━\n\n`;
    text += `📊 Market Cap: $${this.formatNumber(token_data.market_cap)}\n`;
    text += `💧 Liquidity: $${this.formatNumber(token_data.liquidity)}\n`;
    text += `💵 Current Price: ${token_data.current_price.toFixed(8)} SOL\n`;
    text += `━━━━━━━━━━━━━━━━\n\n`;
    text += `💼 Balance: ${user_data.sol_balance.toFixed(4)} SOL ($${this.formatNumber(user_data.usd_balance)})\n`;
    text += `📌 Active Order: ${user_data.has_active_order ? 'Yes' : 'No'}\n`;
    text += `━━━━━━━━━━━━━━━━\n\n`;
    text += this.generateActionText(state);

    if (action_data.tp_enabled || action_data.sl_enabled) {
      text += `━━━━━━━━━━━━━━━━\n\n`;
      text += `🎯 Risk Management\n`;
      if (action_data.tp_enabled) {
        if (action_data.tp_percent) {
          text += `Take Profit: ✅ +${action_data.tp_percent}%\n`;
        } else if (action_data.tp_price) {
          text += `Take Profit: ✅ ${action_data.tp_price.toFixed(8)} SOL\n`;
        }
      } else {
        text += `Take Profit: ❌ Disabled\n`;
      }
      if (action_data.sl_enabled) {
        if (action_data.sl_percent) {
          text += `Stop Loss: ✅ -${action_data.sl_percent}%\n`;
        } else if (action_data.sl_price) {
          text += `Stop Loss: ✅ ${action_data.sl_price.toFixed(8)} SOL\n`;
        }
      } else {
        text += `Stop Loss: ❌ Disabled\n`;
      }
    }

    return text;
  }

  /**
   * Сгенерировать текст для действия
   */
  private generateActionText(state: UserPanelState): string {
    const { mode, action_data } = state;

    switch (mode) {
      case PanelMode.BUY:
        return `💰 Quick Buy\nSelected: $${action_data.selected_amount}\nSlippage: ${action_data.slippage}%\n\n`;
      case PanelMode.SELL:
        const sellPercent = action_data.position ? 
          ((action_data.selected_amount / action_data.position.size) * 100).toFixed(1) : '0';
        return `💸 Quick Sell\nAmount: ${action_data.selected_amount} tokens (${sellPercent}%)\nSlippage: ${action_data.slippage}%\n\n`;
      case PanelMode.LIMIT:
        return `⏳ Limit Order\nTarget Price: ${action_data.limit_price?.toFixed(8) || 'Not set'} SOL\nAmount: ${action_data.selected_amount}\nStatus: ${state.user_data.has_active_order ? 'Active' : 'Inactive'}\n\n`;
      case PanelMode.TRACK:
        if (action_data.position) {
          const pnlEmoji = action_data.position.pnl_percent >= 0 ? '🟢' : '🔴';
          return `📈 Position Tracking\nEntry: ${action_data.position.entry_price.toFixed(8)} SOL\nCurrent: ${action_data.position.current_price.toFixed(8)} SOL\nSize: ${action_data.position.size.toFixed(2)} tokens\nPNL: ${pnlEmoji} $${this.formatNumber(action_data.position.pnl_usd)} (${action_data.position.pnl_percent.toFixed(2)}%)\n\n`;
        }
        return `📈 Position Tracking\nNo open position\n\n`;
      default:
        return '';
    }
  }

  /**
   * Сгенерировать inline-клавиатуру
   */
  generateKeyboard(state: UserPanelState): InlineKeyboardButton[][] {
    const { mode, action_data } = state;
    const keyboard: InlineKeyboardButton[][] = [];

    keyboard.push([
      { text: mode === PanelMode.BUY ? '✅ Buy' : 'Buy', callback_data: 'mode:buy' },
      { text: mode === PanelMode.SELL ? '✅ Sell' : 'Sell', callback_data: 'mode:sell' },
      { text: mode === PanelMode.LIMIT ? '✅ Limit' : 'Limit', callback_data: 'mode:limit' },
      { text: mode === PanelMode.TRACK ? '✅ Track' : 'Track', callback_data: 'mode:track' },
    ]);

    keyboard.push(...this.generateActionButtons(state));

    keyboard.push([
      { text: '🔄 Refresh Data', callback_data: 'refresh:data' },
      { text: '❌ Close Panel', callback_data: 'panel:close' },
    ]);

    return keyboard;
  }

  /**
   * Сгенерировать кнопки действий
   */
  private generateActionButtons(state: UserPanelState): InlineKeyboardButton[][] {
    const { mode, action_data } = state;
    const buttons: InlineKeyboardButton[][] = [];

    switch (mode) {
      case PanelMode.BUY:
        buttons.push([
          { text: '$10', callback_data: 'amount:10' },
          { text: '$50', callback_data: 'amount:50' },
          { text: '$100', callback_data: 'amount:100' },
        ]);
        buttons.push([
          { text: `Slippage: ${action_data.slippage}%`, callback_data: 'slippage:set' },
          { text: 'Gas: Auto', callback_data: 'gas:auto' },
        ]);
        if (action_data.tp_enabled || action_data.sl_enabled) {
          buttons.push([
            { text: action_data.tp_enabled ? `✅ TP: +${action_data.tp_percent}%` : 'TP: Off', callback_data: 'tp:set' },
            { text: action_data.sl_enabled ? `✅ SL: -${action_data.sl_percent}%` : 'SL: Off', callback_data: 'sl:set' },
          ]);
        } else {
          buttons.push([
            { text: '🎯 TP/SL', callback_data: 'tpsl:set' },
          ]);
        }
        buttons.push([
          { text: '🟢 Execute Trade', callback_data: 'execute:buy' },
        ]);
        break;

      case PanelMode.SELL:
        buttons.push([
          { text: '25%', callback_data: 'amount:25' },
          { text: '50%', callback_data: 'amount:50' },
          { text: '100%', callback_data: 'amount:100' },
        ]);
        buttons.push([
          { text: `Slippage: ${action_data.slippage}%`, callback_data: 'slippage:set' },
          { text: 'Gas: Auto', callback_data: 'gas:auto' },
        ]);
        buttons.push([
          { text: '🔴 Execute Trade', callback_data: 'execute:sell' },
        ]);
        break;

      case PanelMode.LIMIT:
        buttons.push([
          { text: 'Set Price', callback_data: 'limit:set_price' },
          { text: 'Set Amount', callback_data: 'limit:set_amount' },
        ]);
        if (action_data.tp_enabled || action_data.sl_enabled) {
          buttons.push([
            { text: action_data.tp_enabled ? `✅ TP: +${action_data.tp_percent}%` : 'TP: Off', callback_data: 'tp:set' },
            { text: action_data.sl_enabled ? `✅ SL: -${action_data.sl_percent}%` : 'SL: Off', callback_data: 'sl:set' },
          ]);
        } else {
          buttons.push([
            { text: '🎯 TP/SL', callback_data: 'tpsl:set' },
          ]);
        }
        buttons.push([
          { text: state.user_data.has_active_order ? '❌ Cancel Order' : '📍 Place Order', 
            callback_data: state.user_data.has_active_order ? 'limit:cancel' : 'limit:place' },
        ]);
        break;

      case PanelMode.TRACK:
        buttons.push([
          { text: '🔄 Refresh', callback_data: 'refresh:data' },
          { text: '📊 Chart', callback_data: 'chart:view' },
        ]);
        break;
    }

    return buttons;
  }

  /**
   * Обработать callback query
   */
  async handleCallback(ctx: Context): Promise<void> {
    const callbackData = ctx.callbackQuery && 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
    
    if (!callbackData) {
      return;
    }

    const userId = ctx.from?.id;
    if (!userId) {
      return;
    }

    const state = await this.stateManager.getState(userId);
    if (!state) {
      await ctx.answerCbQuery('⚠️ Panel expired or not found. Please send token address again.');
      return;
    }

    try {
      await ctx.answerCbQuery();

      const [action, ...params] = callbackData.split(':');

      switch (action) {
        case 'mode':
          await this.handleModeChange(state, params[0]);
          break;
        case 'amount':
          await this.handleAmountChange(state, params[0]);
          break;
        case 'slippage':
          await this.handleSlippageChange(state, params[0]);
          break;
        case 'gas':
          await this.handleGasChange(state, params[0]);
          break;
        case 'execute':
          if (params[0] === 'buy') {
            await this.executeBuy(state);
          } else if (params[0] === 'sell') {
            await this.executeSell(state);
          }
          break;
        case 'limit':
          await this.handleLimitAction(state, params[0], ctx);
          break;
        case 'tp':
          await this.handleTPAction(state, params[0], ctx);
          break;
        case 'sl':
          await this.handleSLAction(state, params[0], ctx);
          break;
        case 'tpsl':
          await this.handleTPSLToggle(state, ctx);
          break;
        case 'refresh':
          await this.handleRefresh(state);
          break;
        case 'chart':
          await this.handleChart(state);
          break;
        case 'panel':
          if (params[0] === 'close') {
            await this.closePanel(state);
          }
          break;
        default:
          console.log(`[TradingPanel] Unknown callback action: ${action}`);
      }

      // Сохраняем измененное состояние в БД
      await this.stateManager.setState(userId, state);
      // Обновляем сообщение
      await this.updatePanelMessage(state);
    } catch (error: any) {
      console.error('[TradingPanel] Error handling callback:', error);
      await ctx.reply(`❌ Error: ${(error as Error).message}`);
    }
  }

  /**
   * Обработать текстовый ввод
   */
  async handleTextInput(ctx: Context): Promise<boolean> {
    const userId = ctx.from?.id;
    if (!userId) {
      return false;
    }

    const state = await this.stateManager.getState(userId);
    if (!state || !state.waiting_for) {
      return false;
    }

    const text = ctx.message && 'text' in ctx.message ? ctx.message.text : undefined;
    if (!text) {
      return false;
    }

    try {
      switch (state.waiting_for) {
        case 'limit_price':
          await this.handleLimitPriceInput(state, text);
          break;
        case 'limit_amount':
          await this.handleLimitAmountInput(state, text);
          break;
        case 'tp_price':
          await this.handleTPPriceInput(state, text);
          break;
        case 'sl_price':
          await this.handleSLPriceInput(state, text);
          break;
        default:
          return false;
      }

      state.waiting_for = undefined;
      await this.updatePanelMessage(state);
      await this.stateManager.setState(userId, state);
      return true;
    } catch (error: any) {
      console.error('[TradingPanel] Error handling text input:', error);
      await ctx.reply(`❌ Error: ${error.message}`);
      // Сбрасываем флаг даже при ошибке, чтобы не застревать в ожидании
      state.waiting_for = undefined;
      await this.stateManager.setState(userId, state);
      return true;
    }
  }

  private async handleModeChange(state: UserPanelState, mode: string): Promise<void> {
    const modeMap: Record<string, PanelMode> = {
      'buy': PanelMode.BUY,
      'sell': PanelMode.SELL,
      'limit': PanelMode.LIMIT,
      'track': PanelMode.TRACK,
    };

    if (modeMap[mode]) {
      state.mode = modeMap[mode];
      if (mode === 'track') {
        const position = await this.positionTracker.getPosition(state.user_id, state.token_address);
        if (position) {
          state.action_data.position = position;
        }
      }
    }
  }

  private async handleAmountChange(state: UserPanelState, amount: string): Promise<void> {
    const value = parseFloat(amount);
    if (!isNaN(value) && value > 0) {
      state.action_data.selected_amount = value;
    }
  }

  private async handleSlippageChange(state: UserPanelState, action: string): Promise<void> {
    if (action === 'set') {
      state.action_data.slippage = 1.0;
    } else {
      const value = parseFloat(action);
      if (!isNaN(value) && value > 0) {
        state.action_data.slippage = value;
      }
    }
  }

  private async handleGasChange(state: UserPanelState, action: string): Promise<void> {
    // Газ всегда Auto
  }

  private async handleLimitAction(state: UserPanelState, action: string, ctx: Context): Promise<void> {
    switch (action) {
      case 'set_price':
        state.waiting_for = 'limit_price';
        await ctx.reply('💬 Enter target price (in SOL):');
        break;
      case 'set_amount':
        state.waiting_for = 'limit_amount';
        await ctx.reply('💬 Enter amount:');
        break;
      case 'place':
        await this.placeLimitOrder(state);
        break;
      case 'cancel':
        await this.cancelLimitOrder(state);
        break;
    }
  }

  private async handleTPAction(state: UserPanelState, action: string, ctx: Context): Promise<void> {
    if (action === 'set') {
      state.waiting_for = 'tp_price';
      await ctx.reply('💬 Enter Take Profit price (in SOL) or percentage (e.g., 50 for 50%):');
    } else if (action === 'disable') {
      await this.disableTakeProfit(state);
    }
  }

  private async handleSLAction(state: UserPanelState, action: string, ctx: Context): Promise<void> {
    if (action === 'set') {
      state.waiting_for = 'sl_price';
      await ctx.reply('💬 Enter Stop Loss price (in SOL) or percentage (e.g., 10 for 10%):');
    } else if (action === 'disable') {
      await this.disableStopLoss(state);
    }
  }

  private async handleTPSLToggle(state: UserPanelState, ctx: Context): Promise<void> {
    if (!state.action_data.tp_enabled && !state.action_data.sl_enabled) {
      state.action_data.tp_enabled = true;
      state.action_data.sl_enabled = true;
      state.action_data.tp_percent = 50;
      state.action_data.sl_percent = 10;
      await ctx.reply('✅ TP/SL enabled with default values: TP +50%, SL -10%');
    } else {
      await this.disableTakeProfit(state);
      await this.disableStopLoss(state);
      await ctx.reply('❌ TP/SL disabled');
    }
  }

  private async handleRefresh(state: UserPanelState): Promise<void> {
    const updatedTokenData = await this.tokenDataFetcher.fetchTokenData(state.token_address);
    if (updatedTokenData) {
      state.token_data = updatedTokenData;
    }
  }

  private async handleChart(state: UserPanelState): Promise<void> {
    // Можно добавить интеграцию с графиками в будущем
  }

  private async handleLimitPriceInput(state: UserPanelState, text: string): Promise<void> {
    const price = parseFloat(text);
    if (isNaN(price) || price <= 0) {
      throw new Error('Invalid price. Please enter a positive number.');
    }
    state.action_data.limit_price = price;
  }

  private async handleLimitAmountInput(state: UserPanelState, text: string): Promise<void> {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) {
      throw new Error('Invalid amount. Please enter a positive number.');
    }
    state.action_data.selected_amount = amount;
  }

  private async handleTPPriceInput(state: UserPanelState, text: string): Promise<void> {
    if (text.includes('%')) {
      const percent = parseFloat(text.replace('%', ''));
      if (isNaN(percent) || percent <= 0) {
        throw new Error('Invalid percentage. Please enter a positive number.');
      }
      state.action_data.tp_percent = percent;
      state.action_data.tp_price = undefined;
    } else {
      const price = parseFloat(text);
      if (isNaN(price) || price <= 0) {
        throw new Error('Invalid price. Please enter a positive number.');
      }
      state.action_data.tp_price = price;
      state.action_data.tp_percent = undefined;
    }
    state.action_data.tp_enabled = true;
  }

  private async handleSLPriceInput(state: UserPanelState, text: string): Promise<void> {
    if (text.includes('%')) {
      const percent = parseFloat(text.replace('%', ''));
      if (isNaN(percent) || percent <= 0) {
        throw new Error('Invalid percentage. Please enter a positive number.');
      }
      state.action_data.sl_percent = percent;
      state.action_data.sl_price = undefined;
    } else {
      const price = parseFloat(text);
      if (isNaN(price) || price <= 0) {
        throw new Error('Invalid price. Please enter a positive number.');
      }
      state.action_data.sl_price = price;
      state.action_data.sl_percent = undefined;
    }
    state.action_data.sl_enabled = true;
  }

  private async executeBuy(state: UserPanelState): Promise<void> {
    this.checkRateLimit(state.user_id);
    const { token_address, action_data, user_data } = state;
    
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
    
    // 1. Получить текущую цену SOL в USD (с fallback)
    const solPriceUSD = await this.tokenDataFetcher.getSOLPriceInUSD() || 150;
    
    // 2. Конвертировать USD в SOL
    const amountUSD = action_data.selected_amount;
    const amountSOL = amountUSD / solPriceUSD;
    const amountLamports = Math.floor(amountSOL * LAMPORTS_PER_SOL);
    
    console.log(`[TradingPanel] Buying for $${amountUSD} (${amountSOL.toFixed(4)} SOL) at rate ${solPriceUSD}`);
    
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
    
    const txSignature = result.signature;
    const price = state.token_data.current_price;
    const amountTokens = result.outputAmount / Math.pow(10, state.token_data.decimals || 9);

    // 5. Записать позицию
    const updatedPosition = await this.positionTracker.recordTrade(state.user_id, token_address, 'BUY', price, amountTokens);

    // 6. Обновить баланс пользователя
    const newBalance = await this.solanaProvider.getBalance(wallet.publicKey.toString());
    const newBalanceSOL = newBalance / LAMPORTS_PER_SOL;
    const newBalanceUSD = newBalanceSOL * solPriceUSD;
    
    state.user_data.sol_balance = newBalanceSOL;
    state.user_data.usd_balance = newBalanceUSD;

    // 7. Обновить позицию в состоянии
    const currentPrice = await this.tokenDataFetcher.getCurrentPrice(token_address);
    if (currentPrice) {
      const positionData = await this.positionTracker.getPosition(state.user_id, token_address);
      if (positionData) {
        const pnl = this.positionTracker.calculatePNL(positionData, currentPrice);
        state.action_data.position = {
          ...positionData,
          current_price: currentPrice,
          pnl_usd: pnl.pnl_usd,
          pnl_percent: pnl.pnl_percent,
        };
      }
    }

    // 8. Создать TP/SL если включены
    if (action_data.tp_enabled || action_data.sl_enabled) {
      try {
        await this.tpslManager.createTPSLOrders(updatedPosition, {
          tpPercent: action_data.tp_percent,
          slPercent: action_data.sl_percent
        });
      } catch (error) {
        console.error('[TradingPanel] Failed to create TP/SL:', error);
        // Уведомить пользователя об ошибке
        await this.bot.telegram.sendMessage(
          Number(state.user_id),
          '⚠️ Warning: Failed to create TP/SL orders. Your position was opened but risk management is not active.'
        );
      }
    }

    console.log(`[TradingPanel] Buy executed: ${amountTokens.toFixed(4)} tokens at ${price} SOL`);
  }

  private async executeSell(state: UserPanelState): Promise<void> {
    this.checkRateLimit(state.user_id);
    const { token_address, action_data, user_id, token_data } = state;

    if (!action_data.position) {
      throw new Error('No position to sell');
    }

    const wallet = await this.walletManager.getWallet();
    if (!wallet) {
      throw new Error('Wallet not found');
    }

    // 1. Получить актуальную позицию
    const position = await this.positionTracker.getPosition(user_id, token_address);
    if (!position || position.size <= 0) {
      throw new Error('No active position found to sell.');
    }

    // 2. Валидация процента продажи
    if (action_data.selected_amount <= 0 || action_data.selected_amount > 100) {
      throw new Error('Invalid sell percentage. Must be between 0 and 100.');
    }

    // 3. Рассчитать количество токенов для продажи в их основной единице (не lamports)
    const amountToSellInTokenUnits = position.size * (action_data.selected_amount / 100);
    
    // 4. Проверить, что есть что продавать
    if (amountToSellInTokenUnits <= 0) {
      throw new Error('Nothing to sell.');
    }

    // 3. Конвертировать в базовые единицы (как lamports для токена)
    const amountToSellInBaseUnits = Math.floor(amountToSellInTokenUnits * Math.pow(10, token_data.decimals || 9));

    if (amountToSellInBaseUnits <= 0) {
        throw new Error("Calculated amount to sell is zero.");
    }

    // 4. Выполнить продажу с корректным количеством
    const result = await this.tradeRouter.sell(
      'Solana',
      token_address,
      amountToSellInBaseUnits,
      this.userSettings,
      wallet
    );

    const txSignature = result.signature;
    const receivedSol = result.outputAmount / LAMPORTS_PER_SOL; // Получаем SOL из результата

    // 5. Записать сделку
    const updatedPosition = await this.positionTracker.recordTrade(
        user_id,
        token_address,
        'SELL',
        token_data.current_price,
        amountToSellInTokenUnits // Записываем количество в токенах
    );

    console.log(`[TradingPanel] Sell executed for ${action_data.selected_amount}% of position (${amountToSellInTokenUnits.toFixed(4)} tokens). Received ~${receivedSol.toFixed(6)} SOL. Tx: ${txSignature}`);
    if (updatedPosition.size === 0) {
        console.log(`[TradingPanel] Position for ${token_address} closed.`);
        await this.tpslManager.cancelRelatedOrders(updatedPosition.id);
    }

    // Обновить баланс
    const solPriceUSD = await this.tokenDataFetcher.getSOLPriceInUSD() || 150;
    const newBalance = await this.solanaProvider.getBalance(wallet.publicKey.toString());
    const newBalanceSOL = newBalance / LAMPORTS_PER_SOL;
    
    state.user_data.sol_balance = newBalanceSOL;
    state.user_data.usd_balance = newBalanceSOL * solPriceUSD;
    
    // Обновить позицию в состоянии
    const positionData = await this.positionTracker.getPosition(state.user_id, token_address);
    if (positionData && positionData.size > 0) {
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
  }

  private async placeLimitOrder(state: UserPanelState): Promise<void> {
    const { token_address, action_data, user_id } = state;

    if (!action_data.limit_price || !action_data.selected_amount) {
      throw new Error('Please set price and amount first');
    }

    // Конвертация USD в lamports (action_data.selected_amount - это USD)
    const solPriceUSD = await this.tokenDataFetcher.getSOLPriceInUSD() || 150;
    
    const amountUSD = action_data.selected_amount;
    const amountSOL = amountUSD / solPriceUSD;
    const amountLamports = Math.floor(amountSOL * LAMPORTS_PER_SOL);

    const params: LimitOrderParams = {
      userId: user_id, // Передаем userId из состояния
      tokenMint: token_address,
      orderType: OrderType.BUY,
      amount: amountLamports, // В lamports!
      price: action_data.limit_price,
      slippage: action_data.slippage,
    };

    const orderId = await this.limitOrderManager.createOrder(params);

    // Сохраняем ID ордера в состоянии
    state.user_data.has_active_order = true;
    state.activeLimitOrderId = orderId;

    console.log(`[TradingPanel] Limit order placed: ${orderId} for user ${user_id}`);
  }

  private async cancelLimitOrder(state: UserPanelState): Promise<void> {
    const orderId = state.activeLimitOrderId;
    
    if (!orderId) {
      throw new Error("No active limit order to cancel");
    }
    
    // Отменить ордер в блокчейне
    await this.limitOrderManager.cancelOrder(orderId);
    
    // Отменить связанные TP/SL ордера
    await this.tpslManager.cancelRelatedOrders(orderId);
    
    // Обновить состояние
    state.user_data.has_active_order = false;
    state.activeLimitOrderId = undefined;
    
    console.log(`[TradingPanel] Limit order cancelled: ${orderId} for user ${state.user_id}`);
  }

  private async setTakeProfit(state: UserPanelState, price?: number, percent?: number): Promise<void> {
    if (price) {
      state.action_data.tp_price = price;
      state.action_data.tp_percent = undefined;
    } else if (percent) {
      state.action_data.tp_percent = percent;
      state.action_data.tp_price = undefined;
    }
    state.action_data.tp_enabled = true;
  }

  private async setStopLoss(state: UserPanelState, price?: number, percent?: number): Promise<void> {
    if (price) {
      state.action_data.sl_price = price;
      state.action_data.sl_percent = undefined;
    } else if (percent) {
      state.action_data.sl_percent = percent;
      state.action_data.sl_price = undefined;
    }
    state.action_data.sl_enabled = true;
  }

  private async disableTakeProfit(state: UserPanelState): Promise<void> {
    state.action_data.tp_enabled = false;
    state.action_data.tp_price = undefined;
    state.action_data.tp_percent = undefined;
  }

  private async disableStopLoss(state: UserPanelState): Promise<void> {
    state.action_data.sl_enabled = false;
    state.action_data.sl_price = undefined;
    state.action_data.sl_percent = undefined;
  }

  private async closePanel(state: UserPanelState): Promise<void> {
    state.closed = true;
    await this.stateManager.setState(state.user_id, state);
    if (this.autoRefreshService) {
      this.autoRefreshService.stopAutoRefresh(state.user_id);
    }
    await this.updatePanelMessage(state, true); // Обновляем с сообщением о закрытии
    
    console.log(`[TradingPanel] Panel closed for user ${state.user_id}`);
  }

  private async updatePanelMessage(state: UserPanelState, isClosed = false): Promise<void> {
    const text = isClosed ? "Panel closed." : this.generatePanelText(state);
    const keyboard = isClosed ? { inline_keyboard: [] } : { reply_markup: { inline_keyboard: this.generateKeyboard(state) }};

    try {
      await this.bot.telegram.editMessageText(
        Number(state.user_id),
        state.message_id,
        undefined,
        text,
        {
          parse_mode: 'Markdown',
          ...keyboard,
        }
      );
    } catch (error: any) {
        // Игнорируем частую ошибку "message is not modified"
        if (error.code !== 400 || !error.description.includes('message is not modified')) {
            console.error('[TradingPanel] Error updating message:', error);
        }
    }
  }

  private checkRateLimit(userId: number): void {
    const now = Date.now();
    const lastTrade = this.lastTradeTime.get(userId) || 0;
    
    if (now - lastTrade < this.TRADE_COOLDOWN) {
      const waitTime = Math.ceil((this.TRADE_COOLDOWN - (now - lastTrade)) / 1000);
      throw new Error(`Please wait ${waitTime} seconds between trades`);
    }
    
    this.lastTradeTime.set(userId, now);
  }

  private formatNumber(num: number): string {
    if (num >=1_000_000) {
      return (num / 1_000_000).toFixed(2) + 'M';
    } else if (num >=1_000) {
      return (num / 1_000).toFixed(2) + 'K';
    } else if (num >= 1) {
      return num.toFixed(2);
    } else {
      return num.toFixed(4);
    }
  }
}
