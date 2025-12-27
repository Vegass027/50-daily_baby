import { Telegraf, Context } from 'telegraf';
import { StateManager } from './StateManager';
import { TokenDataFetcher } from './TokenDataFetcher';
import { UserPanelState } from '../types/panel';
import { TradingPanel } from '../panels/TradingPanel';

/**
 * Сервис авто-обновления торговых панелей
 */
export class AutoRefreshService {
  private refreshIntervals: Map<number, NodeJS.Timeout> = new Map();
  private stateManager: StateManager;
  private tokenDataFetcher: TokenDataFetcher;
  private bot: Telegraf;
  private tradingPanel: TradingPanel;
  private readonly REFRESH_INTERVAL: number = 5000; // 5 секунд

  constructor(
    bot: Telegraf,
    stateManager: StateManager,
    tokenDataFetcher: TokenDataFetcher,
    tradingPanel: TradingPanel
  ) {
    this.bot = bot;
    this.stateManager = stateManager;
    this.tokenDataFetcher = tokenDataFetcher;
    this.tradingPanel = tradingPanel;
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
        return;
      }

      // Обновляем данные токена
      const updatedTokenData = await this.tokenDataFetcher.fetchTokenData(state.token_address);
      
      if (updatedTokenData) {
        await this.stateManager.updateTokenData(userId, updatedTokenData);
        state.token_data = updatedTokenData;
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
              state.user_id,
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
   * Остановить все авто-обновления
   */
  stopAll(): void {
    for (const [userId] of this.refreshIntervals.entries()) {
      this.stopAutoRefresh(userId);
    }
    console.log('[AutoRefreshService] Stopped all auto-refresh intervals');
  }

  /**
   * Получить количество активных авто-обновлений
   * @returns количество
   */
  getActiveCount(): number {
    return this.refreshIntervals.size;
  }
}
