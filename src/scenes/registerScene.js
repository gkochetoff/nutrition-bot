const { Scenes, Markup } = require('telegraf');
const userController = require('../controllers/userController');
const { 
  calculateBMR,
  activityFactor,
  adjustCaloriesForGoal,
  calculateMacros
} = require('../services/macrosService');

const registerScene = new Scenes.WizardScene(
  'registerScene',
  // 1. Возраст
  (ctx) => {
    ctx.reply('👤 Введите ваш возраст (полных лет):');
    ctx.wizard.state.data = {};
    return ctx.wizard.next();
  },
  // 2. Пол
  (ctx) => {
    const age = parseInt(ctx.message.text);
    if (isNaN(age) || age <= 0) {
      ctx.reply('Пожалуйста, введите корректное число (возраст).');
      return;
    }
    ctx.wizard.state.data.age = age;
    ctx.reply('👤 Выберите ваш пол:', Markup.keyboard([
      ['М', 'Ж']
    ]).resize().oneTime());
    return ctx.wizard.next();
  },
  // 3. Вес
  (ctx) => {
    const genderInput = ctx.message.text.trim().toLowerCase();
    if (!['м','ж','m','f','муж','жен'].some(g => genderInput.includes(g))) {
      ctx.reply('Пожалуйста, укажите "М" (муж) или "Ж" (жен).');
      return;
    }
    // Нормализуем до 'M' / 'F' для соответствия колонке БД gender VARCHAR(2)
    const gender = (genderInput.includes('м')) || (genderInput.startsWith('m')) || (genderInput.includes('муж'))
      ? 'M'
      : 'F';
    ctx.wizard.state.data.gender = gender;
    ctx.reply('⚖️ Ваш вес (кг):', Markup.removeKeyboard());
    return ctx.wizard.next();
  },
  // 4. Рост
  (ctx) => {
    const weight = parseFloat(ctx.message.text.replace(',', '.'));
    if (isNaN(weight) || weight <= 0) {
      ctx.reply('Введите корректный вес (число).');
      return;
    }
    ctx.wizard.state.data.weight = weight;
    ctx.reply('📏 Ваш рост (см):');
    return ctx.wizard.next();
  },
  // 5. Уровень активности
  (ctx) => {
    const height = parseInt(ctx.message.text);
    if (isNaN(height) || height <= 0) {
      ctx.reply('Введите корректный рост (см, число).');
      return;
    }
    ctx.wizard.state.data.height = height;
    ctx.reply('🤸 Укажите уровень физической активности:', Markup.keyboard([
      ['низкий', 'средний', 'высокий']
    ]).resize().oneTime());
    return ctx.wizard.next();
  },
  // 6. Цель
  (ctx) => {
    const activity = ctx.message.text.toLowerCase();
    if (!['низкий','средний','высокий'].includes(activity)) {
      ctx.reply('Укажите: низкий, средний или высокий.');
      return;
    }
    ctx.wizard.state.data.activity = activity;
    ctx.reply('🥅 Ваша цель:', Markup.keyboard([
      ['сброс веса', 'поддержание', 'набор веса']
    ]).resize().oneTime());
    return ctx.wizard.next();
  },
  // 7. Завершение
  async (ctx) => {
    const goalInput = ctx.message.text.toLowerCase();
    let goal = 'maintain';
    if (goalInput.includes('сброс')) goal = 'lose';
    else if (goalInput.includes('набор')) goal = 'gain';

    ctx.wizard.state.data.goal = goal;

    const { age, gender, weight, height, activity } = ctx.wizard.state.data;
    // Расчёт BMR
    const bmr = calculateBMR({ weight, height, age, gender });
    const tdee = bmr * activityFactor(activity);
    const dailyCalories = adjustCaloriesForGoal(tdee, goal);
    const macros = calculateMacros(dailyCalories);

    // Сохраняем в БД
    const telegramId = ctx.from.id;
    await userController.upsertUser({
      telegram_id: telegramId,
      age,
      gender,
      weight,
      height,
      activity,
      goal,
      daily_calories: dailyCalories,
      protein: macros.protein,
      fat: macros.fat,
      carbs: macros.carbs
    });

    // Отправляем результат
    ctx.reply(
      `✅ Данные успешно сохранены!\n\n` +
      `📊 Ваша суточная норма:\n` +
      `• Калории: <b>${dailyCalories} ккал</b>\n` +
      `• Белки: <b>${macros.protein} г</b>\n` +
      `• Жиры: <b>${macros.fat} г</b>\n` +
      `• Углеводы: <b>${macros.carbs} г</b>\n\n` +
      `🍽️ Теперь используйте команду /menu для генерации персонального меню на неделю!`
    , { parse_mode: 'HTML' }, Markup.removeKeyboard());

    return ctx.scene.leave();
  }
);

module.exports = registerScene;
