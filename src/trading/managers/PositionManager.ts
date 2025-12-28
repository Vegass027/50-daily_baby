import { prisma } from '../../services/PrismaClient';
import { Position as PrismaPosition, Order, Trade } from '@prisma/client';
import { TokenType } from '../../services/UnifiedPriceService';
import { PositionData } from '../../types/panel';
import { getConcurrencyManager } from '../../utils/ConcurrencyManager';

/**
 * Интерфейс позиции
 */
export interface Position {
  id: string;
  userId: bigint;
  tokenAddress: string;
  tokenType: TokenType;
  entryPrice: number;
  size: number;
  status: 'OPEN' | 'CLOSED';
  orderType: 'MARKET_BUY' | 'LIMIT_BUY';
  openTxSignature: string | null;
  exitPrice: number | null;
  closedAt: Date | null;
  exitTxSignature: string | null;
  realizedPnL: number | null;
  realizedPnLPercent: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Параметры для создания позиции
 */
export interface CreatePositionParams {
  tokenAddress: string;
  tokenType: TokenType;
  entryPrice: number;
  size: number;
  openTxSignature: string;
  orderType: 'MARKET_BUY' | 'LIMIT_BUY';
}

/**
 * Параметры для закрытия позиции
 */
export interface ClosePositionParams {
  exitPrice: number;
  exitTxSignature: string;
  realizedPnL: number;
  realizedPnLPercent: number;
}

/**
 * Единый менеджер позиций
 * Объединяет функционал PositionManager и PositionTracker
 * Управляет созданием, обновлением, закрытием и отслеживанием торговых позиций
 */
export class PositionManager {
  constructor() {
    console.log('[PositionManager] Initialized with database backend.');
  }

  /**
   * Создать позицию из market buy или limit buy
   * @param userId ID пользователя (Telegram ID)
   * @param params Параметры создания позиции
   * @returns Созданная позиция
   */
  async createPosition(
    userId: number,
    params: CreatePositionParams
  ): Promise<Position> {
    console.log(`   📊 Creating position for user ${userId}...`);
    console.log(`      Token: ${params.tokenAddress.slice(0, 8)}...`);
    console.log(`      Type: ${params.tokenType}`);
    console.log(`      Entry Price: ${params.entryPrice.toFixed(8)} SOL`);
    console.log(`      Size: ${params.size} tokens`);
    console.log(`      Order Type: ${params.orderType}`);

    try {
      // Проверяем, существует ли уже позиция для этого токена
      const existingPosition = await prisma.position.findUnique({
        where: {
          userId_tokenAddress: {
            userId: BigInt(userId),
            tokenAddress: params.tokenAddress
          }
        }
      });

      let position: Position;

      if (existingPosition) {
        // Если позиция существует, обновляем её (добавляем к существующей)
        const newSize = existingPosition.size + params.size;
        const newEntryPrice =
          (existingPosition.entryPrice * existingPosition.size +
           params.entryPrice * params.size) / newSize;

        const updatedPosition = await prisma.position.update({
          where: { id: existingPosition.id },
          data: {
            size: newSize,
            entryPrice: newEntryPrice,
            tokenType: params.tokenType,
            status: 'OPEN',
            updatedAt: new Date()
          }
        });

        position = this.mapDbPositionToPosition(updatedPosition);
        console.log(`   ✅ Position updated (added to existing): ${position.id}`);
      } else {
        // Создаем новую позицию
        const dbPosition = await prisma.position.create({
          data: {
            userId: BigInt(userId),
            tokenAddress: params.tokenAddress,
            tokenType: params.tokenType,
            entryPrice: params.entryPrice,
            size: params.size,
            status: 'OPEN',
            orderType: params.orderType,
            openTxSignature: params.openTxSignature
          }
        });

        position = this.mapDbPositionToPosition(dbPosition);
        console.log(`   ✅ Position created: ${position.id}`);
      }

      return position;
    } catch (error) {
      console.error(`   ❌ Failed to create position:`, error);
      throw error;
    }
  }

