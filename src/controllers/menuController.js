const db = require('../services/db');
const { askChatGPT } = require('../services/openaiService');
const { generateShoppingListFromMeals } = require('../services/shoppingListService');
const NodeCache = require('node-cache');

const JSON5 = require('json5');

// Simple concurrency limiter without external deps
async function withConcurrencyLimit(items, concurrency, iteratorFn) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) return;
      results[current] = await iteratorFn(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// Cache for storing generated menus (TTL: 1 hour)
const menuCache = new NodeCache({ stdTTL: 3600 });

// Cache for storing recipes (TTL: 24 hours)
const recipeCache = new NodeCache({ stdTTL: 86400 });

/**
  Пример структуры, которую мы хотим от ChatGPT (на русском, но в формате JSON):
  {
    "days": [
      {
        "dayNumber": 1,
        "meals": [
          {
            "mealTime": "breakfast",
            "name": "Овсянка с бананом",
            "calories": 350,
            "protein": 15,
            "fat": 10,
            "carbs": 50,
            "portionWeight": 200
          },
          ...
        ]
      },
      ...
    ]
  }
*/

/**
 * Validates the menu structure returned by ChatGPT
 */
function validateMenuStructure(menu) {
  if (!menu.days || !Array.isArray(menu.days)) {
    throw new Error('Invalid menu structure: missing or invalid days array');
  }

  for (const day of menu.days) {
    if (!day.dayNumber || !day.meals || !Array.isArray(day.meals)) {
      throw new Error(`Invalid day structure in menu: ${JSON.stringify(day)}`);
    }

    for (const meal of day.meals) {
      const requiredFields = ['mealTime', 'name', 'calories', 'protein', 'fat', 'carbs', 'portionWeight'];
      for (const field of requiredFields) {
        if (!(field in meal)) {
          throw new Error(`Missing required field ${field} in meal: ${JSON.stringify(meal)}`);
        }
      }
    }
  }
}

/**
 * Generates a menu prompt for ChatGPT
 */
function generateMenuPrompt(dailyCalories, p, f, c, goal) {
  const dc = Math.round(dailyCalories);
  const ranges = {
    kcalMin: Math.round(dc * 0.97),
    kcalMax: Math.round(dc * 1.03),
    pMin: Math.round(p * 0.95),
    pMax: Math.round(p * 1.05),
    fMin: Math.round(f * 0.95),
    fMax: Math.round(f * 1.05),
    cMin: Math.round(c * 0.95),
    cMax: Math.round(c * 1.05)
  };
  return `Составь недельное меню (7 дней) для цели "${goal}" с нормой ${dc} ккал/день и макросами (Б:${p}г, Ж:${f}г, У:${c}г).
Каждый день: 3 приёма пищи (breakfast, lunch, dinner). Дневные суммы в пределах: ${ranges.kcalMin}-${ranges.kcalMax} ккал, Б:${ranges.pMin}-${ranges.pMax}, Ж:${ranges.fMin}-${ranges.fMax}, У:${ranges.cMin}-${ranges.cMax}.
Продукты повторяй между днями для экономии.
Для каждого блюда укажи: mealTime, name, calories, protein, fat, carbs, portionWeight (гр).
Верни ТОЛЬКО валидный JSON:
{"days":[{"dayNumber":1,"meals":[{"mealTime":"breakfast","name":"...","calories":0,"protein":0,"fat":0,"carbs":0,"portionWeight":0},{"mealTime":"lunch","name":"...","calories":0,"protein":0,"fat":0,"carbs":0,"portionWeight":0},{"mealTime":"dinner","name":"...","calories":0,"protein":0,"fat":0,"carbs":0,"portionWeight":0}]},{"dayNumber":2,"meals":[...]},...,{"dayNumber":7,"meals":[...]}]}`;
}

function generateDayMenuPrompt(dailyCalories, p, f, c, goal, dayNumber) {
  const dc = Math.round(dailyCalories);
  const ranges = {
    kcalMin: Math.round(dc * 0.97),
    kcalMax: Math.round(dc * 1.03),
    pMin: Math.round(p * 0.95),
    pMax: Math.round(p * 1.05),
    fMin: Math.round(f * 0.95),
    fMax: Math.round(f * 1.05),
    cMin: Math.round(c * 0.95),
    cMax: Math.round(c * 1.05)
  };
  return `Составь меню на один день №${dayNumber} (ровно 3 блюда: breakfast, lunch, dinner) для цели "${goal}". Норма дня ${dc} ккал/день и макросы (Б:${p}г, Ж:${f}г, У:${c}г).
Суммы за день в пределах: ${ranges.kcalMin}-${ranges.kcalMax} ккал; Б:${ranges.pMin}-${ranges.pMax}; Ж:${ranges.fMin}-${ranges.fMax}; У:${ranges.cMin}-${ranges.cMax}.
Верни ТОЛЬКО валидный JSON:
{"dayNumber":${dayNumber},"meals":[{"mealTime":"breakfast","name":"...","calories":0,"protein":0,"fat":0,"carbs":0,"portionWeight":0},{"mealTime":"lunch","name":"...","calories":0,"protein":0,"fat":0,"carbs":0,"portionWeight":0},{"mealTime":"dinner","name":"...","calories":0,"protein":0,"fat":0,"carbs":0,"portionWeight":0}]}`;
}

function validateDayMenuStructure(dayMenu) {
  if (!dayMenu || typeof dayMenu !== 'object') {
    throw new Error('Invalid day menu: not an object');
  }
  if (!dayMenu.dayNumber || !Array.isArray(dayMenu.meals) || dayMenu.meals.length !== 3) {
    throw new Error('Invalid day menu: dayNumber or meals');
  }
  for (const meal of dayMenu.meals) {
    const requiredFields = ['mealTime', 'name', 'calories', 'protein', 'fat', 'carbs', 'portionWeight'];
    for (const field of requiredFields) {
      if (!(field in meal)) {
        throw new Error(`Day menu: missing field ${field} in meal`);
      }
    }
  }
}

/**
 * Parses the menu JSON from ChatGPT response
 */
async function parseMenuJson(rawJson) {
  if (!rawJson || typeof rawJson !== 'string') {
    throw new Error('Failed to parse menu JSON: empty response');
  }

  let cleaned = rawJson
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  // Try direct JSON parse
  try {
    return JSON.parse(cleaned);
  } catch {}

  // Try JSON5 parse
  try {
    return JSON5.parse(cleaned);
  } catch {}

  // Extract top-level JSON object by brace matching
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    const candidate = cleaned.slice(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch {}
    try {
      return JSON5.parse(candidate);
    } catch {}
  }

  // Final attempt: strip non-ASCII quotes and repair common issues
  const normalized = cleaned
    .replace(/[“”«»]/g, '"')
    .replace(/[’‘]/g, "'")
    .replace(/\,(\s*[\}\]])/g, '$1'); // trailing commas

  try {
    return JSON.parse(normalized);
  } catch {}
  try {
    return JSON5.parse(normalized);
  } catch (e) {
    throw new Error('Failed to parse menu JSON: ' + e.message);
  }
}

