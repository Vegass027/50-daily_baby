/**
 * Unit Tests для PrismaClient
 * Тестирует инициализацию и работу PrismaClient
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Mock Prisma modules
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn()
}));

jest.mock('@prisma/adapter-pg', () => ({
  PrismaPg: jest.fn()
}));

describe('PrismaClient', () => {
  let mockPrismaClient: any;
  let mockPrismaPg: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    // Set environment variables before importing
    process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
    process.env.NODE_ENV = 'development';

    // Mock PrismaClient instance
    mockPrismaClient = {
      $disconnect: jest.fn().mockResolvedValue(undefined),
      userPanelState: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(),
        upsert: jest.fn()
      },
      order: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn()
      },
      position: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn()
      },
      wallet: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn()
      }
    };

    const PrismaClientMock = require('@prisma/client').PrismaClient;
    PrismaClientMock.mockImplementation(() => mockPrismaClient);

    // Mock PrismaPg adapter
    mockPrismaPg = jest.fn();
    const PrismaPgMock = require('@prisma/adapter-pg').PrismaPg;
    PrismaPgMock.mockImplementation(() => mockPrismaPg);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  describe('инициализация', () => {
    it('должен создать PrismaClient с адаптером PostgreSQL', async () => {
      // Act
      const { prisma } = await import('../../src/services/PrismaClient');

      // Assert
      expect(require('@prisma/client').PrismaClient).toHaveBeenCalledWith(
        expect.objectContaining({
          adapter: mockPrismaPg
        })
      );
      expect(require('@prisma/adapter-pg').PrismaPg).toHaveBeenCalledWith({
        connectionString: 'postgresql://test:test@localhost:5432/test'
      });
    });

    it('должен использовать DATABASE_URL из переменных окружения', async () => {
      // Arrange
      const testDbUrl = 'postgresql://custom:test@localhost:5432/custom';
      process.env.DATABASE_URL = testDbUrl;
      jest.resetModules();

      // Act
      const { prisma } = await import('../../src/services/PrismaClient');

      // Assert
      expect(require('@prisma/adapter-pg').PrismaPg).toHaveBeenCalledWith({
        connectionString: testDbUrl
      });
    });

    it('должен выбросить ошибку если DATABASE_URL не задан', async () => {
      // Arrange
      delete process.env.DATABASE_URL;
      jest.resetModules();

      // Act & Assert
      await expect(() => import('../../src/services/PrismaClient')).rejects.toThrow();
    });
  });

  describe('логирование в development режиме', () => {
    it('должен логировать query, info, warn, error в development', async () => {
      // Arrange
      process.env.NODE_ENV = 'development';
      jest.resetModules();

      // Act
      const { prisma } = await import('../../src/services/PrismaClient');

      // Assert
      expect(require('@prisma/client').PrismaClient).toHaveBeenCalledWith(
        expect.objectContaining({
          log: ['query', 'info', 'warn', 'error']
        })
      );
    });
  });

  describe('логирование в production режиме', () => {
    it('должен логировать только warn и error в production', async () => {
      // Arrange
      process.env.NODE_ENV = 'production';
      jest.resetModules();

      // Act
      const { prisma } = await import('../../src/services/PrismaClient');

      // Assert
      expect(require('@prisma/client').PrismaClient).toHaveBeenCalledWith(
        expect.objectContaining({
          log: ['warn', 'error']
        })
      );
    });
  });

  describe('graceful shutdown', () => {
    it('должен вызывать $disconnect при beforeExit', async () => {
      // Arrange
      process.env.NODE_ENV = 'development';
      jest.resetModules();

      // Act
      await import('../../src/services/PrismaClient');
      
      // Simulate beforeExit event
      process.emit('beforeExit' as any);

      // Assert
      expect(mockPrismaClient.$disconnect).toHaveBeenCalled();
    });

    it('должен обрабатывать ошибки при отключении', async () => {
      // Arrange
      process.env.NODE_ENV = 'development';
      jest.resetModules();
      mockPrismaClient.$disconnect.mockRejectedValue(new Error('Disconnect error'));

      // Act & Assert - не должно выбросить ошибку
      await import('../../src/services/PrismaClient');
      process.emit('beforeExit' as any);
      
      // Ошибка должна быть обработана без выброса
      expect(mockPrismaClient.$disconnect).toHaveBeenCalled();
    });
  });

  describe('singleton pattern', () => {
    it('должен возвращать один и тот же экземпляр', async () => {
      // Arrange
      process.env.NODE_ENV = 'development';
      jest.resetModules();

      // Act
      const { prisma: prisma1 } = await import('../../src/services/PrismaClient');
      const { prisma: prisma2 } = await import('../../src/services/PrismaClient');

      // Assert
      expect(prisma1).toBe(prisma2);
    });

    it('должен создавать только один экземпляр PrismaClient', async () => {
      // Arrange
      process.env.NODE_ENV = 'development';
      jest.resetModules();

      // Act
      await import('../../src/services/PrismaClient');

      // Assert
      expect(require('@prisma/client').PrismaClient).toHaveBeenCalledTimes(1);
    });
  });

  describe('доступ к моделям', () => {
    it('должен предоставлять доступ к userPanelState модели', async () => {
      // Arrange
      process.env.NODE_ENV = 'development';
      jest.resetModules();

      // Act
      const { prisma } = await import('../../src/services/PrismaClient');

      // Assert
      expect(prisma.userPanelState).toBeDefined();
      expect(prisma.userPanelState.findUnique).toBeDefined();
      expect(prisma.userPanelState.findMany).toBeDefined();
      expect(prisma.userPanelState.create).toBeDefined();
      expect(prisma.userPanelState.update).toBeDefined();
      expect(prisma.userPanelState.delete).toBeDefined();
    });

    it('должен предоставлять доступ к order модели', async () => {
      // Arrange
      process.env.NODE_ENV = 'development';
      jest.resetModules();

      // Act
      const { prisma } = await import('../../src/services/PrismaClient');

      // Assert
      expect(prisma.order).toBeDefined();
      expect(prisma.order.findUnique).toBeDefined();
      expect(prisma.order.findMany).toBeDefined();
      expect(prisma.order.create).toBeDefined();
      expect(prisma.order.update).toBeDefined();
      expect(prisma.order.delete).toBeDefined();
    });

    it('должен предоставлять доступ к position модели', async () => {
      // Arrange
      process.env.NODE_ENV = 'development';
      jest.resetModules();

      // Act
      const { prisma } = await import('../../src/services/PrismaClient');

      // Assert
      expect(prisma.position).toBeDefined();
      expect(prisma.position.findUnique).toBeDefined();
      expect(prisma.position.findMany).toBeDefined();
      expect(prisma.position.create).toBeDefined();
      expect(prisma.position.update).toBeDefined();
      expect(prisma.position.delete).toBeDefined();
    });

    it('должен предоставлять доступ к wallet модели', async () => {
      // Arrange
      process.env.NODE_ENV = 'development';
      jest.resetModules();

      // Act
      const { prisma } = await import('../../src/services/PrismaClient');

      // Assert
      expect(prisma.wallet).toBeDefined();
      expect(prisma.wallet.findUnique).toBeDefined();
      expect(prisma.wallet.findMany).toBeDefined();
      expect(prisma.wallet.create).toBeDefined();
      expect(prisma.wallet.update).toBeDefined();
      expect(prisma.wallet.delete).toBeDefined();
    });
  });

  describe('обработка ошибок', () => {
    it('должен корректно обрабатывать ошибки подключения', async () => {
      // Arrange
      process.env.NODE_ENV = 'development';
      jest.resetModules();
      mockPrismaClient.$connect = jest.fn().mockRejectedValue(new Error('Connection failed'));

      // Act & Assert
      const { prisma } = await import('../../src/services/PrismaClient');
      // Ошибка должна быть обработана при первой попытке подключения
      await expect(prisma.$connect?.()).rejects.toThrow('Connection failed');
    });

    it('должен корректно обрабатывать ошибки запросов', async () => {
      // Arrange
      process.env.NODE_ENV = 'development';
      jest.resetModules();
      mockPrismaClient.userPanelState.findUnique.mockRejectedValue(new Error('Query failed'));

      // Act & Assert
      const { prisma } = await import('../../src/services/PrismaClient');
      await expect(prisma.userPanelState.findUnique({ where: { userId: BigInt(123) } }))
        .rejects.toThrow('Query failed');
    });
  });

  describe('конфигурация адаптера', () => {
    it('должен использовать PrismaPg адаптер', async () => {
      // Arrange
      process.env.NODE_ENV = 'development';
      jest.resetModules();

      // Act
      await import('../../src/services/PrismaClient');

      // Assert
      expect(require('@prisma/adapter-pg').PrismaPg).toHaveBeenCalled();
    });

    it('должен передавать connection string в адаптер', async () => {
      // Arrange
      const connectionString = 'postgresql://test:test@localhost:5432/test';
      process.env.DATABASE_URL = connectionString;
      process.env.NODE_ENV = 'development';
      jest.resetModules();

      // Act
      await import('../../src/services/PrismaClient');

      // Assert
      expect(require('@prisma/adapter-pg').PrismaPg).toHaveBeenCalledWith({
        connectionString
      });
    });
  });
});
