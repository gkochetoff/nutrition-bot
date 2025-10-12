const { createWeeklyMenu } = require('../../controllers/menuController');
const { getMainMenuKeyboard } = require('../../keyboards');
const db = require('../../services/db');

async function canGenerateMenu(userId) {
  const result = await db.query(
    'SELECT created_at FROM menus WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
    [userId]
  );
  
  if (result.rows.length === 0) return { allowed: true };
  
  const lastMenuDate = new Date(result.rows[0].created_at);
  const now = new Date();
  const daysSinceLastMenu = Math.floor((now - lastMenuDate) / (1000 * 60 * 60 * 24));
  
  if (daysSinceLastMenu < 7) {
    const daysLeft = 7 - daysSinceLastMenu;
    return { 
      allowed: false, 
      daysLeft,
      nextDate: new Date(lastMenuDate.getTime() + 7 * 24 * 60 * 60 * 1000)
    };
  }
  
  return { allowed: true };
}

async function sendWeeklyMenu(ctx, user) {
  const check = await canGenerateMenu(user.id);
  
  if (!check.allowed) {
    const nextDateStr = check.nextDate.toLocaleDateString('ru-RU', { 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric' 
    });
    return ctx.reply(
      `⏳ Новое меню можно сгенерировать через ${check.daysLeft} ${check.daysLeft === 1 ? 'день' : check.daysLeft < 5 ? 'дня' : 'дней'}.\n\n` +
      `📅 Следующая генерация доступна: ${nextDateStr}\n\n` +
      `💡 Вы можете использовать текущее меню или изменить свои данные.`,
      getMainMenuKeyboard()
    );
  }

  const { menuId } = await createWeeklyMenu(
    user.id,
    user.daily_calories,
    user.protein,
    user.fat,
    user.carbs,
    user.goal
  );

  if (!ctx.session) ctx.session = {};
  ctx.session.currentMenuId = menuId;

  const dayButtons = [
    [ { text: 'День 1', callback_data: 'day_1' }, { text: 'День 2', callback_data: 'day_2' } ],
    [ { text: 'День 3', callback_data: 'day_3' }, { text: 'День 4', callback_data: 'day_4' } ],
    [ { text: 'День 5', callback_data: 'day_5' }, { text: 'День 6', callback_data: 'day_6' } ],
    [ { text: 'День 7', callback_data: 'day_7' } ],
    [ { text: '🛒 Список покупок', callback_data: `shopping_list_${menuId}` } ]
  ];

  await ctx.reply('✅ Меню на неделю готово!\n\nВыберите день, чтобы посмотреть блюда:', {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: dayButtons }
  });
  await ctx.reply('Используйте меню:', getMainMenuKeyboard());
}

module.exports = { sendWeeklyMenu, canGenerateMenu };


