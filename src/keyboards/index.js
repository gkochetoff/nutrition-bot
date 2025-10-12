const { Markup } = require('telegraf');

function getMainMenuKeyboard() {
  return Markup.keyboard([
    [ 'Моё меню на неделю', 'Новое меню' ],
    [ 'Пересчитать калории' ]
  ]).resize().persistent();
}

module.exports = {
  getMainMenuKeyboard
};
