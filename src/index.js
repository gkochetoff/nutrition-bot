const express = require('express');
const createBot = require('./bot');
const bot = createBot();
const { PORT, WEBHOOK_URL, BOT_TOKEN } = require('./config');

const app = express();

// Middleware для парсинга JSON
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'Bot is running', timestamp: new Date().toISOString() });
});

// Webhook endpoint для Telegram
app.post(`/webhook/${BOT_TOKEN}`, (req, res) => {
  bot.handleUpdate(req.body);
  res.sendStatus(200);
});

(async function main() {
  try {
    console.log('Запуск телеграм-бота в webhook режиме...');
    
    // Устанавливаем webhook, если URL задан
    if (WEBHOOK_URL) {
      const webhookUrl = `${WEBHOOK_URL}/webhook/${BOT_TOKEN}`;
      console.log('Устанавливаю webhook:', webhookUrl);
      await bot.telegram.setWebhook(webhookUrl);
      console.log('Webhook установлен успешно');
    } else {
      console.log('WEBHOOK_URL не задан, webhook не установлен');
    }
    
    // Запускаем Express сервер
    app.listen(PORT, () => {
      console.log(`Сервер запущен на порту ${PORT}`);
      console.log('Бот готов к приёму webhook запросов!');
    });
    
  } catch (err) {
    console.error('Ошибка при запуске бота:', err);
  }
})();

// Грейсфул-шатдаун
const shutdown = async (signal) => {
  try {
    console.log(`Получен сигнал ${signal}. Останавливаю бота...`);
    if (WEBHOOK_URL) {
      await bot.telegram.deleteWebhook();
      console.log('Webhook удалён');
    }
    console.log('Бот остановлен.');
    process.exit(0);
  } catch (e) {
    console.error('Ошибка при остановке бота:', e);
    process.exit(1);
  }
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
