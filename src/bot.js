const { Telegraf, session, Scenes } = require('telegraf');
const { BOT_TOKEN } = require('./config');
const registerScene = require('./scenes/registerScene');
const userController = require('./controllers/userController');
const { createWeeklyMenu, getShoppingListFromMenu } = require('./controllers/menuController');
const { getRecipeByMealId } = require('./controllers/recipeController');
const { getMainMenuKeyboard } = require('./keyboards');
const escapeMd = require('./utils/escapeMarkdown');
const escapeHtml = require('./utils/escapeHtml');
const rateLimit = require('telegraf-ratelimit');
const db = require('./services/db');

// Общие справочники и константы
const FIELD_NAMES = {
  age: 'возраст',
  gender: 'пол',
  weight: 'вес',
  height: 'рост',
  activity: 'уровень активности',
  goal: 'цель'
};

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
bot.start(validateUser, async (ctx) => {
  console.log('Start command received from user:', ctx.from.id);
  const telegramId = ctx.from.id;
  const user = await userController.getUserByTelegramId(telegramId);
  
  if (user) {
    // Пользователь уже зарегистрирован
    ctx.reply(
      '👋 С возвращением! Используйте кнопки ниже для навигации.',
      getMainMenuKeyboard()
    );
  } else {
    // Новый пользователь
  ctx.reply('👋 Привет! Я помогу рассчитать твою норму калорий и составить персональное меню на неделю.\n\n📝 Давайте начнем с регистрации!');
  ctx.scene.enter('registerScene');
  }
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

    // Возвращаем главную клавиатуру
    await bot.telegram.sendMessage(telegramId, 'Используйте меню:', getMainMenuKeyboard());

    console.log('Menu generation completed successfully');

  } catch (error) {
    console.error('Error generating menu:', error);
    await bot.telegram.sendMessage(telegramId, 'Произошла ошибка при генерации меню. Попробуйте снова позже.');
  }
});

// Обработчик кнопки "Пересчитать калории"
bot.hears('Пересчитать калории', validateUser, async (ctx) => {
  console.log('Recalculate command received from user:', ctx.from.id);

  const telegramId = ctx.from.id;
  const user = await userController.getUserByTelegramId(telegramId);

  if (!user) {
    ctx.reply('⚠️ Сначала выполните команду <code>/start</code> для ввода данных.', { parse_mode: 'HTML' });
    return;
  }

  // Показываем текущие данные и предлагаем изменить
  const genderText = user?.gender ? (user.gender === 'M' ? 'Мужской' : 'Женский') : '—';
  const activityText = {
    'низкий': 'Низкий',
    'средний': 'Средний',
    'высокий': 'Высокий'
  }[user?.activity_level] || user?.activity_level || '—';

  const goalText = {
    'lose': 'Сброс веса',
    'maintain': 'Поддержание',
    'gain': 'Набор веса'
  }[user?.goal] || user?.goal || '—';

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
          [
            { text: '👤 Возраст', callback_data: 'update_age' },
            { text: '👥 Пол', callback_data: 'update_gender' }
          ],
          [
            { text: '⚖️ Вес', callback_data: 'update_weight' },
            { text: '📏 Рост', callback_data: 'update_height' }
          ],
          [
            { text: '🤸 Активность', callback_data: 'update_activity' },
            { text: '🥅 Цель', callback_data: 'update_goal' }
          ],
          [
            { text: '🔄 Обновить все данные', callback_data: 'update_all' }
          ],
          [
            { text: '❌ Отмена', callback_data: 'cancel_update' }
          ]
        ]
      }
    }
  );
});