/**
 * Saves menu and meals to database
 */
async function saveMenuToDatabase(userId, dailyCalories, parsedMenu) {
  const client = await db.pool.connect();
  let savedMeals = [];
  let menuId;

  try {
    await client.query('BEGIN');

    let menuRes;
    try {
      menuRes = await client.query(
        'INSERT INTO menus (user_id, total_calories, days) VALUES ($1,$2,$3::jsonb) RETURNING id',
        [userId, dailyCalories, JSON.stringify(parsedMenu)]
      );
    } catch (e) {
      // Fallback for older schema where days is TEXT
      menuRes = await client.query(
        'INSERT INTO menus (user_id, total_calories, days) VALUES ($1,$2,$3) RETURNING id',
        [userId, dailyCalories, JSON.stringify(parsedMenu)]
      );
    }
    menuId = menuRes.rows[0].id;

    const values = [];
    const placeholders = [];
    let idx = 1;

    for (const dayData of parsedMenu.days) {
      const day = dayData.dayNumber;
      for (const m of dayData.meals ?? []) {
        values.push(
          menuId, day, m.mealTime, m.name,
          m.calories, m.protein, m.fat, m.carbs, m.portionWeight
        );
        placeholders.push(
          `($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++})`
        );
      }
    }

    const mealInsert = await client.query(
      `INSERT INTO meals (
         menu_id, day, meal_time, name,
         calories, protein, fat, carbs, portion_weight
       ) VALUES ${placeholders.join(',')}
       RETURNING id, day, meal_time, name, calories, protein, fat, carbs, portion_weight`,
      values
    );

    savedMeals = mealInsert.rows.map(r => ({
      id: r.id,
      day: r.day,
      meal_time: r.meal_time,
      name: r.name,
      calories: r.calories,
      protein: r.protein,
      fat: r.fat,
      carbs: r.carbs,
      portion: r.portion_weight
    }));

    await client.query('COMMIT');
    return { menuId, savedMeals };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Generates recipe for a meal
 */
async function generateRecipe(meal, goal) {
  const cacheKey = `recipe_${meal.name}_${meal.calories}`;
  const cachedRecipe = recipeCache.get(cacheKey);
  if (cachedRecipe) {
    console.log('Using cached recipe for:', meal.name);
    return cachedRecipe;
  }

  console.log('Generating new recipe for:', meal.name);
  const recipePrompt = `Составь короткий рецепт для «${meal.name}» (~${meal.portion} г) с макросами близко к: Ккал ${meal.calories}, Б ${meal.protein}, Ж ${meal.fat}, У ${meal.carbs}. Цель: ${goal}.
Верни ТОЛЬКО JSON без пояснений:
{"ingredients":["..."],"steps":["..."],"cookingTimeMinutes":0}`;

  try {
    const system = { role: 'system', content: 'Ты отвечаешь только валидным JSON без текста до и после.' };
    let raw = await askChatGPT([system, { role: 'user', content: recipePrompt }], { temperature: 0.3, json: true, max_tokens: 400 });
    raw = raw.replace(/```json|```/g, '').trim();

    let recipe;
    try {
      recipe = JSON.parse(raw);
    } catch {
      try {
        recipe = JSON5.parse(raw);
      } catch (e) {
        console.error('Failed to parse recipe JSON:', e);
        recipe = { ingredients: [], steps: [], cookingTimeMinutes: 0 };
      }
    }

    // Проверяем структуру рецепта
    if (!recipe.ingredients || !Array.isArray(recipe.ingredients)) {
      recipe.ingredients = [];
    }
    if (!recipe.steps || !Array.isArray(recipe.steps)) {
      recipe.steps = [];
    }
    if (typeof recipe.cookingTimeMinutes !== 'number') {
      recipe.cookingTimeMinutes = 0;
    }

    console.log('Successfully generated recipe for:', meal.name);
    recipeCache.set(cacheKey, recipe);
    return recipe;
  } catch (error) {
    console.error('Error generating recipe:', error);
    return { ingredients: [], steps: [], cookingTimeMinutes: 0 };
  }
}

async function createWeeklyMenu(userId, dailyCalories, p, f, c, goal) {
  const cacheKey = `menu_${userId}_${dailyCalories}_${p}_${f}_${c}_${goal}`;
  const cachedMenu = menuCache.get(cacheKey);
  if (cachedMenu) {
    return cachedMenu;
  }

  // Генерируем по одному дню, чтобы повысить стабильность JSON и сократить латентность
  const system = { role: 'system', content: 'Ты отвечаешь только валидным JSON без текста до и после.' };
  const days = [];
  for (let day = 1; day <= 7; day++) {
    const dayPrompt = generateDayMenuPrompt(dailyCalories, p, f, c, goal, day);
    const rawDay = await askChatGPT([system, { role: 'user', content: dayPrompt }], { temperature: 0.2, json: true, max_tokens: 450 });
    const parsedDay = await parseMenuJson(rawDay);
    validateDayMenuStructure(parsedDay);
    days.push(parsedDay);
  }

  const parsedMenu = { days };
  validateMenuStructure(parsedMenu);

  const { menuId, savedMeals } = await saveMenuToDatabase(userId, dailyCalories, parsedMenu);

  // Generate recipes in parallel with rate limiting
  // Генерацию рецептов запускаем в фоне, чтобы быстрее отправить меню
  (async () => {
    try {
      await withConcurrencyLimit(savedMeals, 3, async (meal) => {
        const recipe = await generateRecipe(meal, goal);
        meal.recipe = recipe;
        try {
          await db.query(
            'UPDATE meals SET recipe = $1::jsonb WHERE id = $2',
            [JSON.stringify(recipe), meal.id]
          );
        } catch (e) {
          await db.query(
            'UPDATE meals SET recipe = $1 WHERE id = $2',
            [JSON.stringify(recipe), meal.id]
          );
        }
      });
    } catch (e) {
      console.error('Background recipe generation failed:', e);
    }
  })();

  const result = { menuId, meals: savedMeals, rawMenuJson: parsedMenu };
  menuCache.set(cacheKey, result);
  return result;
}

async function getShoppingListFromMenu(meals) {
  const shoppingList = await generateShoppingListFromMeals(meals);
  return shoppingList;
}

async function generateShoppingList(recipes) {
  console.log('Generating shopping list for recipes:', recipes.map(r => r.name).join(', '));
  
  const ingredients = recipes.flatMap(recipe => recipe.ingredients || []);
  if (!ingredients.length) {
    console.log('No ingredients found in recipes');
    return [];
  }

  const shoppingListPrompt = `
Создай оптимизированный список покупок на основе следующих ингредиентов.
Строго следуй этим правилам:

1. Группируй похожие ингредиенты и суммируй их количество:
   - "100 г моркови" + "50 г моркови" = "150 г моркови"
   - "1 зубчик чеснока" + "1 зубчик чеснока" = "2 зубчика чеснока"

2. Приводи все к стандартным единицам измерения:
   - Объем: мл, л
   - Вес: г, кг
   - Штуки: шт
   - Приправы: ч.л., ст.л.

3. Объединяй похожие приправы и масла:
   - "1 ч.л. оливкового масла" + "1 ст.л. оливкового масла" = "25 мл оливкового масла"
   - "соль по вкусу" + "1 г соли" = "соль по вкусу"

4. Группируй ингредиенты по категориям:
   - Мясо и рыба
   - Овощи
   - Фрукты
   - Зерновые
   - Молочные продукты
   - Орехи и семена
   - Приправы и масла
   - Яйца
   - Напитки
   - Дополнительно

5. Удаляй дубликаты и объединяй похожие формулировки:
   - "ягоды (малина)" + "ягоды (черника)" = "ягоды (малина, черника)"
   - "перец по вкусу" + "черный перец" = "перец по вкусу"

Ингредиенты:
${ingredients.join('\n')}

Верни ТОЛЬКО валидный JSON массив строк, где каждая строка - это ингредиент с общим количеством:
[ "150 г моркови", "2 зубчика чеснока", ... ]`;

  try {
    let raw = await askChatGPT([{ role: 'user', content: shoppingListPrompt }]);
    raw = raw.replace(/```json|```/g, '').trim();

    let shoppingList;
    try {
      shoppingList = JSON.parse(raw);
    } catch {
      try {
        shoppingList = JSON5.parse(raw);
      } catch (e) {
        console.error('Failed to parse shopping list JSON:', e);
        return [];
      }
    }

    // Проверяем структуру списка
    if (!Array.isArray(shoppingList)) {
      console.error('Shopping list is not an array');
      return [];
    }

    // Фильтруем пустые строки
    shoppingList = shoppingList
      .filter(item => typeof item === 'string' && item.trim().length > 0)
      .map(item => item.trim());

    console.log('Successfully generated shopping list with', shoppingList.length, 'items');
    return shoppingList;
  } catch (error) {
    console.error('Error generating shopping list:', error);
    return [];
  }
}

async function handleMealSelection(ctx, meal) {
  console.log('Handling meal selection:', meal.name);
  
  try {
    const recipe = await generateRecipe(meal, ctx.session.goal);
    if (!recipe || !recipe.ingredients || !recipe.steps) {
      console.error('Invalid recipe generated for:', meal.name);
      await ctx.reply('Извините, не удалось сгенерировать рецепт. Попробуйте выбрать другое блюдо.');
      return;
    }

    const recipeText = formatRecipe(recipe);
    await ctx.reply(recipeText);

    // Обновляем список покупок
    const currentList = ctx.session.shoppingList || [];
    const newIngredients = recipe.ingredients.filter(ing => !currentList.includes(ing));
    
    if (newIngredients.length > 0) {
      ctx.session.shoppingList = [...currentList, ...newIngredients];
      await ctx.reply('Список покупок обновлен!');
    }

    // Сохраняем выбранное блюдо
    if (!ctx.session.selectedMeals) {
      ctx.session.selectedMeals = [];
    }
    ctx.session.selectedMeals.push(meal);

    console.log('Successfully handled meal selection for:', meal.name);
  } catch (error) {
    console.error('Error handling meal selection:', error);
    await ctx.reply('Произошла ошибка при обработке выбранного блюда. Попробуйте еще раз.');
  }
}

function formatRecipe(recipe) {
  if (!recipe || !recipe.ingredients || !recipe.steps) {
    return 'Рецепт недоступен';
  }

  const ingredients = recipe.ingredients
    .map((ing, i) => `${i + 1}. ${ing.replace(/\\/g, '')}`)
    .join('\n');
  
  const steps = recipe.steps
    .map((step, i) => `${i + 1}. ${step.replace(/\\/g, '')}`)
    .join('\n');
  
  const time = recipe.cookingTimeMinutes || 0;

  return `📝 Рецепт:\n\nИнгредиенты:\n${ingredients}\n\nШаги приготовления:\n${steps}\n\n⏱ Время приготовления: ${time} минут`;
}

module.exports = {
  createWeeklyMenu,
  getShoppingListFromMenu
};
