import { prisma } from '../services/PrismaClient';
import realtimeService from '../services/RealtimeService';

async function testRealtime() {
  console.log('🧪 Starting Realtime test...');

  // Подписаться на ордера
  realtimeService.subscribeToOrders((payload) => {
    console.log('✅ Realtime event received:', payload);
  });

  // Подождать подключение
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Создать тестовый ордер
  const order = await prisma.order.create({
    data: {
      userId: 7295309649n,
      type: 'LIMIT',
      side: 'BUY',
      tokenMint: 'So11111111111111111111111111111111111112',
      amount: 1.0,
      price: 100.0,
      status: 'PENDING',
      params: '{}',
    },
  });

  console.log('📝 Order created:', order.id);

  // Подождать Realtime событие (должно прийти < 1 секунды)
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Обновить ордер
  await prisma.order.update({
    where: { id: order.id },
    data: { status: 'FILLED' },
  });

  console.log('✏️ Order updated');

  // Подождать Realtime событие
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Удалить ордер
  await prisma.order.delete({
    where: { id: order.id },
  });

  console.log('🗑️ Order deleted');
  console.log('✅ Test completed!');

  // Отписаться от Realtime
  await realtimeService.unsubscribeAll();
  
  process.exit(0);
}

testRealtime().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
