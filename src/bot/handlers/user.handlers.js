const userController = require('../../controllers/userController');
const { getMainMenuKeyboard } = require('../../keyboards');

function registerUserCommands(bot) {
  // Recalculate entry
  bot.hears('Пересчитать калории', async (ctx) => {
    const telegramId = ctx.from.id;
    const user = await userController.getUserByTelegramId(telegramId);
    if (!user) {
      return ctx.reply('⚠️ Сначала выполните команду <code>/start</code> для ввода данных.', { parse_mode: 'HTML' });
    }

    const genderText = user?.gender ? (user.gender === 'M' ? 'Мужской' : 'Женский') : '—';
    const activityText = { 'низкий': 'Низкий', 'средний': 'Средний', 'высокий': 'Высокий' }[user?.activity_level] || user?.activity_level || '—';
    const goalText = { 'lose': 'Сброс веса', 'maintain': 'Поддержание', 'gain': 'Набор веса' }[user?.goal] || user?.goal || '—';

    await ctx.reply(
      `📋 Ваши текущие данные:\n\n` +
      `👤 Возраст: ${user?.age ?? '—'} лет\n` +
      `👥 Пол: ${genderText}\n` +
      `⚖️ Вес: ${user?.weight ?? '—'} кг\n` +
      `📏 Рост: ${user?.height ?? '—'} см\n` +
      `🤸 Активность: ${activityText}\n` +
      `🥅 Цель: ${goalText}\n\n` +
      `📊 Текущая норма калорий: ${user?.daily_calories ?? '—'} ккал\n` +
      `🥩 Белки: ${user?.protein ?? '—'} г | 🥑 Жиры: ${user?.fat ?? '—'} г | 🍞 Углеводы: ${user?.carbs ?? '—'} г\n\n` +
      `Что хотите изменить?`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [ { text: '👤 Возраст', callback_data: 'update_age' }, { text: '👥 Пол', callback_data: 'update_gender' } ],
            [ { text: '⚖️ Вес', callback_data: 'update_weight' }, { text: '📏 Рост', callback_data: 'update_height' } ],
            [ { text: '🤸 Активность', callback_data: 'update_activity' }, { text: '🥅 Цель', callback_data: 'update_goal' } ],
            [ { text: '🔄 Обновить все данные', callback_data: 'update_all' } ],
            [ { text: '❌ Отмена', callback_data: 'cancel_update' } ]
          ]
        }
      }
    );
  });
}

module.exports = { registerUserCommands };


