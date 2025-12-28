# Используем официальный Node.js образ
FROM node:20-alpine

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем package files
COPY package*.json ./

# Копируем исходный код (включая prisma/ для схемы)
COPY . .

# Устанавливаем зависимости (включая @prisma/adapter-pg для PostgreSQL)
RUN npm ci --only=production

# Генерируем Prisma Client для PostgreSQL
RUN npx prisma generate

# Собираем TypeScript
RUN npm run build

# Создаем директорию для данных
RUN mkdir -p /app/data

# Открываем порт (для health check, если нужно)
EXPOSE 3000

# Запускаем бота
CMD ["node", "dist/bot.js"]
