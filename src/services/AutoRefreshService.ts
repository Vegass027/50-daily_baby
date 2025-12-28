import { Telegraf, Context } from 'telegraf';
import { StateManager } from './StateManager';
import { TokenDataFetcher } from './TokenDataFetcher';
import { UserPanelState } from '../types/panel';
import { TradingPanel } from '../panels/TradingPanel';
import { WalletManager } from '../wallet/WalletManager';
import { SolanaProvider } from '../chains/SolanaProvider';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import realtimeService, { RealtimePayload } from './RealtimeService';

/**
 * Сервис авто-обновления торговых панелей
 */
export class AutoRefreshService {
  private refreshIntervals: Map<number, NodeJS.Timeout> = new Map();
  private stateManager: StateManager;
  private tokenDataFetcher: TokenDataFetcher;
  private bot: Telegraf;
  private tradingPanel: TradingPanel;
  private walletManager: WalletManager;
  private solanaProvider: SolanaProvider;
  private readonly REFRESH_INTERVAL: number = 5000; // 5 секунд
  private useRealtime: boolean = true; // Флаг использования Realtime
  private realtimeConnected: boolean = false;
  private fallbackInterval: NodeJS.Timeout | null = null;
  private healthMonitorInterval: NodeJS.Timeout | null = null;

  constructor(
    bot: Telegraf,
    stateManager: StateManager,
    tokenDataFetcher: TokenDataFetcher,
    tradingPanel: TradingPanel,
    walletManager: WalletManager,
    solanaProvider: SolanaProvider
  ) {
    this.bot = bot;
    this.stateManager = stateManager;
    this.tokenDataFetcher = tokenDataFetcher;
    this.tradingPanel = tradingPanel;
    this.walletManager = walletManager;
    this.solanaProvider = solanaProvider;
  }

  /**
   * Инициализация сервиса
   */
  async initialize(): Promise<void> {
    console.log('[AutoRefreshService] Initializing...');
    
    // Подключить Realtime subscriptions
    if (this.useRealtime) {
      await this.setupRealtimeSubscriptions();
    }

    // Запустить fallback polling (реже, как backup)
    this.startFallbackPolling();
    
    // Запустить мониторинг Realtime health
    this.monitorRealtimeHealth();
  }

  /**
   * Настройка Realtime subscriptions
   */
  private async setupRealtimeSubscriptions(): Promise<void> {
    try {
      // Подписка на ордера
      realtimeService.subscribeToOrders(async (payload) => {
        this.realtimeConnected = true;
        await this.handleOrderChange(payload);
      });

      // Подписка на позиции
      realtimeService.subscribeToPositions(async (payload) => {
        await this.handlePositionChange(payload);
      });

      // Подписка на сделки
      realtimeService.subscribeToTrades(async (payload) => {
        await this.handleTradeChange(payload);
      });

      console.log('[AutoRefreshService] Realtime subscriptions active');
    } catch (error) {
      console.error('[AutoRefreshService] Realtime setup failed:', error);
      this.useRealtime = false; // Fallback to polling only
    }
  }

  /**
   * Обработка изменения ордера через Realtime
   */
  private async handleOrderChange(payload: RealtimePayload): Promise<void> {
    console.log('[AutoRefreshService] Order changed via Realtime:', payload.eventType);
    
    // Обновить UI для всех активных панелей с ордерами
    const allStates = await this.stateManager.getAllStates();
    
    for (const state of allStates) {
      if (state.activeLimitOrderId) {
        await this.refreshPanel(state.user_id);
      }
    }
  }

  /**
   * Обработка изменения позиции через Realtime
   */
  private async handlePositionChange(payload: RealtimePayload): Promise<void> {
    console.log('[AutoRefreshService] Position changed via Realtime:', payload.eventType);
    
    // Обновить UI для всех активных панелей с позициями
    const allStates = await this.stateManager.getAllStates();
    
    for (const state of allStates) {
      await this.refreshPanel(state.user_id);
    }
  }

