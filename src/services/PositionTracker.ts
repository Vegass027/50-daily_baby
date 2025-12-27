import { PositionData } from '../types/panel';
import { prisma } from './PrismaClient';
import { TradeType } from '@prisma/client';

/**
 * Сервис для отслеживания торговых позиций пользователей с использованием БД.
 */
export class PositionTracker {
  constructor() {
    console.log('[PositionTracker] Initialized with database backend.');
  }

  /**
   * Получить позицию пользователя по токену из БД.
   * Рассчитывает среднюю цену входа и текущий размер на лету.
   */
  async getPosition(userId: number, tokenAddress: string): Promise<PositionData | null> {
    const position = await prisma.position.findUnique({
      where: { userId_tokenAddress: { userId: BigInt(userId), tokenAddress } },
      include: { trades: true },
    });

    if (!position || position.trades.length === 0) {
      return null;
    }

    let totalCost = 0;
    let totalBoughtSize = 0;
    let totalSoldSize = 0;

    for (const trade of position.trades) {
      if (trade.type === 'BUY') {
        totalCost += trade.price * trade.size;
        totalBoughtSize += trade.size;
      } else {
        totalSoldSize += trade.size;
      }
    }

    const currentSize = totalBoughtSize - totalSoldSize;

    if (currentSize <= 0.000001) { // Используем погрешность для чисел с плавающей точкой
      // Позиция считается закрытой, можно удалить для очистки
      await prisma.position.delete({ where: { id: position.id }});
      return null;
    }

    const avgEntryPrice = totalCost / totalBoughtSize;

    return {
      entry_price: avgEntryPrice,
      size: currentSize,
      // PNL рассчитывается отдельно, так как требует текущей цены
      current_price: 0,
      pnl_usd: 0,
      pnl_percent: 0,
    };
  }

  /**
   * Записывает сделку (покупку или продажу) в БД и обновляет позицию.
   */
  async recordTrade(
    userId: number,
    tokenAddress: string,
    type: 'BUY' | 'SELL',
    price: number,
    size: number
  ): Promise<void> {
    const position = await prisma.position.upsert({
      where: { userId_tokenAddress: { userId: BigInt(userId), tokenAddress } },
      update: {}, // Просто находим или создаем позицию
      create: { userId: BigInt(userId), tokenAddress, entryPrice: 0, size: 0 },
    });

    await prisma.trade.create({
      data: {
        positionId: position.id,
        type: type,
        price: price,
        size: size,
      },
    });

    // Обновляем сводные данные в самой позиции для быстрого доступа
    const updatedPositionData = await this.calculatePositionMetrics(position.id);
    await prisma.position.update({
        where: { id: position.id },
        data: {
            entryPrice: updatedPositionData.avgEntryPrice,
            size: updatedPositionData.currentSize
        }
    });

    console.log(`[PositionTracker] Recorded ${type} trade for user ${userId}, token ${tokenAddress}. Size: ${size}, Price: ${price}`);
  }

  /**
   * Вспомогательный метод для пересчета метрик позиции.
   */
  private async calculatePositionMetrics(positionId: string) {
    const trades = await prisma.trade.findMany({ where: { positionId } });
    
    let totalCost = 0;
    let totalBoughtSize = 0;
    let totalSoldSize = 0;

    for (const trade of trades) {
        if (trade.type === 'BUY') {
            totalCost += trade.price * trade.size;
            totalBoughtSize += trade.size;
        } else {
            totalSoldSize += trade.size;
        }
    }

    const currentSize = totalBoughtSize - totalSoldSize;
    const avgEntryPrice = totalBoughtSize > 0 ? totalCost / totalBoughtSize : 0;

    return { currentSize, avgEntryPrice };
  }

  /**
   * Рассчитать PNL для текущей позиции.
   */
  async calculatePNL(
    userId: number,
    tokenAddress: string,
    currentPrice: number
  ): Promise<{ pnl_usd: number; pnl_percent: number }> {
    const position = await this.getPosition(userId, tokenAddress);

    if (!position || position.entry_price <= 0) {
      return { pnl_usd: 0, pnl_percent: 0 };
    }

    const pnl_usd = (currentPrice - position.entry_price) * position.size;
    const pnl_percent = ((currentPrice - position.entry_price) / position.entry_price) * 100;

    return { pnl_usd, pnl_percent };
  }

  /**
   * Получить историю сделок по токену из БД.
   */
  async getTradeHistory(userId: number, tokenAddress: string): Promise<any[]> {
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
   * Получить все открытые позиции пользователя.
   */
  async getAllUserPositions(userId: number): Promise<PositionData[]> {
      const dbPositions = await prisma.position.findMany({
          where: { userId: BigInt(userId), size: { gt: 0 }}
      });

      const positions: PositionData[] = [];
      for (const dbPos of dbPositions) {
          positions.push({
              tokenAddress: dbPos.tokenAddress,
              entry_price: dbPos.entryPrice,
              size: dbPos.size,
              current_price: 0, pnl_usd: 0, pnl_percent: 0, // PNL требует внешней цены
          });
      }
      return positions;
  }
}
