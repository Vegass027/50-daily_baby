import { UserPanelState, TokenData, UserData, ActionData } from '../types/panel';
import { prisma } from './PrismaClient';
import { PanelMode } from '@prisma/client';

// Helper-функция для преобразования данных из БД в тип приложения
function dbStateToAppState(dbState: any): UserPanelState {
  return {
    user_id: Number(dbState.userId),
    message_id: Number(dbState.messageId),
    token_address: dbState.tokenAddress,
    mode: dbState.mode.toLowerCase() as UserPanelState['mode'],
    token_data: dbState.tokenData as unknown as TokenData,
    user_data: dbState.userData as unknown as UserData,
    action_data: dbState.actionData as unknown as ActionData,
    created_at: dbState.createdAt.getTime(),
    closed: dbState.closed,
    waiting_for: dbState.waitingFor,
  };
}

/**
 * Управляет состоянием торговых панелей для каждого пользователя.
 * Хранит данные в базе данных SQLite через Prisma.
 */
export class StateManager {
  private readonly CACHE_TTL: number = 3600000; // 1 час

  constructor() {
    setInterval(() => this.cleanupInactiveStates(), this.CACHE_TTL);
  }

  /**
   * Получить состояние панели для пользователя из БД.
   */
  async getState(userId: number): Promise<UserPanelState | null> {
    const state = await prisma.userPanelState.findUnique({
      where: { userId: BigInt(userId) },
    });

    if (state && !state.closed) {
      return dbStateToAppState(state);
    }
    return null;
  }
  
  /**
   * Установить или обновить состояние панели для пользователя в БД.
   */
  async setState(userId: number, state: UserPanelState): Promise<void> {
    const { user_id, message_id, token_data, user_data, action_data, created_at, mode, ...rest } = state;

    const dataForDb = {
      ...rest,
      userId: BigInt(user_id),
      messageId: BigInt(message_id),
      mode: mode.toUpperCase() as PanelMode,
      tokenData: token_data as any,
      userData: user_data as any,
      actionData: action_data as any,
      createdAt: new Date(created_at),
    };

    await prisma.userPanelState.upsert({
      where: { userId: BigInt(userId) },
      update: dataForDb,
      create: dataForDb,
    });
  }

  /**
   * Удалить состояние панели для пользователя из БД.
   */
  async deleteState(userId: number): Promise<void> {
    try {
      await prisma.userPanelState.delete({ where: { userId: BigInt(userId) } });
    } catch (error: any) {
      // Игнорируем ошибку, если запись не найдена (уже удалена)
      if (error.code !== 'P2025') {
        throw error;
      }
    }
  }

  /**
   * Обновить данные токена в состоянии.
   */
  async updateTokenData(userId: number, data: Partial<TokenData>): Promise<void> {
    const state = await this.getState(userId);
    if (state) {
      const updatedState = { ...state, token_data: { ...state.token_data, ...data } };
      await this.setState(userId, updatedState);
    }
  }

  /**
   * Обновить данные пользователя в состоянии.
   */
  async updateUserData(userId: number, data: Partial<UserData>): Promise<void> {
    const state = await this.getState(userId);
    if (state) {
      const updatedState = { ...state, user_data: { ...state.user_data, ...data } };
      await this.setState(userId, updatedState);
    }
  }

  /**
   * Обновить данные действия в состоянии.
   */
  async updateActionData(userId: number, data: Partial<ActionData>): Promise<void> {
    const state = await this.getState(userId);
    if (state) {
      const updatedState = { ...state, action_data: { ...state.action_data, ...data } };
      await this.setState(userId, updatedState);
    }
  }

  /**
   * Очищает неактивные (старше 1 часа) состояния панелей из БД.
   */
  async cleanupInactiveStates(): Promise<void> {
    const oneHourAgo = new Date(Date.now() - this.CACHE_TTL);
    const result = await prisma.userPanelState.deleteMany({
      where: {
        createdAt: {
          lt: oneHourAgo,
        },
      },
    });
    if (result.count > 0) {
      console.log(`[StateManager] Cleaned up ${result.count} inactive states from DB.`);
    }
  }

  /**
   * Получить все активные состояния из БД.
   */
  async getAllStates(): Promise<UserPanelState[]> {
    const dbStates = await prisma.userPanelState.findMany({
      where: { closed: false },
    });
    return dbStates.map(dbStateToAppState);
  }
}