  /**
   * Обработка новой сделки через Realtime
   */
  private async handleTradeChange(payload: RealtimePayload): Promise<void> {
    console.log('[AutoRefreshService] New trade via Realtime');
    
    // Обновить UI для всех активных панелей
    const allStates = await this.stateManager.getAllStates();
    
    for (const state of allStates) {
      await this.refreshPanel(state.user_id);
    }
  }

  /**
   * Запуск fallback polling
   */
  private startFallbackPolling(): void {
    // Очистить существующий interval если есть
    if (this.fallbackInterval) {
      clearInterval(this.fallbackInterval);
    }
    
    // Polling каждые 10 секунд с Realtime, 5 секунд без Realtime
    const FALLBACK_INTERVAL = this.useRealtime ? 10000 : 5000;
    
    this.fallbackInterval = setInterval(async () => {
      if (!this.realtimeConnected && this.useRealtime) {
        console.warn('[AutoRefreshService] Realtime disconnected, using polling');
      }
      
      // Обновить только если Realtime не работает
      if (!this.useRealtime || !this.realtimeConnected) {
        const allStates = await this.stateManager.getAllStates();
        for (const state of allStates) {
          await this.refreshPanel(state.user_id);
        }
      }
    }, FALLBACK_INTERVAL);
  }

  /**
   * Запустить авто-обновление для пользователя
   * @param userId - ID пользователя
   */
  startAutoRefresh(userId: number): void {
    // Если уже запущено, останавливаем старый интервал
    this.stopAutoRefresh(userId);

    const interval = setInterval(async () => {
      await this.refreshPanel(userId);
    }, this.REFRESH_INTERVAL);

    this.refreshIntervals.set(userId, interval);
    console.log(`[AutoRefreshService] Started auto-refresh for user ${userId}`);
  }

  /**
   * Остановить авто-обновление для пользователя
   * @param userId - ID пользователя
   */
  stopAutoRefresh(userId: number): void {
    const interval = this.refreshIntervals.get(userId);
    
    if (interval) {
      clearInterval(interval);
      this.refreshIntervals.delete(userId);
      console.log(`[AutoRefreshService] Stopped auto-refresh for user ${userId}`);
    }
  }

