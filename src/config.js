let envLoaded = false;
try {
  const dotenvSafe = require('dotenv-safe');
  dotenvSafe.config({ allowEmptyValues: false });
  envLoaded = true;
} catch (e) {
  try {
    require('dotenv').config();
    envLoaded = true;
    console.warn('dotenv-safe not used (no .env.example?). Fallback to dotenv loaded.');
  } catch (e2) {
    console.warn('Failed to load environment from .env. Relying on process.env only.');
  }
}

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  DATABASE_URL: process.env.DATABASE_URL,
  GPT_MODEL: process.env.GPT_MODEL || 'gpt-4o-mini',
  WEBHOOK_URL: process.env.WEBHOOK_URL,
  WEBHOOK_PATH: process.env.WEBHOOK_PATH,
  TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
  PORT: process.env.PORT || 3000
};
