## Запуск локально

### Вариант A: webhook через ngrok (рекомендуется для локальной отладки)

1) Запустите ngrok:
```bash
ngrok http 3000
```

2) Создайте файл `.env` на основе `.env.example` и заполните переменные окружения:
- `BOT_TOKEN`
- `OPENAI_API_KEY`
- `DATABASE_URL`
- `WEBHOOK_URL` = ваш HTTPS URL из ngrok (например `https://xxxx.ngrok-free.app`)
- (опционально) `TELEGRAM_WEBHOOK_SECRET` для защиты вебхука

3) Установите зависимости и запустите:
```bash
npm install
npm run dev
```

Приложение само установит webhook при старте, если задан `WEBHOOK_URL`.

### Вариант B: long polling (без webhook)

Просто не задавайте `WEBHOOK_URL` и запустите:
```bash
npm install
npm run dev
```

### Установка вебхука вручную (опционально)

Если нужно установить webhook вручную:
```bash
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=YOUR_HTTPS_URL"
```