  /**
   * Обновить панель пользователя
   * @param userId - ID пользователя
   */
  async refreshPanel(userId: number): Promise<void> {
    try {
      const state = await this.stateManager.getState(userId);
      
      if (!state || state.closed) {
        // Панель закрыта или не существует, останавливаем авто-обновление
        this.stopAutoRefresh(userId);
        
        // Удаляем состояние из базы данных ТОЛЬКО если панель закрыта пользователем
        // Не удаляем если просто не найдено сообщение (авто-обновление может временно не находить сообщение)
        if (state && state.closed) {
          await this.stateManager.deleteState(userId);
          console.log(`[AutoRefreshService] Deleted closed state for user ${userId}`);
        } else if (!state) {
          console.log(`[AutoRefreshService] State not found for user ${userId}, skipping deletion`);
        }
        return;
      }

      // Обновляем данные токена
      const updatedTokenData = await this.tokenDataFetcher.fetchTokenData(state.token_address);
      
      if (updatedTokenData) {
        await this.stateManager.updateTokenData(userId, updatedTokenData);
        state.token_data = updatedTokenData;
      }

      // Обновляем баланс пользователя
      try {
        const wallet = await this.walletManager.getWallet();
        if (wallet) {
          const solBalance = await this.solanaProvider.getBalance(wallet.publicKey.toString());
          const solBalanceSOL = solBalance / LAMPORTS_PER_SOL;
          
          const solPriceUSD = await this.tokenDataFetcher.getSOLPriceInUSD() || 150;
          const usdBalance = solBalanceSOL * solPriceUSD;
          
          await this.stateManager.updateUserData(userId, {
            sol_balance: solBalanceSOL,
            usd_balance: usdBalance,
          });
        }
      } catch (error) {
        console.error('[AutoRefreshService] Error updating balance:', error);
      }

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
          Number(userId),
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
        // Сообщение могло быть удалено или изменено пользователем
        if ((error as any).code === 400 || (error as any).description?.includes('message to edit not found')) {
          console.log(`[AutoRefreshService] Message ${updatedState.message_id} not found, stopping auto-refresh`);
          this.stopAutoRefresh(userId);
          await this.stateManager.deleteState(userId);
        } else {
          console.error(`[AutoRefreshService] Error updating message for user ${userId}:`, error);
        }
      }
    } catch (error) {
      console.error(`[AutoRefreshService] Error refreshing panel for user ${userId}:`, error);
    }
  }

  /**
   * Восстанавливает все активные панели при запуске бота
   * Перезапускает авто-обновление для всех пользователей с открытыми панелями
   */
  async restoreAllPanels(): Promise<void> {
    try {
      console.log('[AutoRefreshService] Restoring all active panels...');
      const allStates = await this.stateManager.getAllStates();
      
      let restoredCount = 0;
      let failedCount = 0;

      for (const state of allStates) {
        try {
          // Проверяем, существует ли сообщение в Telegram
          try {
            await this.bot.telegram.editMessageText(
              Number(state.user_id),
              state.message_id,
              undefined,
              this.tradingPanel.generatePanelText(state),
              {
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: this.tradingPanel.generateKeyboard(state),
                },
              }
            );
            
            // Сообщение существует, запускаем авто-обновление
            this.startAutoRefresh(state.user_id);
            restoredCount++;
            console.log(`[AutoRefreshService] Restored panel for user ${state.user_id}, token ${state.token_address}`);
          } catch (error: any) {
            // Сообщение не найдено или недоступно
            if (error.code === 400 || error.description?.includes('message to edit not found')) {
              console.log(`[AutoRefreshService] Message ${state.message_id} for user ${state.user_id} not found, deleting state`);
              await this.stateManager.deleteState(state.user_id);
              failedCount++;
            } else {
              console.error(`[AutoRefreshService] Error checking message for user ${state.user_id}:`, error);
              failedCount++;
            }
          }
        } catch (error) {
          console.error(`[AutoRefreshService] Error restoring panel for user ${state.user_id}:`, error);
          failedCount++;
        }
      }

      console.log(`[AutoRefreshService] Restore complete: ${restoredCount} panels restored, ${failedCount} panels cleaned up`);
    } catch (error) {
      console.error('[AutoRefreshService] Error in restoreAllPanels:', error);
    }
  }

  /**
   * Мониторинг здоровья Realtime соединения
   */
  private monitorRealtimeHealth(): void {
    // Очистить существующий interval если есть
    if (this.healthMonitorInterval) {
      clearInterval(this.healthMonitorInterval);
    }
    
    this.healthMonitorInterval = setInterval(() => {
      const channelsCount = realtimeService.getActiveChannelsCount();
      console.log(`[Realtime] Active channels: ${channelsCount}`);
      
      // Alert если слишком много connections
      if (channelsCount > 10) {
        console.warn('[Realtime] Too many channels! Check for leaks.');
      }
    }, 60000); // Каждую минуту
  }

  /**
   * Остановить все авто-обновления
   */
  stopAll(): void {
    // Очистка user intervals
    for (const [userId] of this.refreshIntervals.entries()) {
      this.stopAutoRefresh(userId);
    }
    
    // Очистка глобальных intervals
    if (this.fallbackInterval) {
      clearInterval(this.fallbackInterval);
      this.fallbackInterval = null;
    }
    if (this.healthMonitorInterval) {
      clearInterval(this.healthMonitorInterval);
      this.healthMonitorInterval = null;
    }
    
    console.log('[AutoRefreshService] Stopped all intervals');
  }

  /**
   * Получить количество активных авто-обновлений
   * @returns количество
   */
  getActiveCount(): number {
    return this.refreshIntervals.size;
  }
}
