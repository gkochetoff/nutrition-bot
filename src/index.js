const bot = require('./bot');

(async function main() {
  try {
    console.log('Запуск телеграм-бота...');
    await bot.launch();
    console.log('Бот запущен! Нажмите Ctrl+C для остановки.');
  } catch (err) {
    console.error('Ошибка при запуске бота:', err);
  }
})();

// Грейсфул-шатдаун
const shutdown = async (signal) => {
  try {
    console.log(`Получен сигнал ${signal}. Останавливаю бота...`);
    await bot.stop(`Signal ${signal}`);
    console.log('Бот остановлен.');
    process.exit(0);
  } catch (e) {
    console.error('Ошибка при остановке бота:', e);
    process.exit(1);
  }
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
