import { UserPanelState, TokenData, UserData, ActionData } from '../types/panel';
import { prisma } from './PrismaClient';
import { PanelMode, UserPanelState as PrismaUserPanelState } from '@prisma/client';
import { Prisma } from '@prisma/client';

/**
 * Управляет состоянием торговых панелей для каждого пользователя.
 * Хранит данные в базе данных SQLite через Prisma.
 * Обеспечивает типобезопасность и эффективные атомарные обновления.
 */
export class StateManager {
  private readonly CACHE_TTL: number = 3600000; // 1 час
  private cache = new Map<number, { state: UserPanelState; timestamp: number }>();
  private readonly CACHE_TTL_MS = 5000; // 5 секунд для in-memory кэша
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.cleanupInterval = setInterval(
      () => this.cleanupInactiveStates(),
      this.CACHE_TTL
    );
  }

  /**
   * Очистка ресурсов при завершении работы
   */
  dispose(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.cache.clear();
    console.log('[StateManager] Disposed');
  }

  private toAppState(dbState: PrismaUserPanelState): UserPanelState {
    return {
      // Note: userId converted from BigInt to number
      // Safe for Telegram user IDs (< Number.MAX_SAFE_INTEGER = 9,007,199,254,740,991)
      user_id: Number(dbState.userId), // PostgreSQL хранит как BigInt
      message_id: Number(dbState.messageId),
      token_address: dbState.tokenAddress,
      mode: dbState.mode.toLowerCase() as UserPanelState['mode'],
      token_data: JSON.parse(dbState.tokenData) as TokenData,
      user_data: JSON.parse(dbState.userData) as UserData,
      action_data: JSON.parse(dbState.actionData) as ActionData,
      activeLimitOrderId: dbState.activeLimitOrderId || undefined,
      created_at: dbState.createdAt.getTime(),
      closed: dbState.closed,
      waiting_for: dbState.waitingFor as UserPanelState['waiting_for'],
    };
  }

  private toPrismaJson(value: unknown): Prisma.JsonValue {
    if (value === null || value === undefined) {
      return null;
    }
    if (Array.isArray(value)) {
      return value.map(item => this.toPrismaJson(item));
    }
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(
        Object.entries(value).map(([key, val]) => [key, this.toPrismaJson(val)])
      );
    }
    return value as Prisma.JsonValue;
  }

  private toDbData(state: UserPanelState): Prisma.UserPanelStateCreateInput {
    return {
      userId: BigInt(state.user_id), // ИЗМЕНЕНО: конвертируем number -> BigInt
      messageId: state.message_id,
      tokenAddress: state.token_address,
      mode: state.mode.toUpperCase() as PanelMode,
      tokenData: JSON.stringify(state.token_data),
      userData: JSON.stringify(state.user_data),
      actionData: JSON.stringify(state.action_data),
      activeLimitOrderId: state.activeLimitOrderId || null,
      createdAt: new Date(state.created_at),
      closed: state.closed,
      waitingFor: state.waiting_for || null,
    };
  }

  async getState(userId: number): Promise<UserPanelState | null> {
    // Check cache first
    const cached = this.cache.get(userId);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.state;
    }
    
    // Fetch from DB
    const dbState = await prisma.userPanelState.findUnique({
      where: { userId: BigInt(userId) }, // ИЗМЕНЕНО: конвертируем в BigInt
    });

    if (dbState && !dbState.closed) {
      const state = this.toAppState(dbState);
      // Update cache
      this.cache.set(userId, { state, timestamp: Date.now() });
      return state;
    }
    return null;
  }

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
      
      // Update cache
      this.cache.set(userId, { state, timestamp: Date.now() });
    } catch (error) {
      console.error(`[StateManager] Error setting state for user ${userId}:`, error);
      throw error;
    }
  }

  async deleteState(userId: number): Promise<void> {
    try {
      await prisma.userPanelState.delete({ where: { userId: BigInt(userId) } }); // ИЗМЕНЕНО
      
      // Invalidate cache
      this.cache.delete(userId);
    } catch (error: any) {
      if (error.code !== 'P2025') { // 'P2025' is Prisma's code for "record not found"
        throw error;
      }
    }
  }

  private async updateJsonField<T>(userId: number, field: 'tokenData' | 'userData' | 'actionData', data: Partial<T>): Promise<void> {
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
      
      // Invalidate cache
      this.cache.delete(userId);
    }
  }

  async updateTokenData(userId: number, data: Partial<TokenData>): Promise<void> {
    await this.updateJsonField<TokenData>(userId, 'tokenData', data);
  }

  async updateUserData(userId: number, data: Partial<UserData>): Promise<void> {
    await this.updateJsonField<UserData>(userId, 'userData', data);
  }

  async updateActionData(userId: number, data: Partial<ActionData>): Promise<void> {
    await this.updateJsonField<ActionData>(userId, 'actionData', data);
  }

  async cleanupInactiveStates(): Promise<void> {
    try {
      const oneHourAgo = new Date(Date.now() - this.CACHE_TTL);
      
      // Удаляем все старые состояния (и closed, и открытые)
      const result = await prisma.userPanelState.deleteMany({
        where: {
          createdAt: { lt: oneHourAgo },
          // Убираем фильтр closed: true - удаляем все старые состояния
        },
      });
      
      if (result.count > 0) {
        console.log(`[StateManager] Cleaned up ${result.count} inactive states from DB.`);
      }
    } catch (error) {
      console.error(`[StateManager] Error during cleanup:`, error);
    }
  }

  async getAllStates(): Promise<UserPanelState[]> {
    const dbStates = await prisma.userPanelState.findMany({
      where: { closed: false },
    });
    return dbStates.map(this.toAppState);
  }
}