// Обработчик кнопки "Да, сгенерировать новое меню"
bot.hears('✅ Да, сгенерировать новое меню', validateUser, async (ctx) => {
  console.log('Generate new menu confirmed by user:', ctx.from.id);
  const telegramId = ctx.from.id;
  const user = await userController.getUserByTelegramId(telegramId);
  if (!user) {
    return ctx.reply('⚠️ Сначала выполните команду <code>/start</code> для ввода данных.', { parse_mode: 'HTML' });
  }

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

    if (!ctx.session) ctx.session = {};
    ctx.session.currentMenuId = menuId;

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

    await ctx.reply(
      '✅ Меню на неделю готово!\n\nВыберите день, чтобы посмотреть блюда:',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: dayButtons
        }
      }
    );

    // Возвращаем главную клавиатуру
    await ctx.reply('Используйте меню:', getMainMenuKeyboard());

    console.log('Menu generation completed successfully');
  } catch (error) {
    console.error('Error generating menu:', error);
    await ctx.reply('Произошла ошибка при генерации меню. Попробуйте снова позже.');
  }
});

// Обработчик кнопки "Нет, позже"
bot.hears('❌ Нет, позже', validateUser, async (ctx) => {
  console.log('Generate new menu declined by user:', ctx.from.id);
  await ctx.reply(
    'Хорошо, вы можете сгенерировать новое меню позже.',
    getMainMenuKeyboard()
  );
});

// Обработчик кнопки "Да, сгенерировать новое меню" (для обновления данных)
bot.action('generate_new_menu', validateUser, async (ctx) => {
  await ctx.answerCbQuery();
  console.log('Generate new menu confirmed by user:', ctx.from.id);

  const telegramId = ctx.from.id;
  const user = await userController.getUserByTelegramId(telegramId);
  if (!user) {
    return ctx.reply('⚠️ Сначала выполните команду <code>/start</code> для ввода данных.', { parse_mode: 'HTML' });
  }

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

    if (!ctx.session) ctx.session = {};
    ctx.session.currentMenuId = menuId;

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

    await ctx.reply(
      '✅ Меню на неделю готово!\n\nВыберите день, чтобы посмотреть блюда:',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: dayButtons
        }
      }
    );

    await ctx.reply('Используйте меню:', getMainMenuKeyboard());

    console.log('Menu generation completed successfully');
  } catch (error) {
    console.error('Error generating menu:', error);
    await ctx.reply('Произошла ошибка при генерации меню. Попробуйте снова позже.');
  }
});

// Обработчик кнопки "Нет, позже" (для обновления данных)
bot.action('no_new_menu', validateUser, async (ctx) => {
  await ctx.answerCbQuery();
  console.log('Generate new menu declined by user:', ctx.from.id);
  await ctx.reply(
    'Хорошо, вы можете сгенерировать новое меню позже.',
    getMainMenuKeyboard()
  );
});

// Обработчики для обновления данных
bot.action(/update_(age|gender|weight|height|activity|goal)/, validateUser, async (ctx) => {
  const field = ctx.match[1];
  const fieldNames = FIELD_NAMES;

  await ctx.answerCbQuery();

  // Для цели и активности показываем кнопки выбора
  if (field === 'goal') {
    await ctx.reply('📝 Выберите новую цель:', {
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Сброс веса', callback_data: 'goal_lose' },
            { text: 'Поддержание', callback_data: 'goal_maintain' }
          ],
          [
            { text: 'Набор веса', callback_data: 'goal_gain' }
          ]
        ]
      }
    });
  } else if (field === 'activity') {
    await ctx.reply('📝 Выберите новый уровень активности:', {
      reply_markup: {
        inline_keyboard: [
          [
            { text: 'Низкий', callback_data: 'activity_low' },
            { text: 'Средний', callback_data: 'activity_medium' }
          ],
          [
            { text: 'Высокий', callback_data: 'activity_high' }
          ]
        ]
      }
    });
  } else {
    await ctx.reply(`📝 Введите новый ${fieldNames[field]}:`);
  }

  // Сохраняем поле для обновления в сессии
  if (!ctx.session) ctx.session = {};
  ctx.session.updateField = field;
  ctx.session.waitingForUpdate = true;
});

bot.action('update_all', validateUser, async (ctx) => {
  await ctx.answerCbQuery();
  ctx.reply('📝 Давайте обновим все ваши данные по порядку.');
  ctx.scene.enter('registerScene');
});

bot.action('cancel_update', validateUser, async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('❌ Обновление отменено.', getMainMenuKeyboard());
});

