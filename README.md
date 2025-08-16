## Local run ##
```bash
ngrok http 3000
### Запуск локально

1) Создайте файл `.env` на основе `.env.example` и заполните переменные окружения:
```
Paste ngrok URL and telegram bot token here
```bash
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=YOUR_NGROK_URL"
```

2) Установите зависимости и запустите:
```
npm install
npm run dev
```

Бот использует long polling. Вебхуки не требуются. Если хотите использовать вебхуки, настройте прокси и выполните установку вебхука вручную:
```
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=YOUR_HTTPS_URL"
```

Никогда не публикуйте `BOT_TOKEN` в открытом виде.