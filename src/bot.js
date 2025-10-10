const { Telegraf, session, Scenes } = require('telegraf');
const { BOT_TOKEN } = require('./config');
const registerScene = require('./scenes/registerScene');
const userController = require('./controllers/userController');
const { createWeeklyMenu, getShoppingListFromMenu } = require('./controllers/menuController');
const { getRecipeByMealId } = require('./controllers/recipeController');
const escapeMd = require('./utils/escapeMarkdown');
const escapeHtml = require('./utils/escapeHtml');
const rateLimit = require('telegraf-ratelimit');
const db = require('./services/db');

console.log('Initializing bot with token:', BOT_TOKEN ? 'Token exists' : 'Token missing');
if (!BOT_TOKEN) {
  throw new Error('BOT_TOKEN is not set. Please configure environment variables.');
}
const bot = new Telegraf(BOT_TOKEN);

// Rate limiting middleware
bot.use(rateLimit({
  window: 1000, // 1 second
  limit: 1, // 1 message per second
  onLimitExceeded: (ctx) => ctx.reply('Пожалуйста, подождите немного перед следующим запросом.')
}));

// Error handling middleware
bot.use(async (ctx, next) => {
  try {
    console.log('Processing message from user:', ctx.from?.id);
    await next();
  } catch (err) {
    console.error('Bot error:', err);
    await ctx.reply('Произошла ошибка. Пожалуйста, попробуйте позже или обратитесь к администратору.');
  }
});

// Сцены
console.log('Setting up scenes...');
const stage = new Scenes.Stage([ registerScene ]);
bot.use(session());
bot.use(stage.middleware());

// Input validation middleware
const validateUser = async (ctx, next) => {
  if (!ctx.from || !ctx.from.id) {
    console.error('User validation failed: missing user data');
    return ctx.reply('Ошибка: не удалось определить пользователя.');
  }
  console.log('User validated:', ctx.from.id);
  return next();
};

// Команда /start
bot.start(validateUser, (ctx) => {
  console.log('Start command received from user:', ctx.from.id);
  ctx.reply('👋 Привет! Я помогу рассчитать твою норму калорий и составить персональное меню на неделю.\n\n📝 Давайте начнем с регистрации!');
  ctx.scene.enter('registerScene');
});

// Пример команды /menu
bot.command('menu', validateUser, async (ctx) => {
  console.log('Menu command received from user:', ctx.from.id);
  const telegramId = ctx.from.id;
  const user = await userController.getUserByTelegramId(telegramId);
  if (!user) {
    console.log('User not found:', telegramId);
    return ctx.reply('⚠️ Сначала выполните команду <code>/start</code> для ввода данных.', { parse_mode: 'HTML' });
  }

  console.log('Generating menu for user:', telegramId);
  await ctx.reply('🍽️ Начинаю генерацию персонального меню на неделю...\n\n⏳ Пожалуйста, подождите.');
  
  try {
    console.log('Creating weekly menu...');
    const { menuId, meals } = await createWeeklyMenu(
      user.id,
      user.daily_calories,
      user.protein,
      user.fat,
      user.carbs,
      user.goal
    );
    console.log('Menu created successfully, menuId:', menuId);

    // Сохраняем menuId в сессии для последующей загрузки списка покупок
    if (!ctx.session) ctx.session = {};
    ctx.session.currentMenuId = menuId;

    // Отправляем меню с кнопками по дням недели
    const dayButtons = [
      [
        { text: 'День 1', callback_data: 'day_1' },
        { text: 'День 2', callback_data: 'day_2' }
      ],
      [
        { text: 'День 3', callback_data: 'day_3' },
        { text: 'День 4', callback_data: 'day_4' }
      ],
      [
        { text: 'День 5', callback_data: 'day_5' },
        { text: 'День 6', callback_data: 'day_6' }
      ],
      [
        { text: 'День 7', callback_data: 'day_7' }
      ],
      [
        { text: '🛒 Список покупок', callback_data: `shopping_list_${menuId}` }
      ]
    ];

    await bot.telegram.sendMessage(
      telegramId,
      '✅ Меню на неделю готово!\n\nВыберите день, чтобы посмотреть блюда:',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: dayButtons
        }
      }
    );
    console.log('Menu generation completed successfully');

  } catch (error) {
    console.error('Error generating menu:', error);
    await bot.telegram.sendMessage(telegramId, 'Произошла ошибка при генерации меню. Попробуйте снова позже.');
  }
});