// Обработчики кнопок выбора цели
bot.action(/goal_(lose|maintain|gain)/, validateUser, async (ctx) => {
  const goal = ctx.match[1];
  const field = 'goal';
  const fieldNames = FIELD_NAMES;
  let updateData = {};
  let needsRecalculation = false;

  try {
    await ctx.answerCbQuery();
    
    const telegramId = ctx.from.id;
    const user = await userController.getUserByTelegramId(telegramId);

    if (!user) {
      await ctx.reply('⚠️ Пользователь не найден.', getMainMenuKeyboard());
      return;
    }

    updateData.goal = goal;
    needsRecalculation = true;

    // Если нужны пересчеты калорий
    const { calculateBMR, activityFactor, adjustCaloriesForGoal, calculateMacros } = require('./services/macrosService');

    const currentData = {
      weight: updateData.weight || user.weight,
      height: updateData.height || user.height,
      age: updateData.age || user.age,
      gender: updateData.gender || user.gender,
      activity_level: updateData.activity_level || user.activity_level,
      goal: updateData.goal || user.goal
    };

    console.log('Calculating with data:', currentData);

    // Проверяем, что все необходимые данные присутствуют
    if (!currentData.weight || !currentData.height || !currentData.age || !currentData.gender) {
      console.error('Missing required data:', {
        weight: currentData.weight,
        height: currentData.height,
        age: currentData.age,
        gender: currentData.gender
      });
      throw new Error('Missing required data for calculation');
    }

    try {
      console.log('Starting calculation...');
      const bmr = calculateBMR(currentData);
      console.log('BMR calculated:', bmr);
      
      const tdee = bmr * activityFactor(currentData.activity_level);
      console.log('TDEE calculated:', tdee);
      
      const dailyCalories = adjustCaloriesForGoal(tdee, currentData.goal);
      console.log('Daily calories calculated:', dailyCalories);
      
      const macros = calculateMacros(dailyCalories);
      console.log('Macros calculated:', macros);

      console.log('Calculated values:', { bmr, tdee, dailyCalories, macros });

      // Проверяем, что все значения корректны
      if (!dailyCalories || !macros.protein || !macros.fat || !macros.carbs ||
          isNaN(dailyCalories) || isNaN(macros.protein) || isNaN(macros.fat) || isNaN(macros.carbs)) {
        console.error('Invalid calculated values:', { dailyCalories, macros });
        throw new Error('Invalid calculated values');
      }

      console.log('Updating user in database...');
      // Обновляем все данные за один раз
      await userController.upsertUser({
        telegram_id: telegramId,
        age: currentData.age,
        gender: currentData.gender,
        weight: currentData.weight,
        height: currentData.height,
        activity: currentData.activity_level,
        goal: currentData.goal,
        daily_calories: dailyCalories,
        protein: macros.protein,
        fat: macros.fat,
        carbs: macros.carbs
      });

      console.log('User data updated successfully');
    } catch (calcError) {
      console.error('Error in calculation:', calcError);
      console.error('Error stack:', calcError.stack);
      throw calcError;
    }

    // Очищаем сессию
    ctx.session.updateField = null;
    ctx.session.waitingForUpdate = false;

    // Проверяем, действительно ли что-то изменилось
    const updatedUser = await userController.getUserByTelegramId(telegramId);
    
    // Сравниваем старые и новые значения (приводим к одному типу для корректного сравнения)
    let actualChanges = [];
    if (updateData.goal && updateData.goal !== user.goal) actualChanges.push('цель');

    if (actualChanges.length > 0) {
      // Показываем обновленные данные только если что-то действительно изменилось
      const genderText = updatedUser?.gender ? (updatedUser.gender === 'M' ? 'Мужской' : 'Женский') : '—';
      const activityText = {
        'низкий': 'Низкий',
        'средний': 'Средний',
        'высокий': 'Высокий'
      }[updatedUser?.activity_level] || updatedUser?.activity_level || '—';

      const goalText = {
        'lose': 'Сброс веса',
        'maintain': 'Поддержание',
        'gain': 'Набор веса'
      }[updatedUser?.goal] || updatedUser?.goal || '—';

      await ctx.reply(
        `✅ ${actualChanges.join(', ')} успешно обновлен${actualChanges.length > 1 ? 'ы' : ''}!\n\n` +
        `📋 Обновленные данные:\n` +
        `👤 Возраст: ${updatedUser?.age ?? '—'} лет\n` +
        `👥 Пол: ${genderText}\n` +
        `⚖️ Вес: ${updatedUser?.weight ?? '—'} кг\n` +
        `📏 Рост: ${updatedUser?.height ?? '—'} см\n` +
        `🤸 Активность: ${activityText}\n` +
        `🥅 Цель: ${goalText}\n\n` +
        `📊 Новая норма калорий: ${updatedUser?.daily_calories ?? '—'} ккал\n` +
        `🥩 Белки: ${updatedUser?.protein ?? '—'} г | 🥑 Жиры: ${updatedUser?.fat ?? '—'} г | 🍞 Углеводы: ${updatedUser?.carbs ?? '—'} г`,
        { parse_mode: 'HTML' }
      );

      // Предлагаем сгенерировать новое меню
      await ctx.reply(
        '🔄 Хотите сгенерировать новое меню с учетом обновленных параметров?',
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Да, сгенерировать новое меню', callback_data: 'generate_new_menu' },
                { text: '❌ Нет, позже', callback_data: 'no_new_menu' }
              ]
            ]
          }
        }
      );
    } else {
      // Если ничего не изменилось, просто сообщаем об этом
      await ctx.reply(
        `ℹ️ ${fieldNames[field]} остался тем же. Никаких изменений не внесено.`,
        getMainMenuKeyboard()
      );
    }

  } catch (error) {
    console.error('Error updating user data:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Field:', field, 'Goal:', goal);

    // Очищаем сессию при ошибке
    ctx.session.updateField = null;
    ctx.session.waitingForUpdate = false;

    let errorMessage = '❌ Произошла ошибка при обновлении данных. Попробуйте еще раз.';
    if (error.message === 'Missing required data for calculation') {
      errorMessage = '❌ Недостаточно данных для пересчета калорий. Попробуйте обновить все данные целиком.';
    } else if (error.message === 'Invalid calculated values') {
      errorMessage = '❌ Ошибка в расчете калорий. Попробуйте обновить все данные целиком.';
    }

    await ctx.reply(errorMessage, getMainMenuKeyboard());
  }
});

