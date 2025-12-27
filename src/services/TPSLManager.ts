import { ILimitOrderManager, LimitOrderParams, OrderType } from '../trading/managers/ILimitOrderManager';
import { prisma } from './PrismaClient';

/**
 * Менеджер Take Profit / Stop Loss ордеров с хранением в БД.
 */
export class TPSLManager {
  private limitOrderManager: ILimitOrderManager;

  constructor(limitOrderManager: ILimitOrderManager) {
    this.limitOrderManager = limitOrderManager;
    console.log('[TPSLManager] Initialized with database backend.');
  }

  /**
   * Создает TP/SL ордера и сохраняет связь с позицией в БД.
   */
  async createTPSLOrders(
    positionId: string,
    tokenAddress: string,
    entryPrice: number,
    size: number,
    tpPercent?: number,
    slPercent?: number
  ): Promise<{ tpOrderId?: string; slOrderId?: string }> {
    let tpOrderId: string | undefined;
    let slOrderId: string | undefined;

    try {
      if (tpPercent && tpPercent > 0) {
        const tpPrice = entryPrice * (1 + tpPercent / 100);
        tpOrderId = await this.createSellOrder(tokenAddress, tpPrice, size, 1.0);
      }

      if (slPercent && slPercent > 0) {
        const slPrice = entryPrice * (1 - slPercent / 100);
        slOrderId = await this.createSellOrder(tokenAddress, slPrice, size, 2.0);
      }

      if (tpOrderId || slOrderId) {
        await prisma.linkedOrder.create({
          data: {
            positionId: positionId,
            tpOrderId: tpOrderId,
            slOrderId: slOrderId,
            orderType: this.limitOrderManager.constructor.name, // 'PumpFunLimitOrderManager' или 'JupiterLimitOrderManager'
          },
        });
        console.log(`[TPSLManager] Created and linked TP/SL orders for position ${positionId}.`);
      }

      return { tpOrderId, slOrderId };
    } catch (error) {
      console.error(`[TPSLManager] Error creating TP/SL orders for position ${positionId}:`, error);
      // Откатываем созданные ордера в случае ошибки
      if (tpOrderId) await this.limitOrderManager.cancelOrder(tpOrderId).catch(e => console.error(`[TPSLManager] Rollback failed for TP order ${tpOrderId}`, e));
      if (slOrderId) await this.limitOrderManager.cancelOrder(slOrderId).catch(e => console.error(`[TPSLManager] Rollback failed for SL order ${slOrderId}`, e));
      throw error;
    }
  }

  private async createSellOrder(tokenAddress: string, price: number, size: number, slippage: number): Promise<string> {
    const params: LimitOrderParams = {
      tokenMint: tokenAddress,
      orderType: OrderType.SELL,
      amount: size,
      price: price,
      slippage: slippage,
    };
    return await this.limitOrderManager.createOrder(params);
  }

  /**
   * Отменяет все связанные TP/SL ордера для позиции.
   */
  async cancelRelatedOrders(positionId: string): Promise<void> {
    const linkedOrder = await prisma.linkedOrder.findUnique({
      where: { positionId },
    });

    if (!linkedOrder) {
      return;
    }

    const cancelPromises: Promise<void>[] = [];
    if (linkedOrder.tpOrderId) {
      cancelPromises.push(this.limitOrderManager.cancelOrder(linkedOrder.tpOrderId));
    }
    if (linkedOrder.slOrderId) {
      cancelPromises.push(this.limitOrderManager.cancelOrder(linkedOrder.slOrderId));
    }

    await Promise.all(cancelPromises.map(p => p.catch(e => console.error('[TPSLManager] Error during bulk cancel:', e))));

    await prisma.linkedOrder.delete({ where: { positionId } });
    console.log(`[TPSLManager] Cancelled all related orders for position ${positionId}`);
  }

  /**
   * Обрабатывает исполнение одного из связанных ордеров (TP или SL).
   * Находит и отменяет противоположный ордер.
   */
  async onOrderFilled(filledOrderId: string): Promise<void> {
    const linkedOrder = await prisma.linkedOrder.findFirst({
      where: {
        OR: [
          { tpOrderId: filledOrderId },
          { slOrderId: filledOrderId },
        ],
      },
    });

    if (!linkedOrder) {
      // Ордер не является частью TP/SL связки
      return;
    }

    const isTP = linkedOrder.tpOrderId === filledOrderId;
    const oppositeOrderId = isTP ? linkedOrder.slOrderId : linkedOrder.tpOrderId;

    if (oppositeOrderId) {
      try {
        await this.limitOrderManager.cancelOrder(oppositeOrderId);
        console.log(`[TPSLManager] ${isTP ? 'TP' : 'SL'} filled. Canceled opposite order ${oppositeOrderId}.`);
      } catch (error) {
        console.error(`[TPSLManager] Failed to cancel opposite order ${oppositeOrderId}:`, error);
      }
    }

    // Удаляем связку из БД, так как позиция закрыта
    await prisma.linkedOrder.delete({ where: { id: linkedOrder.id } });
  }

  /**
   * Проверяет, есть ли у позиции активные TP/SL ордера.
   */
  async hasActiveOrders(positionId: string): Promise<boolean> {
    const count = await prisma.linkedOrder.count({
        where: { positionId }
    });
    return count > 0;
  }
}