// Обработка нажатия на кнопку дня
bot.action(/day_(\d+)/, validateUser, async (ctx) => {
  try {
    const day = parseInt(ctx.match[1]);
    console.log('Day request received for day:', day);
    
    const telegramId = ctx.from.id;
    const user = await userController.getUserByTelegramId(telegramId);
    if (!user) {
      return ctx.answerCbQuery('Пользователь не найден', { show_alert: true });
    }

    // Получаем последнее меню пользователя
    const menuRes = await db.query(
      'SELECT id FROM menus WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',
      [user.id]
    );
    if (menuRes.rows.length === 0) {
      return ctx.answerCbQuery('Меню не найдено', { show_alert: true });
    }
    const menuId = menuRes.rows[0].id;

    // Получаем блюда для выбранного дня
    const mealsRes = await db.query(
      'SELECT id, day, meal_time, name, calories, protein, fat, carbs, portion_weight FROM meals WHERE menu_id=$1 AND day=$2',
      [menuId, day]
    );
    const dayMeals = mealsRes.rows;

    if (dayMeals.length === 0) {
      return ctx.answerCbQuery('Блюда не найдены для этого дня', { show_alert: true });
    }

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
      buttons.push([{
        text: m.name,
        callback_data: `recipe_${m.id}`
      }]);
    });

    await ctx.answerCbQuery();
    await ctx.reply(msg, {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: buttons
      }
    });
    console.log('Day menu sent successfully');
  } catch (error) {
    console.error('Error fetching day menu:', error);
    await ctx.answerCbQuery('Произошла ошибка при получении меню', { show_alert: true });
  }
});

// Обработка нажатия на кнопку списка покупок
bot.action(/shopping_list_(\d+)/, validateUser, async (ctx) => {
  try {
    const menuId = ctx.match[1];
    console.log('Shopping list request received for menu:', menuId);

    await ctx.answerCbQuery();
    await ctx.reply('🛒 Формирую список покупок...\n\n⏳ Пожалуйста, подождите.');

    // Ждём пока все рецепты будут готовы
    const deadline = Date.now() + 120000; // ждём до 2 минут
    let mealsFromDb = [];
    while (Date.now() < deadline) {
      const res = await db.query('SELECT name, recipe FROM meals WHERE menu_id=$1', [menuId]);
      mealsFromDb = res.rows;
      const total = mealsFromDb.length;
      const ready = mealsFromDb.filter(m => !!m.recipe).length;
      console.log(`Recipes ready: ${ready}/${total}`);
      if (total > 0 && ready === total) break;
      await new Promise(r => setTimeout(r, 5000));
    }

    if (mealsFromDb.length === 0) {
      return ctx.reply('Список покупок пуст. Нет доступных блюд.');
    }

    const shoppingList = await getShoppingListFromMenu(mealsFromDb);
    const text = String(shoppingList || '').trim();
    if (!text) {
      return ctx.reply('Не удалось сформировать список покупок.');
    }

    const looksLikeJson = /^\s*[\[{]/.test(text);
    const payload = looksLikeJson
      ? `🛒 <b>Список покупок на неделю</b>\n\n<pre>${escapeHtml(text)}</pre>`
      : `🛒 <b>Список покупок на неделю</b>\n\n${text}`;
    
    await ctx.reply(payload, { parse_mode: 'HTML' });
    console.log('Shopping list sent successfully');
  } catch (error) {
    console.error('Error generating shopping list:', error);
    await ctx.reply('Произошла ошибка при формировании списка покупок.');
  }
});

// Обработка нажатия на кнопку рецепта
bot.action(/recipe_(\d+)/, validateUser, async (ctx) => {
  try {
    const mealId = ctx.match[1];
    console.log('Recipe request received for meal:', mealId);
    
    const meal = await getRecipeByMealId(mealId);
    if (!meal) {
      console.log('Recipe not found for meal:', mealId);
      return ctx.answerCbQuery('Рецепт не найден', { show_alert: true });
    }

    const { ingredients = [], steps = [], cookingTimeMinutes = 0 } = meal.recipe;

    let msg = `📖 <b>Рецепт: ${escapeHtml(meal.name)}</b>\n\n`;
    msg += `🥕 <b>Ингредиенты:</b>\n`;
    ingredients.forEach(ing => {
      msg += ` • ${escapeHtml(ing)}\n`;
    });
    msg += `\n👨‍🍳 <b>Шаги приготовления:</b>\n`;
    steps.forEach((step, i) => {
      msg += `${i + 1}. ${escapeHtml(step)}\n`;
    });
    msg += `\n⏱ <b>Время приготовления:</b> ~${cookingTimeMinutes} минут\n`;

    await ctx.answerCbQuery();
    await ctx.reply(msg.replace(/\n/g,'\n'), { parse_mode: 'HTML' });
    console.log('Recipe sent successfully');
  } catch (error) {
    console.error('Error fetching recipe:', error);
    await ctx.answerCbQuery('Произошла ошибка при получении рецепта', { show_alert: true });
  }
});

module.exports = bot;