  /**
   * Закрыть позицию из market sell
   * @param positionId ID позиции
   * @param params Параметры закрытия позиции
   */
  async closePosition(
    positionId: string,
    params: ClosePositionParams
  ): Promise<void> {
    console.log(`   📊 Closing position ${positionId}...`);
    console.log(`      Exit Price: ${params.exitPrice.toFixed(8)} SOL`);
    console.log(`      P&L: ${params.realizedPnLPercent.toFixed(2)}%`);

    try {
      // Получаем позицию перед закрытием
      const position = await prisma.position.findUnique({
        where: { id: positionId }
      });

      if (!position) {
        throw new Error(`Position ${positionId} not found`);
      }

      // Обновляем позицию
      await prisma.position.update({
        where: { id: positionId },
        data: {
          status: 'CLOSED',
          exitPrice: params.exitPrice,
          closedAt: new Date(),
          exitTxSignature: params.exitTxSignature,
          realizedPnL: params.realizedPnL,
          realizedPnLPercent: params.realizedPnLPercent,
          updatedAt: new Date()
        }
      });

      // Создаем запись в Trade history
      await prisma.trade.create({
        data: {
          positionId: positionId,
          type: 'SELL',
          price: params.exitPrice,
          size: position.size,
          timestamp: new Date()
        }
      });

      console.log(`   ✅ Position closed: ${positionId}`);
      console.log(`      P&L: ${params.realizedPnLPercent.toFixed(2)}%`);
    } catch (error) {
      console.error(`   ❌ Failed to close position:`, error);
      throw error;
    }
  }

  /**
   * Получить позицию по ID
   * @param positionId ID позиции
   * @returns Позиция или null если не найдена
   */
  async getPosition(positionId: string): Promise<Position | null> {
    try {
      const dbPosition = await prisma.position.findUnique({
        where: { id: positionId }
      });

      if (!dbPosition) {
        return null;
      }

      return this.mapDbPositionToPosition(dbPosition);
    } catch (error) {
      console.error(`   ❌ Failed to get position ${positionId}:`, error);
      throw error;
    }
  }

  /**
   * Получить позицию пользователя по токену (формат Position)
   * @param userId ID пользователя
   * @param tokenMint Адрес токена
   * @returns Позиция или null если не найдена
   */
  async getPositionByToken(
    userId: number,
    tokenMint: string
  ): Promise<Position | null> {
    try {
      const dbPosition = await prisma.position.findUnique({
        where: {
          userId_tokenAddress: {
            userId: BigInt(userId),
            tokenAddress: tokenMint
          }
        }
      });

      if (!dbPosition) {
        return null;
      }

      return this.mapDbPositionToPosition(dbPosition);
    } catch (error) {
      console.error(`   ❌ Failed to get position for token ${tokenMint}:`, error);
      throw error;
    }
  }

  /**
   * Получить позицию пользователя по токену (формат PositionData)
   * Возвращает null, если позиция не найдена или ее размер равен нулю.
   * @param userId ID пользователя
   * @param tokenAddress Адрес токена
   * @returns Позиция или null если не найдена
   */
  async getPositionData(userId: number, tokenAddress: string): Promise<PositionData | null> {
    const position = await prisma.position.findUnique({
      where: {
        userId_tokenAddress: { userId: BigInt(userId), tokenAddress },
        size: { gt: 0 } // Ищем только активные позиции
      },
    });

    return position ? this.toPositionData(position) : null;
  }

