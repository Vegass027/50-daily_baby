import { describe, it, expect, beforeEach } from '@jest/globals';
import { JitoTipCalculator } from '../../src/utils/JitoTipCalculator';

// Константы для тестов
const TEST_AMOUNTS = {
  TINY: 100,          // 0.0000001 SOL
  SMALL: 1_000_000,   // 0.001 SOL
  MEDIUM: 100_000_000, // 0.1 SOL
  LARGE: 1_000_000_000, // 1 SOL
  HUGE: 1000 * 1_000_000_000, // 1000 SOL
} as const;

const BASE_TIP = 10_000;
const DYNAMIC_TIP_RATE = 0.0005; // 0.05%

describe('JitoTipCalculator', () => {
  describe('валидация входных данных', () => {
    it('должен обрабатывать отрицательные суммы', () => {
      expect(() => JitoTipCalculator.calculateTip(-1000)).toThrow();
    });

    it('должен обрабатывать NaN', () => {
      expect(() => JitoTipCalculator.calculateTip(NaN)).toThrow();
    });

    it('должен обрабатывать Infinity', () => {
      const tip = JitoTipCalculator.calculateTip(Infinity);
      expect(tip).toBeGreaterThan(0);
    });

    it('должен обрабатывать отрицательный Infinity', () => {
      expect(() => JitoTipCalculator.calculateTip(-Infinity)).toThrow();
    });
  });

  describe('calculateTip', () => {
    it('должен рассчитывать базовый tip для малых сумм', () => {
      const tip = JitoTipCalculator.calculateTip(TEST_AMOUNTS.SMALL);
      // Базовый tip (10,000 lamports) должен использоваться
      expect(tip).toBe(BASE_TIP);
    });

    it('должен рассчитывать динамический tip для больших сумм', () => {
      const tip = JitoTipCalculator.calculateTip(TEST_AMOUNTS.MEDIUM);
      // Динамический tip: 0.05% от 100,000,000 = 50,000 lamports
      expect(tip).toBe(50_000);
    });

    it('должен применять множитель к tip', () => {
      const tip = JitoTipCalculator.calculateTip(TEST_AMOUNTS.MEDIUM, 2.0);
      // 50,000 * 2.0 = 100,000 lamports
      expect(tip).toBe(100_000);
    });

    it('должен использовать базовый tip для очень малых сумм', () => {
      const tip = JitoTipCalculator.calculateTip(TEST_AMOUNTS.TINY);
      // Динамический tip: 100 * 0.0005 = 0.05 -> floor = 0
      // Базовый tip: 10,000 lamports
      expect(tip).toBe(BASE_TIP);
    });

    it('должен рассчитывать tip для 1 SOL', () => {
      const tip = JitoTipCalculator.calculateTip(TEST_AMOUNTS.LARGE);
      // Динамический tip: 1,000,000,000 * 0.0005 = 500,000 lamports
      expect(tip).toBe(500_000);
    });
  });

  describe('calculateTipByPriority', () => {
    // Параметризованные тесты для приоритетов
    describe.each([
      ['low', 0.5, 25_000],
      ['normal', 1.0, 50_000],
      ['high', 2.0, 100_000],
      ['very_high', 5.0, 250_000],
    ])('для приоритета %s', (priority, multiplier, expectedTip) => {
      it(`должен применять множитель ${multiplier}`, () => {
        const tip = JitoTipCalculator.calculateTipByPriority(TEST_AMOUNTS.MEDIUM, priority as any);
        expect(tip).toBe(expectedTip);
      });
    });
  });

  describe('calculateOptimalTip', () => {
    it('должен рассчитывать стандартный tip', () => {
      const tip = JitoTipCalculator.calculateOptimalTip(TEST_AMOUNTS.MEDIUM);
      expect(tip).toBe(50_000);
    });

    it('должен увеличивать tip для bonding curve токенов', () => {
      const tip = JitoTipCalculator.calculateOptimalTip(TEST_AMOUNTS.MEDIUM, {
        isBondingCurve: true
      });
      // 50,000 * 1.5 = 75,000 lamports
      expect(tip).toBe(75_000);
    });

    it('должен увеличивать tip для волатильных токенов', () => {
      const tip = JitoTipCalculator.calculateOptimalTip(TEST_AMOUNTS.MEDIUM, {
        isVolatile: true
      });
      // 50,000 * 1.2 = 60,000 lamports
      expect(tip).toBe(60_000);
    });

    it('должен комбинировать bonding curve и volatile множители', () => {
      const tip = JitoTipCalculator.calculateOptimalTip(TEST_AMOUNTS.MEDIUM, {
        isBondingCurve: true,
        isVolatile: true
      });
      // 50,000 * 1.5 = 75,000, затем 75,000 * 1.2 = 90,000
      expect(tip).toBe(90_000);
    });

    it('должен использовать кастомный множитель', () => {
      const tip = JitoTipCalculator.calculateOptimalTip(TEST_AMOUNTS.MEDIUM, {
        customMultiplier: 3.0
      });
      // 50,000 * 3.0 = 150,000 lamports
      expect(tip).toBe(150_000);
    });

    it('должен приоритетно использовать кастомный множитель', () => {
      const tip = JitoTipCalculator.calculateOptimalTip(TEST_AMOUNTS.MEDIUM, {
        isBondingCurve: true,
        isVolatile: true,
        customMultiplier: 2.0
      });
      // 50,000 * 2.0 = 100,000 lamports (кастомный множитель имеет приоритет)
      expect(tip).toBe(100_000);
    });
  
    describe('edge cases и граничные значения', () => {
      it('должен обрабатывать нулевую сумму', () => {
        const tip = JitoTipCalculator.calculateTip(0);
        // Должен использовать базовый tip
        expect(tip).toBe(BASE_TIP);
      });
  
      it('должен обрабатывать очень малые суммы (< базовый tip)', () => {
        const tip = JitoTipCalculator.calculateTip(TEST_AMOUNTS.TINY);
        // Динамический tip: 100 * 0.0005 = 0.05 -> floor = 0
        // Базовый tip: 10,000 lamports
        expect(tip).toBe(BASE_TIP);
      });
  
      it('должен применять множитель к базовому tip для малых сумм', () => {
        const tip = JitoTipCalculator.calculateTip(TEST_AMOUNTS.TINY, 2.0);
        // Базовый tip (10,000) * 2.0 = 20,000
        expect(tip).toBe(20_000);
      });
  
      it('должен обрабатывать очень большие суммы', () => {
        const tip = JitoTipCalculator.calculateTip(TEST_AMOUNTS.HUGE);
        // Динамический tip: 1000 * 1,000,000,000 * 0.0005 = 500,000,000
        expect(tip).toBe(500_000_000);
      });
  
      it('должен обрабатывать нулевой множитель', () => {
        const tip = JitoTipCalculator.calculateTip(TEST_AMOUNTS.MEDIUM, 0);
        // Должен вернуть 0
        expect(tip).toBe(0);
      });
  
      it('должен обрабатывать очень большой множитель', () => {
        const tip = JitoTipCalculator.calculateTip(TEST_AMOUNTS.MEDIUM, 100);
        // 50,000 * 100 = 5,000,000
        expect(tip).toBe(5_000_000);
      });
  
      it('должен обрабатывать calculateTipFromSettings с пустыми настройками', () => {
        const tip = JitoTipCalculator.calculateTipFromSettings(TEST_AMOUNTS.MEDIUM, {});
        // Должен использовать стандартный расчет
        expect(tip).toBe(50_000);
      });
    });
  });

  describe('getRecommendedPriority', () => {
    it('должен возвращать very_high для bonding curve > 1 SOL', () => {
      const priority = JitoTipCalculator.getRecommendedPriority(
        2 * TEST_AMOUNTS.LARGE,
        'BONDING_CURVE'
      );
      expect(priority).toBe('very_high');
    });

    it('должен возвращать high для bonding curve > 0.5 SOL', () => {
      const priority = JitoTipCalculator.getRecommendedPriority(
        750_000_000,
        'BONDING_CURVE'
      );
      expect(priority).toBe('high');
    });

    it('должен возвращать normal для bonding curve <= 0.5 SOL', () => {
      const priority = JitoTipCalculator.getRecommendedPriority(
        300_000_000,
        'BONDING_CURVE'
      );
      expect(priority).toBe('normal');
    });

    it('должен возвращать very_high для DEX > 2 SOL', () => {
      const priority = JitoTipCalculator.getRecommendedPriority(
        3 * TEST_AMOUNTS.LARGE,
        'DEX_POOL'
      );
      expect(priority).toBe('very_high');
    });

    it('должен возвращать high для DEX > 1 SOL', () => {
      const priority = JitoTipCalculator.getRecommendedPriority(
        1.5 * TEST_AMOUNTS.LARGE,
        'DEX_POOL'
      );
      expect(priority).toBe('high');
    });

    it('должен возвращать normal для DEX > 0.1 SOL', () => {
      const priority = JitoTipCalculator.getRecommendedPriority(
        500_000_000,
        'DEX_POOL'
      );
      expect(priority).toBe('normal');
    });

    it('должен возвращать low для DEX <= 0.1 SOL', () => {
      const priority = JitoTipCalculator.getRecommendedPriority(
        50_000_000,
        'DEX_POOL'
      );
      expect(priority).toBe('low');
    });
  });

  describe('calculateTipFromSettings', () => {
    it('должен использовать стандартный множитель', () => {
      const tip = JitoTipCalculator.calculateTipFromSettings(TEST_AMOUNTS.MEDIUM, {});
      expect(tip).toBe(50_000);
    });

    it('должен использовать tip multiplier из настроек', () => {
      const tip = JitoTipCalculator.calculateTipFromSettings(TEST_AMOUNTS.MEDIUM, {
        tipMultiplier: 2.0
      });
      expect(tip).toBe(100_000);
    });

    it('должен применять bonding curve multiplier', () => {
      const tip = JitoTipCalculator.calculateTipFromSettings(TEST_AMOUNTS.MEDIUM, {
        bondingCurveMultiplier: 2.0,
        isBondingCurve: true
      });
      // 50,000 * 2.0 = 100,000 lamports
      expect(tip).toBe(100_000);
    });

    it('должен применять volatile multiplier', () => {
      const tip = JitoTipCalculator.calculateTipFromSettings(TEST_AMOUNTS.MEDIUM, {
        volatileMultiplier: 1.5,
        isVolatile: true
      });
      // 50,000 * 1.5 = 75,000 lamports
      expect(tip).toBe(75_000);
    });

    it('должен комбинировать все множители', () => {
      const tip = JitoTipCalculator.calculateTipFromSettings(TEST_AMOUNTS.MEDIUM, {
        tipMultiplier: 2.0,
        bondingCurveMultiplier: 1.5,
        volatileMultiplier: 1.2,
        isBondingCurve: true,
        isVolatile: true
      });
      // 50,000 * 2.0 = 100,000, затем 100,000 * 1.5 = 150,000, затем 150,000 * 1.2 = 180,000
      expect(tip).toBe(180_000);
    });
  });
});
