const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

prisma.$connect()
  .then(() => {
    console.log('✅ Connected to Prisma!');
    console.log('Testing query...');
    return prisma.userPanelState.findMany();
  })
  .then((states) => {
    console.log(`✅ Found ${states.length} states in database`);
    process.exit(0);
  })
  .catch((e) => {
    console.error('❌ Error:', e.message);
    process.exit(1);
  });
