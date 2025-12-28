#!/bin/bash
# Скрипт для принудительной загрузки кода в репозиторий GitHub

# Вывод сообщений
echo "--- Начинаю процесс загрузки кода ---"

# 1. Удаляем все возможные файлы блокировки Git
echo "1. Очистка старых файлов блокировки Git..."
rm -f .git/index.lock
rm -f .git/HEAD.lock
rm -f .git/refs/heads/main.lock

# 2. Добавляем все файлы в индекс
echo "2. Добавление всех файлов в Git..."
git add .
if [ $? -ne 0 ]; then
    echo "ОШИБКА: Не удалось добавить файлы. Процесс прерван."
    exit 1
fi

# 3. Делаем коммит
echo "3. Создание коммита..."
# Проверяем, есть ли уже коммиты
if git rev-parse -q --verify HEAD >/dev/null; then
    # Если коммиты есть, используем commit --amend для добавления изменений
    git commit --amend --no-edit
else
    # Если это первый коммит
    git commit -m "Initial commit of the project"
fi
if [ $? -ne 0 ]; then
    echo "ОШИБКА: Не удалось создать коммит. Процесс прерван."
    exit 1
fi

# 4. Добавляем удаленный репозиторий (если его еще нет)
echo "4. Настройка удаленного репозитория..."
if ! git remote | grep -q 'origin'; then
    git remote add origin https://github.com/Vegass027/50-daily_baby.git
fi
git remote set-url origin https://github.com/Vegass027/50-daily_baby.git

# 5. Отправляем код на GitHub (с принудительным обновлением)
echo "5. Отправка кода в репозиторий https://github.com/Vegass027/50-daily_baby ..."
git push -u -f origin main
if [ $? -ne 0 ]; then
    echo "ОШИБКА: Не удалось отправить код в репозиторий. Проверьте ваш доступ и токен."
    exit 1
fi

echo "--- УСПЕХ! Код успешно загружен в репозиторий. ---"