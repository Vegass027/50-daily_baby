import { PositionData } from '../types/panel';
import { prisma } from './PrismaClient';
import { Position, Trade } from '@prisma/client';

/**
 * Сервис для отслеживания торговых позиций пользователей.
 * Инкапсулирует всю логику работы с моделями Position и Trade в Prisma.
 */
export class PositionTracker {
  constructor() {
    console.log('[PositionTracker] Initialized with database backend.');
  }

  private toPositionData(position: Position): PositionData {
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

  /**
   * Получить позицию пользователя по токену из БД.
   * Возвращает null, если позиция не найдена или ее размер равен нулю.
   */
  async getPosition(userId: number, tokenAddress: string): Promise<PositionData | null> {
    const position = await prisma.position.findUnique({
      where: {
        userId_tokenAddress: { userId: BigInt(userId), tokenAddress }, // ИЗМЕНЕНО
        size: { gt: 0 } // Ищем только активные позиции
      },
    });

    return position ? this.toPositionData(position) : null;
  }

  /**
   * Записывает сделку и атомарно обновляет позицию в одной транзакции.
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

    const result = await prisma.$transaction(async (tx) => {
      // 1. Найти или создать позицию
      let position = await tx.position.findUnique({
        where: { userId_tokenAddress: { userId: BigInt(userId), tokenAddress } }, // ИЗМЕНЕНО
      });

      if (!position) {
        if (type === 'SELL') {
          throw new Error("Cannot sell a token you don't have a position in.");
        }
        position = await tx.position.create({
          data: {
            userId: BigInt(userId), // ИЗМЕНЕНО
            tokenAddress,
            entryPrice: 0,
            size: 0,
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

    console.log(`[PositionTracker] Recorded ${type} trade for user ${userId}, token ${tokenAddress}. Size: ${size}, Price: ${price}. New position size: ${result.size}`);
    return result;
  }

  /**
   * Рассчитать PNL для известной позиции.
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
   * Получить историю сделок по токену из БД.
   */
  async getTradeHistory(userId: number, tokenAddress: string): Promise<Trade[]> {
    const position = await prisma.position.findUnique({
      where: { userId_tokenAddress: { userId: BigInt(userId), tokenAddress } }, // ИЗМЕНЕНО
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
   * Получить все открытые позиции пользователя.
   */
  async getAllUserPositions(userId: number): Promise<PositionData[]> {
      const dbPositions = await prisma.position.findMany({
          where: {
            userId: BigInt(userId), // ИЗМЕНЕНО
            size: { gt: 0 }
          }
      });

      return dbPositions.map(this.toPositionData);
  }
}
