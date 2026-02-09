const express = require('express');
const crypto = require('crypto');
const createBot = require('./bot');
const bot = createBot();
const { PORT, WEBHOOK_URL, WEBHOOK_PATH, TELEGRAM_WEBHOOK_SECRET } = require('./config');

const app = express();
let server;

// Middleware для парсинга JSON
app.use(express.json({ limit: '1mb' }));

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ status: 'Bot is running', timestamp: new Date().toISOString() });
});

function normalizeWebhookPath(path) {
  if (!path) return null;
  const trimmed = String(path).trim();
  if (!trimmed) return null;
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function joinUrl(baseUrl, path) {
  const base = String(baseUrl).replace(/\/+$/, '');
  return `${base}${path}`;
}

function defaultWebhookPath() {
  // Stable, URL-safe path component that doesn't leak the BOT_TOKEN (and avoids ":" in express routes)
  const component = crypto
    .createHash('sha256')
    .update(String(process.env.BOT_TOKEN || ''))
    .digest('hex')
    .slice(0, 32);
  return `/webhook/${component}`;
}

const webhookPath = normalizeWebhookPath(WEBHOOK_PATH) || defaultWebhookPath();

// Telegraf webhook middleware (handles path + optional secret token verification)
app.use(
  bot.webhookCallback(webhookPath, {
    secretToken: TELEGRAM_WEBHOOK_SECRET || undefined
  })
);

(async function main() {
  try {
    // Запускаем Express сервер
    server = app.listen(PORT, () => {
      console.log(`Сервер запущен на порту ${PORT}`);
      console.log('Health endpoint: GET /');
    });

    if (WEBHOOK_URL) {
      console.log('Запуск телеграм-бота в webhook режиме...');
      const webhookUrl = joinUrl(WEBHOOK_URL, webhookPath);
      console.log('Webhook path:', webhookPath);
      console.log('Устанавливаю webhook:', webhookUrl);
      await bot.telegram.setWebhook(webhookUrl, {
        secret_token: TELEGRAM_WEBHOOK_SECRET || undefined
      });
      console.log('Webhook установлен успешно');
      console.log('Бот готов к приёму webhook запросов!');
    } else {
      console.log('WEBHOOK_URL не задан — запускаю long polling режим...');
      bot
        .launch()
        .then(() => console.log('Бот запущен (long polling)'))
        .catch((e) => console.error('Ошибка при запуске long polling:', e));
    }
  } catch (err) {
    console.error('Ошибка при запуске бота:', err);
    try {
      server?.close();
    } catch {}
  }
})();

// Грейсфул-шатдаун
const shutdown = async (signal) => {
  try {
    console.log(`Получен сигнал ${signal}. Останавливаю бота...`);
    try {
      // If running in long polling mode, stop it. In webhook-only mode it may throw "Bot is not running!".
      bot.stop(signal);
    } catch {}
    if (WEBHOOK_URL) await bot.telegram.deleteWebhook();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
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
