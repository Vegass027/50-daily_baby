import { ILimitOrderManager, LimitOrderParams, OrderType } from '../trading/managers/ILimitOrderManager';
import { prisma } from './PrismaClient';
import { Position } from '@prisma/client';
import { TokenDataFetcher } from './TokenDataFetcher';

interface TPSLParams {
  tpPercent?: number;
  slPercent?: number;
  tpPrice?: number;
  slPrice?: number;
}

/**
 * Менеджер Take Profit / Stop Loss ордеров.
 * Инкапсулирует логику создания, отмены и отслеживания TP/SL ордеров.
 */
export class TPSLManager {
  private limitOrderManager: ILimitOrderManager;
  private tokenDataFetcher?: TokenDataFetcher;
  private orderLocks: Map<string, Promise<void>> = new Map();

  constructor(limitOrderManager: ILimitOrderManager, tokenDataFetcher?: TokenDataFetcher) {
    this.limitOrderManager = limitOrderManager;
    this.tokenDataFetcher = tokenDataFetcher;
    console.log('[TPSLManager] Initialized.');
  }
  
  /**
   * Создает TP/SL ордера для указанной позиции в рамках одной транзакции.
   */
  async createTPSLOrders(
    position: Position,
    params: TPSLParams
  ): Promise<{ tpOrderId?: string; slOrderId?: string }> {
    const { tpPercent, slPercent, tpPrice: fixedTpPrice, slPrice: fixedSlPrice } = params;
    const { id: positionId, tokenAddress, entryPrice, size, userId } = position;

    if (size <= 0) {
      throw new Error('Cannot create TP/SL for a closed position.');
    }

    const tpPrice = fixedTpPrice || (tpPercent && tpPercent > 0 ? entryPrice * (1 + tpPercent / 100) : undefined);
    const slPrice = fixedSlPrice || (slPercent && slPercent > 0 ? entryPrice * (1 - slPercent / 100) : undefined);

    if (!tpPrice && !slPrice) {
      return {};
    }

    // Получить decimals токена
    let decimals = 9; // По умолчанию
    if (this.tokenDataFetcher) {
      try {
        const tokenData = await this.tokenDataFetcher.fetchTokenData(tokenAddress);
        decimals = tokenData?.decimals || 9;
      } catch (error) {
        console.warn(`[TPSLManager] Could not fetch token data for ${tokenAddress}, using default decimals: ${decimals}`);
      }
    }

    return prisma.$transaction(async (tx) => {
      let tpOrderId: string | undefined;
      let slOrderId: string | undefined;

      try {
        if (tpPrice) {
          tpOrderId = await this.createSellOrder(tokenAddress, tpPrice, size, decimals, Number(userId));
        }
        if (slPrice) {
          slOrderId = await this.createSellOrder(tokenAddress, slPrice, size, decimals, Number(userId));
        }
        
        // Удаляем старую связку, если она есть, и создаем новую
        await tx.linkedOrder.deleteMany({ where: { positionId } });
        await tx.linkedOrder.create({
          data: {
            positionId,
            tpOrderId,
            slOrderId,
            orderType: this.limitOrderManager.constructor.name,
          },
        });

        console.log(`[TPSLManager] Created and linked TP/SL orders for position ${positionId}.`);
        return { tpOrderId, slOrderId };

      } catch (error) {
        // Транзакция автоматически откатит создание записей в БД.
        // Нужно вручную откатить созданные в блокчейне ордера.
        console.error(`[TPSLManager] Error in transaction for position ${positionId}. Rolling back blockchain orders...`, error);
        if (tpOrderId) await this.limitOrderManager.cancelOrder(tpOrderId).catch(e => console.error(`[TPSLManager] Rollback failed for TP order ${tpOrderId}`, e));
        if (slOrderId) await this.limitOrderManager.cancelOrder(slOrderId).catch(e => console.error(`[TPSLManager] Rollback failed for SL order ${slOrderId}`, e));
        throw new Error('Failed to create TP/SL orders.');
      }
    });
  }

  private async createSellOrder(
    tokenAddress: string,
    price: number,
    size: number,
    decimals: number,
    userId: number
  ): Promise<string> {
    // Конвертировать размер из токенов в базовые единицы
    const amountInBaseUnits = Math.floor(size * Math.pow(10, decimals));
    
    // price должна быть в SOL per token (например, 0.00001234)
    // LimitOrderManager сам конвертирует в lamports если нужно
    
    const params: LimitOrderParams = {
      userId: userId,
      tokenMint: tokenAddress,
      orderType: OrderType.SELL,
      amount: amountInBaseUnits, // В базовых единицах
      price: price,
      slippage: 1.0, // Стандартное проскальзывание для TP/SL
    };
    
    return this.limitOrderManager.createOrder(params);
  }

  /**
   * Отменяет все связанные TP/SL ордера для позиции.
   */
  async cancelRelatedOrders(positionId: string): Promise<void> {
    const linkedOrder = await prisma.linkedOrder.findUnique({
      where: { positionId },
    });

    if (!linkedOrder) return;

    const { tpOrderId, slOrderId } = linkedOrder;
    const cancelPromises: Promise<void>[] = [];

    if (tpOrderId) cancelPromises.push(this.limitOrderManager.cancelOrder(tpOrderId));
    if (slOrderId) cancelPromises.push(this.limitOrderManager.cancelOrder(slOrderId));

    await Promise.allSettled(cancelPromises);
    
    await prisma.linkedOrder.delete({ where: { positionId } });
    console.log(`[TPSLManager] Cancelled all related orders for position ${positionId}`);
  }

  /**
   * Обрабатывает исполнение одного из связанных ордеров (TP или SL).
   * Находит и отменяет противоположный ордер.
   * Защищено от race condition при одновременном исполнении TP и SL.
   */
  async onOrderFilled(filledOrderId: string): Promise<void> {
    // Проверить, не обрабатывается ли уже этот ордер
    if (this.orderLocks.has(filledOrderId)) {
      await this.orderLocks.get(filledOrderId);
      return;
    }
    
    const processingPromise = this.processOrderFilled(filledOrderId);
    this.orderLocks.set(filledOrderId, processingPromise);
    
    try {
      await processingPromise;
    } finally {
      this.orderLocks.delete(filledOrderId);
    }
  }

  private async processOrderFilled(filledOrderId: string): Promise<void> {
    const linkedOrder = await prisma.linkedOrder.findFirst({
      where: { OR: [{ tpOrderId: filledOrderId }, { slOrderId: filledOrderId }] },
    });

    if (!linkedOrder) return; // Ордер не является частью TP/SL связки

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

    await prisma.linkedOrder.delete({ where: { id: linkedOrder.id } });
  }

  /**
   * Проверяет, есть ли у позиции активные TP/SL ордера.
   */
  async hasActiveOrders(positionId: string): Promise<boolean> {
    const count = await prisma.linkedOrder.count({ where: { positionId } });
    return count > 0;
  }
}
