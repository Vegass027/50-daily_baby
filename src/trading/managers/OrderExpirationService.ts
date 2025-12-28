import { OrderStatus } from './ILimitOrderManager';
import { DatabaseOrderRepository } from '../../database/DatabaseOrderRepository';
import { getLogger } from '../../utils/Logger';

/**
 * Сервис для автоматического истечения устаревших ордеров
 * Проверяет ордера, которые находятся в статусе PENDING слишком долго
 */
export class OrderExpirationService {
  private readonly EXPIRATION_TIME_MS = 24 * 60 * 60 * 1000; // 24 часа
  private intervalId: NodeJS.Timeout | null = null;
  private logger = getLogger();
  
  constructor(
    private orderRepository: DatabaseOrderRepository,
    private onOrderExpired?: (orderId: string) => void
  ) {}
  
  /**
   * Запустить сервис проверки expired ордеров
   */
  start(): void {
    if (this.intervalId) {
      this.logger.warn('OrderExpirationService already started');
      return;
    }
    
    // Проверять каждые 5 минут
    this.intervalId = setInterval(() => {
      this.checkExpiredOrders().catch(error => {
        this.logger.error('Error checking expired orders:', error);
      });
    }, 5 * 60 * 1000);
    
    // Сразу проверить при старте
    this.checkExpiredOrders().catch(error => {
      this.logger.error('Error checking expired orders on start:', error);
    });
    
    this.logger.info('OrderExpirationService started');
  }
  
  /**
   * Остановить сервис
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.logger.info('OrderExpirationService stopped');
    }
  }
  
  /**
   * Проверить и истечь устаревшие ордера
   */
  private async checkExpiredOrders(): Promise<void> {
    try {
      const expiredTime = Date.now() - this.EXPIRATION_TIME_MS;
      
      const pendingOrders = await this.orderRepository.findByStatus(OrderStatus.PENDING);
      
      let expiredCount = 0;
      
      for (const order of pendingOrders) {
        if (order.createdAt < expiredTime) {
          const ageHours = (Date.now() - order.createdAt) / 3600000;
          this.logger.info(`Expiring order ${order.id} (age: ${ageHours.toFixed(2)} hours)`);
          
          await this.orderRepository.updateStatus(order.id, OrderStatus.EXPIRED);
          expiredCount++;
          
          if (this.onOrderExpired) {
            this.onOrderExpired(order.id);
          }
        }
      }
      
      if (expiredCount > 0) {
        this.logger.info(`Expired ${expiredCount} orders`);
      }
    } catch (error) {
      this.logger.error('Error in checkExpiredOrders:', error);
    }
  }
  
  /**
   * Получить время истечения ордера в миллисекундах
   */
  getExpirationTimeMs(): number {
    return this.EXPIRATION_TIME_MS;
  }
}
