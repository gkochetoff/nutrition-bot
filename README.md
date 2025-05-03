## Local run ##
```bash
ngrok http 3000
```
Paste ngrok URL and telegram bot token here
```bash
curl -X POST "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=YOUR_NGROK_URL"
```

curl -X POST "https://api.telegram.org/bot7719179667:AAEuw3Fqp8Z4QJfGBmeP29m6H0kp3Ca5yLQ/setWebhook?url=https://05c8-142-93-137-35.ngrok-free.app"