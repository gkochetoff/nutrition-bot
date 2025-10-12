const { Markup } = require('telegraf');
const userController = require('../../controllers/userController');
const { createWeeklyMenu, getShoppingListFromMenu } = require('../../controllers/menuController');
const { getRecipeByMealId } = require('../../controllers/recipeController');
const { getMainMenuKeyboard } = require('../../keyboards');
const escapeHtml = require('../../utils/escapeHtml');
const db = require('../../services/db');
const { sendWeeklyMenu } = require('../utils/menuFlow');

async function registerMenuCommands(bot) {
  // /menu command
  bot.command('menu', async (ctx) => {
    const telegramId = ctx.from.id;
    const user = await userController.getUserByTelegramId(telegramId);
    if (!user) {
      return ctx.reply('⚠️ Сначала выполните команду <code>/start</code> для ввода данных.', { parse_mode: 'HTML' });
    }

    await ctx.reply('🍽️ Начинаю генерацию персонального меню на неделю...\n\n⏳ Пожалуйста, подождите.');
    try {
      await sendWeeklyMenu(ctx, user);
    } catch (error) {
      console.error('Error generating menu:', error);
      await ctx.reply('Произошла ошибка при генерации меню. Попробуйте снова позже.');
    }
  });

  // Explicit confirmation flow
  bot.hears('✅ Да, сгенерировать новое меню', async (ctx) => {
    const telegramId = ctx.from.id;
    const user = await userController.getUserByTelegramId(telegramId);
    if (!user) {
      return ctx.reply('⚠️ Сначала выполните команду <code>/start</code> для ввода данных.', { parse_mode: 'HTML' });
    }
    await ctx.reply('🍽️ Начинаю генерацию персонального меню на неделю...\n\n⏳ Пожалуйста, подождите.');
    try { await sendWeeklyMenu(ctx, user); } catch { await ctx.reply('Произошла ошибка при генерации меню. Попробуйте снова позже.'); }
  });

  bot.hears('❌ Нет, позже', async (ctx) => {
    await ctx.reply('Хорошо, вы можете сгенерировать новое меню позже.', getMainMenuKeyboard());
  });

  // "Новое меню" button
  bot.hears('Новое меню', async (ctx) => {
    const telegramId = ctx.from.id;
    const user = await userController.getUserByTelegramId(telegramId);
    if (!user) {
      return ctx.reply('⚠️ Сначала выполните команду <code>/start</code> для ввода данных.', { parse_mode: 'HTML' });
    }
    await ctx.reply('🍽️ Начинаю генерацию персонального меню на неделю...\n\n⏳ Пожалуйста, подождите.');
    try {
      await sendWeeklyMenu(ctx, user);
    } catch (error) {
      console.error('Error generating menu:', error);
      await ctx.reply('Произошла ошибка при генерации меню. Попробуйте снова позже.');
    }
  });

  // "Моё меню на неделю"
  bot.hears('Моё меню на неделю', async (ctx) => {
    const telegramId = ctx.from.id;
    const user = await userController.getUserByTelegramId(telegramId);
    if (!user) {
      return ctx.reply('⚠️ Сначала выполните команду <code>/start</code> для ввода данных.', { parse_mode: 'HTML' });
    }
    const menuRes = await db.query('SELECT id FROM menus WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1', [user.id]);
    if (menuRes.rows.length === 0) {
      return ctx.reply('У вас пока нет сгенерированного меню. Используйте команду /menu для создания меню.');
    }
    const menuId = menuRes.rows[0].id;
    const dayButtons = [
      [ { text: 'День 1', callback_data: 'day_1' }, { text: 'День 2', callback_data: 'day_2' } ],
      [ { text: 'День 3', callback_data: 'day_3' }, { text: 'День 4', callback_data: 'day_4' } ],
      [ { text: 'День 5', callback_data: 'day_5' }, { text: 'День 6', callback_data: 'day_6' } ],
      [ { text: 'День 7', callback_data: 'day_7' } ],
      [ { text: '🛒 Список покупок', callback_data: `shopping_list_${menuId}` } ]
    ];
    await ctx.reply('📋 Ваше меню на неделю\n\nВыберите день, чтобы посмотреть блюда:', {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: dayButtons }
    });
  });

  // Day selection
  bot.action(/day_(\d+)/, async (ctx) => {
    const day = parseInt(ctx.match[1]);
    const telegramId = ctx.from.id;
    const user = await userController.getUserByTelegramId(telegramId);
    if (!user) return ctx.answerCbQuery('Пользователь не найден', { show_alert: true });

    const menuRes = await db.query('SELECT id FROM menus WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1', [user.id]);
    if (menuRes.rows.length === 0) return ctx.answerCbQuery('Меню не найдено', { show_alert: true });
    const menuId = menuRes.rows[0].id;

    const mealsRes = await db.query(
      'SELECT id, day, meal_time, name, calories, protein, fat, carbs, portion_weight FROM meals WHERE menu_id=$1 AND day=$2',
      [menuId, day]
    );
    const dayMeals = mealsRes.rows;
    if (dayMeals.length === 0) return ctx.answerCbQuery('Блюда не найдены для этого дня', { show_alert: true });

    let msg = `📅 <b>День ${day}</b>\n\n`;
    const buttons = [];
    dayMeals.forEach(m => {
      const title = escapeHtml(m.name);
      const mealLabel = m.meal_time === 'breakfast' ? 'Завтрак' : m.meal_time === 'lunch' ? 'Обед' : 'Ужин';
      const macros = escapeHtml(`Б${m.protein}/Ж${m.fat}/У${m.carbs}`);
      const portion = escapeHtml(String(m.portion_weight));
      msg += `🍽️ <b>${mealLabel}</b>\n` +
             `• <b>${title}</b>\n` +
             `• Калории: ${m.calories} ккал\n` +
             `• БЖУ: ${macros}\n` +
             `• Порция: ≈ ${portion} г\n\n`;
      buttons.push([{ text: m.name, callback_data: `recipe_${m.id}` }]);
    });
    await ctx.answerCbQuery();
    await ctx.reply(msg, { parse_mode: 'HTML', reply_markup: { inline_keyboard: buttons } });
  });

  // Shopping list
  bot.action(/shopping_list_(\d+)/, async (ctx) => {
    const menuId = ctx.match[1];
    await ctx.answerCbQuery();
    await ctx.reply('🛒 Формирую список покупок...\n\n⏳ Пожалуйста, подождите.');
    let mealsFromDb = [];
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      const res = await db.query('SELECT name, recipe FROM meals WHERE menu_id=$1', [menuId]);
      mealsFromDb = res.rows;
      const total = mealsFromDb.length;
      const ready = mealsFromDb.filter(m => !!m.recipe).length;
      if (total > 0 && ready === total) break;
      await new Promise(r => setTimeout(r, 5000));
    }
    if (mealsFromDb.length === 0) return ctx.reply('Список покупок пуст. Нет доступных блюд.');
    const shoppingList = await getShoppingListFromMenu(mealsFromDb);
    const text = String(shoppingList || '').trim();
    if (!text) return ctx.reply('Не удалось сформировать список покупок.');
    const looksLikeJson = /^\s*[\[{]/.test(text);
    const payload = looksLikeJson
      ? `🛒 <b>Список покупок на неделю</b>\n\n<pre>${escapeHtml(text)}</pre>`
      : `🛒 <b>Список покупок на неделю</b>\n\n${text}`;
    await ctx.reply(payload, { parse_mode: 'HTML' });
  });

  // Recipe open
  bot.action(/recipe_(\d+)/, async (ctx) => {
    const mealId = ctx.match[1];
    const meal = await getRecipeByMealId(mealId);
    if (!meal) return ctx.answerCbQuery('Рецепт не найден', { show_alert: true });
    const { ingredients = [], steps = [], cookingTimeMinutes = 0 } = meal.recipe;
    let msg = `📖 <b>Рецепт: ${escapeHtml(meal.name)}</b>\n\n`;
    msg += `🥕 <b>Ингредиенты:</b>\n`;
    ingredients.forEach(ing => { msg += ` • ${escapeHtml(ing)}\n`; });
    msg += `\n👨‍🍳 <b>Шаги приготовления:</b>\n`;
    steps.forEach((step, i) => { msg += `${i + 1}. ${escapeHtml(step)}\n`; });
    msg += `\n⏱ <b>Время приготовления:</b> ~${cookingTimeMinutes} минут\n`;
    await ctx.answerCbQuery();
    await ctx.reply(msg, { parse_mode: 'HTML' });
  });

  // Generate/no menu actions from inline buttons
  bot.action('generate_new_menu', async (ctx) => {
    await ctx.answerCbQuery();
    const telegramId = ctx.from.id;
    const user = await userController.getUserByTelegramId(telegramId);
    if (!user) return ctx.reply('⚠️ Сначала выполните команду <code>/start</code> для ввода данных.', { parse_mode: 'HTML' });
    await ctx.reply('🍽️ Начинаю генерацию персонального меню на неделю...\n\n⏳ Пожалуйста, подождите.');
    try { await sendWeeklyMenu(ctx, user); } catch { await ctx.reply('Произошла ошибка при генерации меню. Попробуйте снова позже.'); }
  });

  bot.action('no_new_menu', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply('Хорошо, вы можете сгенерировать новое меню позже.', getMainMenuKeyboard());
  });
}

module.exports = { registerMenuCommands };


