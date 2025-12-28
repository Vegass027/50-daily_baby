/**
 * Unit Tests для OrderExpirationService
 * Тестирует автоматическое истечение устаревших ордеров
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { OrderExpirationService } from '../../src/trading/managers/OrderExpirationService';
import { OrderStatus } from '../../src/trading/managers/ILimitOrderManager';

// Mock dependencies
jest.mock('../../src/database/DatabaseOrderRepository');
jest.mock('../../src/utils/Logger');

describe('OrderExpirationService', () => {
  let orderExpirationService: OrderExpirationService;
  let mockOrderRepository: any;
  let mockLogger: any;
  let onOrderExpiredCallback: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Mock order repository
    mockOrderRepository = {
      findByStatus: jest.fn(),
      updateStatus: jest.fn()
    };

    // Mock logger
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn()
    };

    jest.doMock('../../src/utils/Logger', () => ({
      getLogger: () => mockLogger
    }));

    onOrderExpiredCallback = jest.fn();

    orderExpirationService = new OrderExpirationService(
      mockOrderRepository,
      onOrderExpiredCallback
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    orderExpirationService.stop();
  });

  describe('constructor', () => {
    it('должен создать экземпляр с заданным репозиторием', () => {
      // Act & Assert
      expect(orderExpirationService).toBeInstanceOf(OrderExpirationService);
    });

    it('должен работать без callback', () => {
      // Act
      const service = new OrderExpirationService(mockOrderRepository);

      // Assert
      expect(service).toBeInstanceOf(OrderExpirationService);
    });
  });

  describe('start', () => {
    it('должен запустить интервал проверки', () => {
      // Act
      orderExpirationService.start();

      // Assert
      expect(mockLogger.info).toHaveBeenCalledWith('OrderExpirationService started');
    });

    it('должен сразу проверить ордера при старте', async () => {
      // Arrange
      mockOrderRepository.findByStatus.mockResolvedValue([]);

      // Act
      orderExpirationService.start();
      await jest.runAllTimersAsync();

      // Assert
      expect(mockOrderRepository.findByStatus).toHaveBeenCalledWith(OrderStatus.PENDING);
    });

    it('должен не запускать второй раз если уже запущен', () => {
      // Act
      orderExpirationService.start();
      orderExpirationService.start();

      // Assert
      expect(mockLogger.warn).toHaveBeenCalledWith('OrderExpirationService already started');
    });

    it('должен проверять ордера каждые 5 минут', async () => {
      // Arrange
      mockOrderRepository.findByStatus.mockResolvedValue([]);

      // Act
      orderExpirationService.start();
      await jest.runAllTimersAsync();

      // Assert - проверка при старте
      expect(mockOrderRepository.findByStatus).toHaveBeenCalledTimes(1);

      // Перематываем на 5 минут
      jest.advanceTimersByTime(5 * 60 * 1000);
      await jest.runAllTimersAsync();

      // Assert - еще одна проверка
      expect(mockOrderRepository.findByStatus).toHaveBeenCalledTimes(2);
    });
  });

  describe('stop', () => {
    it('должен остановить интервал проверки', () => {
      // Arrange
      orderExpirationService.start();

      // Act
      orderExpirationService.stop();

      // Assert
      expect(mockLogger.info).toHaveBeenCalledWith('OrderExpirationService stopped');
    });

    it('должен работать без ошибок если не запущен', () => {
      // Act & Assert - не должно выбросить ошибку
      expect(() => orderExpirationService.stop()).not.toThrow();
    });
  });

  describe('checkExpiredOrders', () => {
    it('должен истечь ордеры старше 24 часов', async () => {
      // Arrange
      const expiredOrder = {
        id: 'order1',
        status: OrderStatus.PENDING,
        createdAt: Date.now() - 25 * 60 * 60 * 1000 // 25 часов назад
      };

      mockOrderRepository.findByStatus.mockResolvedValue([expiredOrder]);
      mockOrderRepository.updateStatus.mockResolvedValue(undefined);

      orderExpirationService.start();
      await jest.runAllTimersAsync();

      // Assert
      expect(mockOrderRepository.updateStatus).toHaveBeenCalledWith(
        'order1',
        OrderStatus.EXPIRED
      );
      expect(onOrderExpiredCallback).toHaveBeenCalledWith('order1');
    });

    it('должен не истечь ордеры младше 24 часов', async () => {
      // Arrange
      const recentOrder = {
        id: 'order1',
        status: OrderStatus.PENDING,
        createdAt: Date.now() - 23 * 60 * 60 * 1000 // 23 часа назад
      };

      mockOrderRepository.findByStatus.mockResolvedValue([recentOrder]);

      orderExpirationService.start();
      await jest.runAllTimersAsync();

      // Assert
      expect(mockOrderRepository.updateStatus).not.toHaveBeenCalled();
      expect(onOrderExpiredCallback).not.toHaveBeenCalled();
    });

    it('должен обрабатывать несколько ордеров', async () => {
      // Arrange
      const expiredOrder1 = {
        id: 'order1',
        status: OrderStatus.PENDING,
        createdAt: Date.now() - 25 * 60 * 60 * 1000
      };

      const expiredOrder2 = {
        id: 'order2',
        status: OrderStatus.PENDING,
        createdAt: Date.now() - 26 * 60 * 60 * 1000
      };

      const recentOrder = {
        id: 'order3',
        status: OrderStatus.PENDING,
        createdAt: Date.now() - 1 * 60 * 60 * 1000
      };

      mockOrderRepository.findByStatus.mockResolvedValue([
        expiredOrder1,
        expiredOrder2,
        recentOrder
      ]);

      orderExpirationService.start();
      await jest.runAllTimersAsync();

      // Assert
      expect(mockOrderRepository.updateStatus).toHaveBeenCalledTimes(2);
      expect(mockOrderRepository.updateStatus).toHaveBeenCalledWith('order1', OrderStatus.EXPIRED);
      expect(mockOrderRepository.updateStatus).toHaveBeenCalledWith('order2', OrderStatus.EXPIRED);
      expect(onOrderExpiredCallback).toHaveBeenCalledTimes(2);
    });

    it('должен логировать количество истекших ордеров', async () => {
      // Arrange
      const expiredOrders = [
        {
          id: 'order1',
          status: OrderStatus.PENDING,
          createdAt: Date.now() - 25 * 60 * 60 * 1000
        },
        {
          id: 'order2',
          status: OrderStatus.PENDING,
          createdAt: Date.now() - 26 * 60 * 60 * 1000
        }
      ];

      mockOrderRepository.findByStatus.mockResolvedValue(expiredOrders);
      mockOrderRepository.updateStatus.mockResolvedValue(undefined);

      orderExpirationService.start();
      await jest.runAllTimersAsync();

      // Assert
      expect(mockLogger.info).toHaveBeenCalledWith('Expired 2 orders');
    });

    it('должен логировать возраст истекшего ордера', async () => {
      // Arrange
      const expiredOrder = {
        id: 'order1',
        status: OrderStatus.PENDING,
        createdAt: Date.now() - 25 * 60 * 60 * 1000
      };

      mockOrderRepository.findByStatus.mockResolvedValue([expiredOrder]);
      mockOrderRepository.updateStatus.mockResolvedValue(undefined);

      orderExpirationService.start();
      await jest.runAllTimersAsync();

      // Assert
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Expiring order order1')
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('age:')
      );
    });

    it('должен обрабатывать ошибки при проверке ордеров', async () => {
      // Arrange
      mockOrderRepository.findByStatus.mockRejectedValue(new Error('Database error'));

      orderExpirationService.start();
      await jest.runAllTimersAsync();

      // Assert
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error in checkExpiredOrders:',
        expect.any(Error)
      );
    });

    it('должен обрабатывать ошибки при обновлении статуса', async () => {
      // Arrange
      const expiredOrder = {
        id: 'order1',
        status: OrderStatus.PENDING,
        createdAt: Date.now() - 25 * 60 * 60 * 1000
      };

      mockOrderRepository.findByStatus.mockResolvedValue([expiredOrder]);
      mockOrderRepository.updateStatus.mockRejectedValue(new Error('Update error'));

      orderExpirationService.start();
      await jest.runAllTimersAsync();

      // Assert
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('должен работать без callback', async () => {
      // Arrange
      const expiredOrder = {
        id: 'order1',
        status: OrderStatus.PENDING,
        createdAt: Date.now() - 25 * 60 * 60 * 1000
      };

      mockOrderRepository.findByStatus.mockResolvedValue([expiredOrder]);
      mockOrderRepository.updateStatus.mockResolvedValue(undefined);

      const service = new OrderExpirationService(mockOrderRepository);
      service.start();
      await jest.runAllTimersAsync();

      // Assert
      expect(mockOrderRepository.updateStatus).toHaveBeenCalledWith('order1', OrderStatus.EXPIRED);
      service.stop();
    });

    it('должен обрабатывать пустой список ордеров', async () => {
      // Arrange
      mockOrderRepository.findByStatus.mockResolvedValue([]);

      orderExpirationService.start();
      await jest.runAllTimersAsync();

      // Assert
      expect(mockOrderRepository.updateStatus).not.toHaveBeenCalled();
      expect(onOrderExpiredCallback).not.toHaveBeenCalled();
    });
  });

  describe('getExpirationTimeMs', () => {
    it('должен возвращать время истечения в миллисекундах', () => {
      // Act
      const expirationTime = orderExpirationService.getExpirationTimeMs();

      // Assert
      expect(expirationTime).toBe(24 * 60 * 60 * 1000); // 24 часа
    });
  });

  describe('обработка ошибок при старте', () => {
    it('должен логировать ошибки при проверке ордеров на старте', async () => {
      // Arrange
      mockOrderRepository.findByStatus.mockRejectedValue(new Error('Startup error'));

      // Act
      orderExpirationService.start();
      await jest.runAllTimersAsync();

      // Assert
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error checking expired orders on start:',
        expect.any(Error)
      );
    });
  });

  describe('повторяющиеся проверки', () => {
    it('должен продолжать проверять ордера после ошибки', async () => {
      // Arrange
      const expiredOrder = {
        id: 'order1',
        status: OrderStatus.PENDING,
        createdAt: Date.now() - 25 * 60 * 60 * 1000
      };

      mockOrderRepository.findByStatus
        .mockRejectedValueOnce(new Error('First error'))
        .mockResolvedValue([expiredOrder]);

      mockOrderRepository.updateStatus.mockResolvedValue(undefined);

      orderExpirationService.start();

      // Первая проверка с ошибкой
      await jest.runAllTimersAsync();

      // Перематываем на 5 минут
      jest.advanceTimersByTime(5 * 60 * 1000);
      await jest.runAllTimersAsync();

      // Assert
      expect(mockOrderRepository.findByStatus).toHaveBeenCalledTimes(2);
      expect(mockOrderRepository.updateStatus).toHaveBeenCalledWith('order1', OrderStatus.EXPIRED);
    });
  });
});