  /**
   * Получить все открытые позиции пользователя
   * @param userId ID пользователя
   * @returns Массив открытых позиций
   */
  async getOpenPositions(userId: number): Promise<Position[]> {
    try {
      const dbPositions = await prisma.position.findMany({
        where: {
          userId: BigInt(userId),
          status: 'OPEN'
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      return dbPositions.map(this.mapDbPositionToPosition);
    } catch (error) {
      console.error(`   ❌ Failed to get open positions:`, error);
      throw error;
    }
  }

  /**
   * Получить все позиции пользователя
   * @param userId ID пользователя
   * @returns Массив всех позиций
   */
  async getAllPositions(userId: number): Promise<Position[]> {
    try {
      const dbPositions = await prisma.position.findMany({
        where: {
          userId: BigInt(userId)
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      return dbPositions.map(this.mapDbPositionToPosition);
    } catch (error) {
      console.error(`   ❌ Failed to get all positions:`, error);
      throw error;
    }
  }

  /**
   * Получить все открытые позиции (для всех пользователей)
   * @returns Массив открытых позиций
   */
  async getAllOpenPositions(): Promise<Position[]> {
    try {
      const dbPositions = await prisma.position.findMany({
        where: {
          status: 'OPEN'
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      return dbPositions.map(this.mapDbPositionToPosition);
    } catch (error) {
      console.error(`   ❌ Failed to get all open positions:`, error);
      throw error;
    }
  }

  /**
   * Получить все открытые позиции пользователя (формат PositionData)
   * @param userId ID пользователя
   * @returns Массив позиций в формате PositionData
   */
  async getAllUserPositions(userId: number): Promise<PositionData[]> {
    const dbPositions = await prisma.position.findMany({
      where: {
        userId: BigInt(userId),
        size: { gt: 0 }
      }
    });

    return dbPositions.map(this.toPositionData);
  }

  /**
   * Записывает сделку и атомарно обновляет позицию в одной транзакции.
   * Использует ConcurrencyManager для защиты от race conditions.
   * @param userId ID пользователя
   * @param tokenAddress Адрес токена
   * @param type Тип сделки (BUY или SELL)
   * @param price Цена сделки
   * @param size Количество токенов
   * @returns Обновленная позиция
   */
  async recordTrade(
    userId: number,
    tokenAddress: string,
    type: 'BUY' | 'SELL',
    price: number,
    size: number
  ): Promise<Position> {
    if (size <= 0) {
      throw new Error('Trade size must be positive.');
    }

    // Используем ConcurrencyManager для блокировки
    const lockKey = `position_${userId}_${tokenAddress}`;
    
    return await getConcurrencyManager().withLock(lockKey, async () => {
      const result = await prisma.$transaction(async (tx) => {
        // 1. Найти или создать позицию
        let position = await tx.position.findUnique({
          where: { userId_tokenAddress: { userId: BigInt(userId), tokenAddress } },
        });

        if (!position) {
          if (type === 'SELL') {
            throw new Error("Cannot sell a token you don't have a position in.");
          }
          position = await tx.position.create({
            data: {
              userId: BigInt(userId),
              tokenAddress,
              tokenType: 'DEX_POOL', // По умолчанию
              entryPrice: 0,
              size: 0,
              status: 'OPEN',
              orderType: 'MARKET_BUY', // По умолчанию
            },
          });
        }
        
        // 2. Рассчитать новые метрики позиции
        let newSize: number;
        let newEntryPrice: number;

        if (type === 'BUY') {
          const currentTotalValue = position.entryPrice * position.size;
          const tradeValue = price * size;
          newSize = position.size + size;
          newEntryPrice = (currentTotalValue + tradeValue) / newSize;
        } else { // SELL
          newSize = position.size - size;
          
          // Проверка с учетом погрешности
          if (newSize < -1e-9) {
            throw new Error(`Cannot sell ${size} tokens. You only have ${position.size}.`);
          }
          
          // Округляем малые значения до 0
          if (Math.abs(newSize) < 1e-9) {
            newSize = 0;
          }
          
          // Цена входа сохраняется только если позиция не закрыта
          newEntryPrice = newSize > 0 ? position.entryPrice : 0;
        }

        // 3. Обновить позицию
        const updatedPosition = await tx.position.update({
          where: { id: position.id },
          data: {
            size: newSize,
            entryPrice: newEntryPrice,
            status: newSize > 0 ? 'OPEN' : 'CLOSED',
          },
        });

        // 4. Создать запись о сделке
        await tx.trade.create({
          data: {
            positionId: position.id,
            type: type,
            price,
            size,
          },
        });
        
        return updatedPosition;
      });

      console.log(`[PositionManager] Recorded ${type} trade for user ${userId}, token ${tokenAddress}. Size: ${size}, Price: ${price}. New position size: ${result.size}`);
      return this.mapDbPositionToPosition(result);
    });
  }

  /**
   * Рассчитать PNL для известной позиции
   * @param position Позиция
   * @param currentPrice Текущая цена
   * @returns PNL в USD и процентах
   */
  calculatePNL(
    position: PositionData,
    currentPrice: number
  ): { pnl_usd: number; pnl_percent: number } {
    if (!position || position.entry_price <= 0 || position.size <= 0) {
      return { pnl_usd: 0, pnl_percent: 0 };
    }

    const pnl_usd = (currentPrice - position.entry_price) * position.size;
    const pnl_percent = (pnl_usd / (position.entry_price * position.size)) * 100;

    return { pnl_usd, pnl_percent };
  }

  /**
   * Получить историю сделок по токену из БД
   * @param userId ID пользователя
   * @param tokenAddress Адрес токена
   * @returns Массив сделок
   */
  async getTradeHistory(userId: number, tokenAddress: string): Promise<Trade[]> {
    const position = await prisma.position.findUnique({
      where: { userId_tokenAddress: { userId: BigInt(userId), tokenAddress } },
      include: {
        trades: {
          orderBy: {
            timestamp: 'desc',
          },
        },
      },
    });

    return position ? position.trades : [];
  }

  /**
   * Связать ордер с позицией (для TP/SL)
   * @param positionId ID позиции
   * @param orderId ID ордера
   * @param orderType Тип ордера (TAKE_PROFIT или STOP_LOSS)
   */
  async linkOrderToPosition(
    positionId: string,
    orderId: string,
    orderType: 'TAKE_PROFIT' | 'STOP_LOSS'
  ): Promise<void> {
    try {
      console.log(`   🔗 Linking ${orderType} order ${orderId} to position ${positionId}`);

      // Проверяем, существует ли уже запись в LinkedOrder
      const existingLinkedOrder = await prisma.linkedOrder.findUnique({
        where: { positionId }
      });

      if (existingLinkedOrder) {
        // Обновляем существующую запись
        if (orderType === 'TAKE_PROFIT') {
          await prisma.linkedOrder.update({
            where: { positionId },
            data: { tpOrderId: orderId }
          });
        } else {
          await prisma.linkedOrder.update({
            where: { positionId },
            data: { slOrderId: orderId }
          });
        }
      } else {
        // Создаем новую запись
        await prisma.linkedOrder.create({
          data: {
            positionId,
            [orderType === 'TAKE_PROFIT' ? 'tpOrderId' : 'slOrderId']: orderId,
            orderType: 'jupiter' // Значение по умолчанию
          }
        });
      }

      console.log(`   ✅ Order linked successfully`);
    } catch (error) {
      console.error(`   ❌ Failed to link order to position:`, error);
      throw error;
    }
  }

  /**
   * Получить связанные ордера для позиции
   * @param positionId ID позиции
   * @returns Связанные ордера (TP/SL)
   */
  async getLinkedOrders(positionId: string): Promise<{
    tpOrderId?: string;
    slOrderId?: string;
  }> {
    try {
      const linkedOrder = await prisma.linkedOrder.findUnique({
        where: { positionId }
      });

      return {
        tpOrderId: linkedOrder?.tpOrderId || undefined,
        slOrderId: linkedOrder?.slOrderId || undefined
      };
    } catch (error) {
      console.error(`   ❌ Failed to get linked orders:`, error);
      throw error;
    }
  }

  /**
   * Удалить связь ордера с позицией
   * @param positionId ID позиции
   * @param orderType Тип ордера (TAKE_PROFIT или STOP_LOSS)
   */
  async unlinkOrderFromPosition(
    positionId: string,
    orderType: 'TAKE_PROFIT' | 'STOP_LOSS'
  ): Promise<void> {
    try {
      console.log(`   🔗 Unlinking ${orderType} order from position ${positionId}`);

      if (orderType === 'TAKE_PROFIT') {
        await prisma.linkedOrder.update({
          where: { positionId },
          data: { tpOrderId: null }
        });
      } else {
        await prisma.linkedOrder.update({
          where: { positionId },
          data: { slOrderId: null }
        });
      }

      console.log(`   ✅ Order unlinked successfully`);
    } catch (error) {
      console.error(`   ❌ Failed to unlink order from position:`, error);
      throw error;
    }
  }

  /**
   * Преобразовать DB позицию в интерфейс Position
   * @param dbPosition Позиция из БД
   * @returns Интерфейс Position
   */
  private mapDbPositionToPosition(dbPosition: PrismaPosition): Position {
    return {
      id: dbPosition.id,
      userId: dbPosition.userId,
      tokenAddress: dbPosition.tokenAddress,
      tokenType: dbPosition.tokenType as TokenType,
      entryPrice: dbPosition.entryPrice,
      size: dbPosition.size,
      status: dbPosition.status as 'OPEN' | 'CLOSED',
      orderType: dbPosition.orderType as 'MARKET_BUY' | 'LIMIT_BUY',
      openTxSignature: dbPosition.openTxSignature,
      exitPrice: dbPosition.exitPrice,
      closedAt: dbPosition.closedAt,
      exitTxSignature: dbPosition.exitTxSignature,
      realizedPnL: dbPosition.realizedPnL,
      realizedPnLPercent: dbPosition.realizedPnLPercent,
      createdAt: dbPosition.createdAt,
      updatedAt: dbPosition.updatedAt
    };
  }

  /**
   * Преобразовать DB позицию в интерфейс PositionData
   * @param position Позиция из БД
   * @returns Интерфейс PositionData
   */
  private toPositionData(position: PrismaPosition): PositionData {
    return {
      tokenAddress: position.tokenAddress,
      entry_price: position.entryPrice,
      size: position.size,
      // PNL рассчитывается отдельно, так как требует текущей цены
      current_price: 0,
      pnl_usd: 0,
      pnl_percent: 0,
    };
  }
}
