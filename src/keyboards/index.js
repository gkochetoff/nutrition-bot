const { Markup } = require('telegraf');

// Пример кнопок
function getMainMenuKeyboard() {
  return Markup.keyboard([
    [ 'Моё меню на неделю', 'Пересчитать калории' ]
  ]).resize().oneTime();
}

module.exports = {
  getMainMenuKeyboard
};
