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
      await ctx.reply('🍽️ Начинаю генерацию персонального меню на неделю...\n\n⏳ Пожалуйста, подождите. Я пришлю дни по мере готовности.');
  
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

    // Отправляем пользовательское меню по дням по мере готовности
    for (let day = 1; day <= 7; day++) {
      const dayMeals = meals.filter(m => m.day === day);
      if (dayMeals.length === 0) continue;

      console.log(`Sending menu for day ${day}`);
      let msg = `📅 <b>День ${day}</b>\n\n`;
      const buttons = [];

      dayMeals.forEach(m => {
        const title = escapeHtml(m.name);
        const mealLabel = m.meal_time === 'breakfast' ? 'Завтрак' : m.meal_time === 'lunch' ? 'Обед' : 'Ужин';
        const macros = escapeHtml(`Б${m.protein}/Ж${m.fat}/У${m.carbs}`);
        const portion = escapeHtml(String(m.portion));
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

      await bot.telegram.sendMessage(telegramId, msg, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: buttons
        }
      });
    }

    // Список покупок сформируем позже, когда рецепты будут готовы
    console.log('Scheduling shopping list generation...');
    (async () => {
      try {
        const deadline = Date.now() + 120000; // ждём до 2 минут
        let mealsFromDb = [];
        while (Date.now() < deadline) {
          const res = await db.query('SELECT name, recipe FROM meals WHERE menu_id=$1', [menuId]);
          mealsFromDb = res.rows;
          const total = mealsFromDb.length;
          const ready = mealsFromDb.filter(m => !!m.recipe).length;
          if (total > 0 && ready === total) break;
          await new Promise(r => setTimeout(r, 5000));
        }

        if (mealsFromDb.length === 0) return;

        const shoppingList = await getShoppingListFromMenu(mealsFromDb);
        const text = String(shoppingList || '').trim();
        if (!text) return;
        const looksLikeJson = /^\s*[\[{]/.test(text);
        const payload = looksLikeJson
          ? `🛒 <b>Список покупок на неделю</b>\n\n<pre>${escapeHtml(text)}</pre>`
          : `🛒 <b>Список покупок на неделю</b>\n\n${text}`;
        await bot.telegram.sendMessage(
          telegramId,
          payload,
          { parse_mode: 'HTML' }
        );
        console.log('Shopping list sent');
      } catch (e) {
        console.error('Failed to send shopping list:', e);
      }
    })();
    console.log('Menu generation completed successfully');

  } catch (error) {
    console.error('Error generating menu:', error);
    await bot.telegram.sendMessage(telegramId, 'Произошла ошибка при генерации меню. Попробуйте снова позже.');
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
