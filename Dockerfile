# Используем официальный Node.js образ
FROM node:20-alpine

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем package files
COPY package*.json ./

# Устанавливаем зависимости (включая @prisma/adapter-pg для PostgreSQL)
RUN npm ci --only=production

# Копируем исходный код
COPY . .

# Собираем TypeScript
RUN npm run build

# Генерируем Prisma Client для PostgreSQL
RUN npx prisma generate

# Создаем директорию для данных
RUN mkdir -p /app/data

# Открываем порт (для health check, если нужно)
EXPOSE 3000

# Запускаем бота
CMD ["node", "dist/bot.js"]