// Обработчики кнопок выбора активности
bot.action(/activity_(low|medium|high)/, validateUser, async (ctx) => {
  const activityMap = {
    'low': 'низкий',
    'medium': 'средний', 
    'high': 'высокий'
  };
  const activity = activityMap[ctx.match[1]];
  const field = 'activity';
  const fieldNames = FIELD_NAMES;
  let updateData = {};
  let needsRecalculation = false;

  try {
    await ctx.answerCbQuery();
    
    const telegramId = ctx.from.id;
    const user = await userController.getUserByTelegramId(telegramId);

    if (!user) {
      await ctx.reply('⚠️ Пользователь не найден.', getMainMenuKeyboard());
      return;
    }

    updateData.activity_level = activity;
    needsRecalculation = true;

    // Если нужны пересчеты калорий
    const { calculateBMR, activityFactor, adjustCaloriesForGoal, calculateMacros } = require('./services/macrosService');

    const currentData = {
      weight: updateData.weight || user.weight,
      height: updateData.height || user.height,
      age: updateData.age || user.age,
      gender: updateData.gender || user.gender,
      activity_level: updateData.activity_level || user.activity_level,
      goal: updateData.goal || user.goal
    };

    console.log('Calculating with data:', currentData);

    // Проверяем, что все необходимые данные присутствуют
    if (!currentData.weight || !currentData.height || !currentData.age || !currentData.gender) {
      console.error('Missing required data:', {
        weight: currentData.weight,
        height: currentData.height,
        age: currentData.age,
        gender: currentData.gender
      });
      throw new Error('Missing required data for calculation');
    }

    try {
      console.log('Starting calculation...');
      const bmr = calculateBMR(currentData);
      console.log('BMR calculated:', bmr);
      
      const tdee = bmr * activityFactor(currentData.activity_level);
      console.log('TDEE calculated:', tdee);
      
      const dailyCalories = adjustCaloriesForGoal(tdee, currentData.goal);
      console.log('Daily calories calculated:', dailyCalories);
      
      const macros = calculateMacros(dailyCalories);
      console.log('Macros calculated:', macros);

      console.log('Calculated values:', { bmr, tdee, dailyCalories, macros });

      // Проверяем, что все значения корректны
      if (!dailyCalories || !macros.protein || !macros.fat || !macros.carbs ||
          isNaN(dailyCalories) || isNaN(macros.protein) || isNaN(macros.fat) || isNaN(macros.carbs)) {
        console.error('Invalid calculated values:', { dailyCalories, macros });
        throw new Error('Invalid calculated values');
      }

      console.log('Updating user in database...');
      // Обновляем все данные за один раз
      await userController.upsertUser({
        telegram_id: telegramId,
        age: currentData.age,
        gender: currentData.gender,
        weight: currentData.weight,
        height: currentData.height,
        activity: currentData.activity_level,
        goal: currentData.goal,
        daily_calories: dailyCalories,
        protein: macros.protein,
        fat: macros.fat,
        carbs: macros.carbs
      });

      console.log('User data updated successfully');
    } catch (calcError) {
      console.error('Error in calculation:', calcError);
      console.error('Error stack:', calcError.stack);
      throw calcError;
    }

    // Очищаем сессию
    ctx.session.updateField = null;
    ctx.session.waitingForUpdate = false;

    // Проверяем, действительно ли что-то изменилось
    const updatedUser = await userController.getUserByTelegramId(telegramId);
    
    // Сравниваем старые и новые значения (приводим к одному типу для корректного сравнения)
    let actualChanges = [];
    if (updateData.activity_level && updateData.activity_level !== user.activity_level) actualChanges.push('уровень активности');

    if (actualChanges.length > 0) {
      // Показываем обновленные данные только если что-то действительно изменилось
      const genderText = updatedUser?.gender ? (updatedUser.gender === 'M' ? 'Мужской' : 'Женский') : '—';
      const activityText = {
        'низкий': 'Низкий',
        'средний': 'Средний',
        'высокий': 'Высокий'
      }[updatedUser?.activity_level] || updatedUser?.activity_level || '—';

      const goalText = {
        'lose': 'Сброс веса',
        'maintain': 'Поддержание',
        'gain': 'Набор веса'
      }[updatedUser?.goal] || updatedUser?.goal || '—';

      await ctx.reply(
        `✅ ${actualChanges.join(', ')} успешно обновлен${actualChanges.length > 1 ? 'ы' : ''}!\n\n` +
        `📋 Обновленные данные:\n` +
        `👤 Возраст: ${updatedUser?.age ?? '—'} лет\n` +
        `👥 Пол: ${genderText}\n` +
        `⚖️ Вес: ${updatedUser?.weight ?? '—'} кг\n` +
        `📏 Рост: ${updatedUser?.height ?? '—'} см\n` +
        `🤸 Активность: ${activityText}\n` +
        `🥅 Цель: ${goalText}\n\n` +
        `📊 Новая норма калорий: ${updatedUser?.daily_calories ?? '—'} ккал\n` +
        `🥩 Белки: ${updatedUser?.protein ?? '—'} г | 🥑 Жиры: ${updatedUser?.fat ?? '—'} г | 🍞 Углеводы: ${updatedUser?.carbs ?? '—'} г`,
        { parse_mode: 'HTML' }
      );

      // Предлагаем сгенерировать новое меню
      await ctx.reply(
        '🔄 Хотите сгенерировать новое меню с учетом обновленных параметров?',
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Да, сгенерировать новое меню', callback_data: 'generate_new_menu' },
                { text: '❌ Нет, позже', callback_data: 'no_new_menu' }
              ]
            ]
          }
        }
      );
    } else {
      // Если ничего не изменилось, просто сообщаем об этом
      await ctx.reply(
        `ℹ️ ${fieldNames[field]} остался тем же. Никаких изменений не внесено.`,
        getMainMenuKeyboard()
      );
    }

  } catch (error) {
    console.error('Error updating user data:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Field:', field, 'Activity:', activity);

    // Очищаем сессию при ошибке
    ctx.session.updateField = null;
    ctx.session.waitingForUpdate = false;

    let errorMessage = '❌ Произошла ошибка при обновлении данных. Попробуйте еще раз.';
    if (error.message === 'Missing required data for calculation') {
      errorMessage = '❌ Недостаточно данных для пересчета калорий. Попробуйте обновить все данные целиком.';
    } else if (error.message === 'Invalid calculated values') {
      errorMessage = '❌ Ошибка в расчете калорий. Попробуйте обновить все данные целиком.';
    }

    await ctx.reply(errorMessage, getMainMenuKeyboard());
  }
});

