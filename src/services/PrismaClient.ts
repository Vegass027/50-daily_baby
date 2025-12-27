import { PrismaClient } from '@prisma/client';

// Создаем единый экземпляр PrismaClient для всего приложения с логированием
export const prisma = new PrismaClient({
  log: ['query', 'info', 'warn', 'error'],
});