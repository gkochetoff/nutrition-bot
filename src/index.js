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
