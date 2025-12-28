/**
 * Unit Tests для SupabaseClient
 * Тестирует инициализацию и конфигурацию Supabase SDK клиента
 */

import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';

// Mock Supabase SDK
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn()
}));

describe('SupabaseClient', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let mockSupabaseClient: any;

  beforeEach(() => {
    jest.clearAllMocks();
    originalEnv = process.env;

    // Mock Supabase client instance
    mockSupabaseClient = {
      auth: {
        setSession: jest.fn(),
        getSession: jest.fn(),
        signOut: jest.fn()
      },
      from: jest.fn(),
      realtime: {
        channel: jest.fn(),
        subscribe: jest.fn(),
        unsubscribe: jest.fn()
      }
    };

    const createClientMock = require('@supabase/supabase-js').createClient;
    createClientMock.mockReturnValue(mockSupabaseClient);
  });

  afterEach(() => {
    process.env = originalEnv;
    // Reset module cache to allow re-import
    jest.resetModules();
  });

  describe('инициализация', () => {
    it('должен создать SupabaseClient с переменными окружения', async () => {
      // Arrange
      process.env.SUPABASE_URL = 'https://test-project.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

      // Act
      const { supabase } = await import('../../src/services/SupabaseClient');

      // Assert
      expect(require('@supabase/supabase-js').createClient).toHaveBeenCalledWith(
        'https://test-project.supabase.co',
        'test-service-role-key',
        expect.any(Object)
      );
    });

    it('должен выбросить ошибку если SUPABASE_URL не задан', async () => {
      // Arrange
      delete process.env.SUPABASE_URL;
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

      // Act & Assert
      await expect(() => import('../../src/services/SupabaseClient')).rejects.toThrow(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set'
      );
    });

    it('должен выбросить ошибку если SUPABASE_SERVICE_ROLE_KEY не задан', async () => {
      // Arrange
      process.env.SUPABASE_URL = 'https://test-project.supabase.co';
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;

      // Act & Assert
      await expect(() => import('../../src/services/SupabaseClient')).rejects.toThrow(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set'
      );
    });

    it('должен выбросить ошибку если обе переменные не заданы', async () => {
      // Arrange
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_SERVICE_ROLE_KEY;

      // Act & Assert
      await expect(() => import('../../src/services/SupabaseClient')).rejects.toThrow(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set'
      );
    });
  });

  describe('конфигурация auth', () => {
    it('должен отключать persistSession для server-side', async () => {
      // Arrange
      process.env.SUPABASE_URL = 'https://test-project.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

      // Act
      await import('../../src/services/SupabaseClient');

      // Assert
      expect(require('@supabase/supabase-js').createClient).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          auth: {
            persistSession: false
          }
        })
      );
    });

    it('должен использовать service role key', async () => {
      // Arrange
      const serviceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test';
      process.env.SUPABASE_URL = 'https://test-project.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = serviceRoleKey;

      // Act
      await import('../../src/services/SupabaseClient');

      // Assert
      expect(require('@supabase/supabase-js').createClient).toHaveBeenCalledWith(
        'https://test-project.supabase.co',
        serviceRoleKey,
        expect.any(Object)
      );
    });
  });

  describe('конфигурация realtime', () => {
    it('должен настроить eventsPerSecond для free tier', async () => {
      // Arrange
      process.env.SUPABASE_URL = 'https://test-project.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

      // Act
      await import('../../src/services/SupabaseClient');

      // Assert
      expect(require('@supabase/supabase-js').createClient).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.objectContaining({
          realtime: {
            params: {
              eventsPerSecond: 10
            }
          }
        })
      );
    });

    it('должен использовать корректный URL', async () => {
      // Arrange
      const supabaseUrl = 'https://my-project.supabase.co';
      process.env.SUPABASE_URL = supabaseUrl;
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

      // Act
      await import('../../src/services/SupabaseClient');

      // Assert
      expect(require('@supabase/supabase-js').createClient).toHaveBeenCalledWith(
        supabaseUrl,
        expect.any(String),
        expect.any(Object)
      );
    });
  });

  describe('singleton pattern', () => {
    it('должен возвращать один и тот же экземпляр', async () => {
      // Arrange
      process.env.SUPABASE_URL = 'https://test-project.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

      // Act
      const { supabase: supabase1 } = await import('../../src/services/SupabaseClient');
      const { supabase: supabase2 } = await import('../../src/services/SupabaseClient');

      // Assert
      expect(supabase1).toBe(supabase2);
    });

    it('должен создавать только один экземпляр SupabaseClient', async () => {
      // Arrange
      process.env.SUPABASE_URL = 'https://test-project.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

      // Act
      await import('../../src/services/SupabaseClient');

      // Assert
      expect(require('@supabase/supabase-js').createClient).toHaveBeenCalledTimes(1);
    });
  });

  describe('доступ к методам', () => {
    it('должен предоставлять доступ к auth методам', async () => {
      // Arrange
      process.env.SUPABASE_URL = 'https://test-project.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

      // Act
      const { supabase } = await import('../../src/services/SupabaseClient');

      // Assert
      expect(supabase.auth).toBeDefined();
      expect(supabase.auth.setSession).toBeDefined();
      expect(supabase.auth.getSession).toBeDefined();
      expect(supabase.auth.signOut).toBeDefined();
    });

    it('должен предоставлять доступ к from методу', async () => {
      // Arrange
      process.env.SUPABASE_URL = 'https://test-project.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

      // Act
      const { supabase } = await import('../../src/services/SupabaseClient');

      // Assert
      expect(supabase.from).toBeDefined();
      expect(typeof supabase.from).toBe('function');
    });

    it('должен предоставлять доступ к realtime методам', async () => {
      // Arrange
      process.env.SUPABASE_URL = 'https://test-project.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

      // Act
      const { supabase } = await import('../../src/services/SupabaseClient');

      // Assert
      expect(supabase.realtime).toBeDefined();
      expect(supabase.realtime.channel).toBeDefined();
      expect(supabase.realtime.subscribe).toBeDefined();
      expect(supabase.realtime.unsubscribe).toBeDefined();
    });
  });

  describe('экспорт по умолчанию', () => {
    it('должен экспортировать supabase как default', async () => {
      // Arrange
      process.env.SUPABASE_URL = 'https://test-project.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

      // Act
      const supabaseModule = await import('../../src/services/SupabaseClient');
      const defaultExport = supabaseModule.default;

      // Assert
      expect(defaultExport).toBeDefined();
      expect(defaultExport).toBe(mockSupabaseClient);
    });

    it('должен экспортировать supabase как named export', async () => {
      // Arrange
      process.env.SUPABASE_URL = 'https://test-project.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

      // Act
      const { supabase } = await import('../../src/services/SupabaseClient');

      // Assert
      expect(supabase).toBeDefined();
      expect(supabase).toBe(mockSupabaseClient);
    });
  });

  describe('обработка ошибок', () => {
    it('должен выбросить ошибку при неверном URL', async () => {
      // Arrange
      process.env.SUPABASE_URL = 'invalid-url';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

      // Act & Assert
      await expect(() => import('../../src/services/SupabaseClient')).rejects.toThrow();
    });

    it('должен выбросить ошибку при неверном ключе', async () => {
      // Arrange
      process.env.SUPABASE_URL = 'https://test-project.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = '';

      // Act & Assert
      await expect(() => import('../../src/services/SupabaseClient')).rejects.toThrow(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set'
      );
    });
  });

  describe('конфигурация для разных окружений', () => {
    it('должен работать в development окружении', async () => {
      // Arrange
      process.env.SUPABASE_URL = 'https://dev-project.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'dev-service-role-key';
      process.env.NODE_ENV = 'development';

      // Act
      const { supabase } = await import('../../src/services/SupabaseClient');

      // Assert
      expect(supabase).toBeDefined();
      expect(require('@supabase/supabase-js').createClient).toHaveBeenCalledWith(
        'https://dev-project.supabase.co',
        'dev-service-role-key',
        expect.any(Object)
      );
    });

    it('должен работать в production окружении', async () => {
      // Arrange
      process.env.SUPABASE_URL = 'https://prod-project.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'prod-service-role-key';
      process.env.NODE_ENV = 'production';

      // Act
      const { supabase } = await import('../../src/services/SupabaseClient');

      // Assert
      expect(supabase).toBeDefined();
      expect(require('@supabase/supabase-js').createClient).toHaveBeenCalledWith(
        'https://prod-project.supabase.co',
        'prod-service-role-key',
        expect.any(Object)
      );
    });
  });

  describe('типизация', () => {
    it('должен соответствовать типу SupabaseClient', async () => {
      // Arrange
      process.env.SUPABASE_URL = 'https://test-project.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

      // Act
      const { supabase } = await import('../../src/services/SupabaseClient');

      // Assert
      expect(supabase).toHaveProperty('auth');
      expect(supabase).toHaveProperty('from');
      expect(supabase).toHaveProperty('realtime');
    });
  });
});