// Обработчик текстовых сообщений для обновления данных
bot.on('text', validateUser, async (ctx, next) => {
  if (!ctx.session || !ctx.session.waitingForUpdate || !ctx.session.updateField) {
    return next(); // Пропускаем дальше к другим хэндлерам (например, hears)
  }

  const field = ctx.session.updateField;
  const value = ctx.message.text.trim();
  const fieldNames = FIELD_NAMES;
  let updateData = {};
  let needsRecalculation = false;

  try {
    const telegramId = ctx.from.id;
    const user = await userController.getUserByTelegramId(telegramId);

    if (!user) {
      await ctx.reply('⚠️ Пользователь не найден.', getMainMenuKeyboard());
      return;
    }

    // Валидация и обновление данных в зависимости от поля

    switch (field) {
      case 'age':
        const age = parseInt(value);
        if (isNaN(age) || age <= 0 || age > 120) {
          await ctx.reply('❌ Введите корректный возраст (1-120 лет).');
          return;
        }
        updateData.age = age;
        needsRecalculation = true;
        break;

      case 'gender':
        const genderInput = value.toLowerCase();
        if (!['м','ж','m','f','муж','жен','мужской','женский'].some(g => genderInput.includes(g))) {
          await ctx.reply('❌ Укажите "М" (мужской) или "Ж" (женский).');
          return;
        }
        const gender = (genderInput.includes('м')) || (genderInput.startsWith('m')) || (genderInput.includes('муж'))
          ? 'M'
          : 'F';
        updateData.gender = gender;
        needsRecalculation = true;
        break;

      case 'weight':
        const weight = parseFloat(value.replace(',', '.'));
        if (isNaN(weight) || weight <= 0 || weight > 500) {
          await ctx.reply('❌ Введите корректный вес (0.1-500 кг).');
          return;
        }
        updateData.weight = weight;
        needsRecalculation = true;
        break;

      case 'height':
        const height = parseInt(value);
        if (isNaN(height) || height <= 0 || height > 250) {
          await ctx.reply('❌ Введите корректный рост (1-250 см).');
          return;
        }
        updateData.height = height;
        needsRecalculation = true;
        break;

      case 'activity':
        const activity = value.toLowerCase();
        if (!['низкий','средний','высокий'].includes(activity)) {
          await ctx.reply('❌ Укажите: низкий, средний или высокий.', {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: 'Низкий', callback_data: 'activity_low' },
                  { text: 'Средний', callback_data: 'activity_medium' }
                ],
                [
                  { text: 'Высокий', callback_data: 'activity_high' }
                ]
              ]
            }
          });
          return;
        }
        updateData.activity_level = activity;
        needsRecalculation = true;
        break;

      case 'goal':
        const goalInput = value.toLowerCase();
        let goal = 'maintain';
        if (goalInput.includes('сброс')) goal = 'lose';
        else if (goalInput.includes('набор')) goal = 'gain';

        if (!['lose', 'maintain', 'gain'].includes(goal)) {
          await ctx.reply('❌ Укажите цель: сброс веса, поддержание или набор веса.', {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: 'Сброс веса', callback_data: 'goal_lose' },
                  { text: 'Поддержание', callback_data: 'goal_maintain' }
                ],
                [
                  { text: 'Набор веса', callback_data: 'goal_gain' }
                ]
              ]
            }
          });
          return;
        }
        updateData.goal = goal;
        needsRecalculation = true;
        break;
    }

    // Если нужны пересчеты калорий
    if (needsRecalculation) {
      const { calculateBMR, activityFactor, adjustCaloriesForGoal, calculateMacros } = require('./services/macrosService');

      const currentData = {
        weight: updateData.weight || user.weight,
        height: updateData.height || user.height,
        age: updateData.age || user.age,
        gender: updateData.gender || user.gender,
        activity_level: updateData.activity_level || user.activity_level,
        goal: updateData.goal || user.goal
      };

      console.log('Calculating with data:', currentData);
      console.log('User data:', user);
      console.log('Update data:', updateData);

      // Проверяем, что все необходимые данные присутствуют
      if (!currentData.weight || !currentData.height || !currentData.age || !currentData.gender) {
        console.error('Missing required data:', {
          weight: currentData.weight,
          height: currentData.height,
          age: currentData.age,
          gender: currentData.gender
        });
        throw new Error('Missing required data for calculation');
      }

      try {
        console.log('Starting calculation...');
        const bmr = calculateBMR(currentData);
        console.log('BMR calculated:', bmr);
        
        const tdee = bmr * activityFactor(currentData.activity_level);
        console.log('TDEE calculated:', tdee);
        
        const dailyCalories = adjustCaloriesForGoal(tdee, currentData.goal);
        console.log('Daily calories calculated:', dailyCalories);
        
        const macros = calculateMacros(dailyCalories);
        console.log('Macros calculated:', macros);

        console.log('Calculated values:', { bmr, tdee, dailyCalories, macros });

        // Проверяем, что все значения корректны
        if (!dailyCalories || !macros.protein || !macros.fat || !macros.carbs ||
            isNaN(dailyCalories) || isNaN(macros.protein) || isNaN(macros.fat) || isNaN(macros.carbs)) {
          console.error('Invalid calculated values:', { dailyCalories, macros });
          throw new Error('Invalid calculated values');
        }

        console.log('Updating user in database...');
        // Обновляем все данные за один раз
        await userController.upsertUser({
          telegram_id: telegramId,
          age: currentData.age,
          gender: currentData.gender,
          weight: currentData.weight,
          height: currentData.height,
          activity: currentData.activity_level,
          goal: currentData.goal,
          daily_calories: dailyCalories,
          protein: macros.protein,
          fat: macros.fat,
          carbs: macros.carbs
        });

        console.log('User data updated successfully');
      } catch (calcError) {
        console.error('Error in calculation:', calcError);
        console.error('Error stack:', calcError.stack);
        throw calcError;
      }
    } else {
      console.log('No recalculation needed, updating data only...');
      // Обновляем только измененные данные без пересчета
      await userController.upsertUser({
        telegram_id: telegramId,
        age: user.age,
        gender: user.gender,
        weight: user.weight,
        height: user.height,
        activity: user.activity_level,
        goal: user.goal,
        daily_calories: user.daily_calories,
        protein: user.protein,
        fat: user.fat,
        carbs: user.carbs,
        ...updateData
      });
      console.log('Data updated without recalculation');
    }

    // Очищаем сессию
    ctx.session.updateField = null;
    ctx.session.waitingForUpdate = false;

    // Проверяем, действительно ли что-то изменилось
    const updatedUser = await userController.getUserByTelegramId(telegramId);
    
    // Сравниваем старые и новые значения (приводим к одному типу для корректного сравнения)
    let actualChanges = [];
    if (updateData.age && parseInt(updateData.age) !== parseInt(user.age)) actualChanges.push('возраст');
    if (updateData.gender && updateData.gender !== user.gender) actualChanges.push('пол');
    if (updateData.weight && parseFloat(updateData.weight) !== parseFloat(user.weight)) actualChanges.push('вес');
    if (updateData.height && parseInt(updateData.height) !== parseInt(user.height)) actualChanges.push('рост');
    if (updateData.activity_level && updateData.activity_level !== user.activity_level) actualChanges.push('уровень активности');
    if (updateData.goal && updateData.goal !== user.goal) actualChanges.push('цель');

    if (actualChanges.length > 0) {
      // Показываем обновленные данные только если что-то действительно изменилось
      const genderText = updatedUser?.gender ? (updatedUser.gender === 'M' ? 'Мужской' : 'Женский') : '—';
      const activityText = {
        'низкий': 'Низкий',
        'средний': 'Средний',
        'высокий': 'Высокий'
      }[updatedUser?.activity_level] || updatedUser?.activity_level || '—';

      const goalText = {
        'lose': 'Сброс веса',
        'maintain': 'Поддержание',
        'gain': 'Набор веса'
      }[updatedUser?.goal] || updatedUser?.goal || '—';

      await ctx.reply(
        `✅ ${actualChanges.join(', ')} успешно обновлен${actualChanges.length > 1 ? 'ы' : ''}!\n\n` +
        `📋 Обновленные данные:\n` +
        `👤 Возраст: ${updatedUser?.age ?? '—'} лет\n` +
        `👥 Пол: ${genderText}\n` +
        `⚖️ Вес: ${updatedUser?.weight ?? '—'} кг\n` +
        `📏 Рост: ${updatedUser?.height ?? '—'} см\n` +
        `🤸 Активность: ${activityText}\n` +
        `🥅 Цель: ${goalText}\n\n` +
        `📊 Новая норма калорий: ${updatedUser?.daily_calories ?? '—'} ккал\n` +
        `🥩 Белки: ${updatedUser?.protein ?? '—'} г | 🥑 Жиры: ${updatedUser?.fat ?? '—'} г | 🍞 Углеводы: ${updatedUser?.carbs ?? '—'} г`,
        { parse_mode: 'HTML' }
      );

      // Предлагаем сгенерировать новое меню
      await ctx.reply(
        '🔄 Хотите сгенерировать новое меню с учетом обновленных параметров?',
        {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Да, сгенерировать новое меню', callback_data: 'generate_new_menu' },
                { text: '❌ Нет, позже', callback_data: 'no_new_menu' }
              ]
            ]
          }
        }
      );
    } else {
      // Если ничего не изменилось, просто сообщаем об этом
      await ctx.reply(
        `ℹ️ ${fieldNames[field]} остался тем же. Никаких изменений не внесено.`,
        getMainMenuKeyboard()
      );
    }

  } catch (error) {
    console.error('Error updating user data:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Field:', field, 'Value:', value);
    console.error('Update data:', updateData);

    // Очищаем сессию при ошибке
    ctx.session.updateField = null;
    ctx.session.waitingForUpdate = false;

    let errorMessage = '❌ Произошла ошибка при обновлении данных. Попробуйте еще раз.';
    if (error.message === 'Missing required data for calculation') {
      errorMessage = '❌ Недостаточно данных для пересчета калорий. Попробуйте обновить все данные целиком.';
    } else if (error.message === 'Invalid calculated values') {
      errorMessage = '❌ Ошибка в расчете калорий. Попробуйте обновить все данные целиком.';
    }

    await ctx.reply(errorMessage, getMainMenuKeyboard());
  }
});

// Показать меню с кнопками дней (для повторного доступа)
bot.hears('Моё меню на неделю', validateUser, async (ctx) => {
  try {
    const telegramId = ctx.from.id;
    const user = await userController.getUserByTelegramId(telegramId);
    if (!user) {
      return ctx.reply('⚠️ Сначала выполните команду <code>/start</code> для ввода данных.', { parse_mode: 'HTML' });
    }

    // Получаем последнее меню пользователя
    const menuRes = await db.query(
      'SELECT id FROM menus WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',
      [user.id]
    );
    if (menuRes.rows.length === 0) {
      return ctx.reply('У вас пока нет сгенерированного меню. Используйте команду /menu для создания меню.');
    }
    const menuId = menuRes.rows[0].id;

    // Отправляем кнопки дней
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

    await ctx.reply(
      '📋 Ваше меню на неделю\n\nВыберите день, чтобы посмотреть блюда:',
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: dayButtons
        }
      }
    );
  } catch (error) {
    console.error('Error showing menu:', error);
    await ctx.reply('Произошла ошибка при получении меню.');
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
