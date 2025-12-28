# Используем официальный Node.js образ
FROM node:20-alpine

# Устанавливаем рабочую директорию
WORKDIR /app

# Копируем package files
COPY package*.json ./

# Устанавливаем зависимости
RUN npm ci --only=production

# Копируем исходный код
COPY . .

# Собираем TypeScript
RUN npm run build

# Копируем базу данных (если есть)
COPY prisma/dev.db ./prisma/dev.db 2>/dev/null || true

# Создаем директорию для данных
RUN mkdir -p /app/data

# Открываем порт (для health check, если нужно)
EXPOSE 3000

# Запускаем бота
CMD ["node", "dist/bot.js"]
