const { Telegraf, session, Scenes } = require('telegraf');
const { BOT_TOKEN } = require('./config');
const registerScene = require('./scenes/registerScene');
const userController = require('./controllers/userController');
const { createWeeklyMenu, getShoppingListFromMenu } = require('./controllers/menuController');
const { getRecipeByMealId } = require('./controllers/recipeController');

const bot = new Telegraf(BOT_TOKEN);

// Сцены
const stage = new Scenes.Stage([ registerScene ]);
bot.use(session());
bot.use(stage.middleware());

// Команда /start
bot.start((ctx) => {
  ctx.reply('Привет! Я помогу рассчитать твою норму калорий и составить меню.');
  ctx.scene.enter('registerScene');
});

// Пример команды /menu
bot.command('menu', async (ctx) => {
  const telegramId = ctx.from.id;
  const user = await userController.getUserByTelegramId(telegramId);
  if (!user) {
    return ctx.reply('Сначала выполни /start для ввода данных.');
  }
  // В реальном проекте можно проверять user.is_premium

  await ctx.reply('Генерирую персональное меню на неделю... подождите, это может занять время (до 2 мин).');
  (async () => {
    try {
        const { menuId, meals } = await createWeeklyMenu(
            user.id,
            user.daily_calories,
            user.protein,
            user.fat,
            user.carbs,
            user.goal
        );

        // Отправляем пользовательское меню по дням
        for (let day = 1; day <= 7; day++) {
            const dayMeals = meals.filter(m => m.day === day);
            if (dayMeals.length === 0) continue;

            let msg = `*День ${day}*\n`;
            const buttons = [];

            dayMeals.forEach(m => {
                msg += `${m.meal_time === 'breakfast' ? 'Завтрак' : m.meal_time === 'lunch' ? 'Обед' : 'Ужин'}:\n` +
                    `*${m.name}* — ${m.calories} ккал (Б${m.protein}/Ж${m.fat}/У${m.carbs}), порция ~${m.portion} г.\n\n`;
                buttons.push([{
                    text: m.name, 
                    callback_data: `recipe_${m.id}`
                }]);
            });

            await bot.telegram.sendMessage(telegramId, msg, {
                parse_mode: 'Markdown',
                reply_markup: {
                  inline_keyboard: buttons
                }
            });
            /*await ctx.reply(msg, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: buttons }
            });*/
        }

        // Список покупок
        const shoppingList = await getShoppingListFromMenu(meals);
        await bot.telegram.sendMessage(
            telegramId,
            `🛒 Список покупок на неделю:\n${shoppingList}`,
            { parse_mode: 'Markdown' }
        );
        //await ctx.reply(`🛒 Список покупок на неделю:\n${shoppingList}`, { parse_mode: 'Markdown' });

    } catch (error) {
        console.error('Error generating menu:', error);
        await bot.telegram.sendMessage(telegramId, 'Произошла ошибка при генерации меню. Попробуйте снова позже.');
        //ctx.reply('Произошла ошибка при генерации меню. Попробуйте снова позже.');
    }
  })();
});

// Обработка нажатия на кнопку рецепта
bot.action(/recipe_(\d+)/, async (ctx) => {
    const mealId = ctx.match[1];
    const meal = await getRecipeByMealId(mealId);
    if (!meal) return ctx.answerCbQuery('Рецепт не найден', { show_alert: true });

    const { ingredients = [], steps = [], cookingTimeMinutes = 0 } = meal.recipe;

    let msg = `*${meal.name}*\n\n`;
    msg += `*Ингредиенты:*\n`;
    ingredients.forEach(ing => {
        msg += ` - ${ing}\n`;
    });
    msg += `\n*Шаги приготовления:*\n`;
    steps.forEach((step, i) => {
        msg += `${i + 1}. ${step}\n`;
    });
    msg += `\nПримерное время: ~${cookingTimeMinutes} минут.\n`;

    await ctx.answerCbQuery();
    await ctx.reply(msg, { parse_mode: 'Markdown' });
});
  

module.exports = bot;
