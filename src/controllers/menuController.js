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

function generateDayMenuPrompt(
  dailyCalories,
  p,
  f,
  c,
  goal,
  dayNumber,
  blockedNames = [],
  usedProteinSources = [],
  usedCarbSources = [],
  usedFiberSources = [],
  caps = { protein: 5, carbs: 3, fiber: 5 }
) {
  const dc = Math.round(dailyCalories);
  const ranges = {
    kcalMin: Math.round(dc * 0.99),
    kcalMax: Math.round(dc * 1.01),
    pMin: Math.round(p * 0.97),
    pMax: Math.round(p * 1.03),
    fMin: Math.round(f * 0.97),
    fMax: Math.round(f * 1.03),
    cMin: Math.round(c * 0.97),
    cMax: Math.round(c * 1.03)
  };
  const kcalB = Math.round(dc * 0.25);
  const kcalL = Math.round(dc * 0.40);
  const kcalD = Math.round(dc * 0.35);
  const kcalBand = (n) => `${Math.round(n*0.97)}-${Math.round(n*1.03)}`;
  const repetitionRule = 'Название каждого блюда может повторяться не более 2 раз за неделю.';
  const avoidList = blockedNames.length ? `Не используй названия блюд из этого списка (исчерпан лимит повторов): ${blockedNames.join('; ')}.` : '';
  return `Составь меню на один день №${dayNumber} (ровно 3 блюда: breakfast, lunch, dinner) для цели "${goal}".
Точное соответствие целям:
- Сумма калорий за день строго в пределах ${ranges.kcalMin}-${ranges.kcalMax} ккал (норма дня ${dc}).
- Суммы макросов за день: Б:${ranges.pMin}-${ranges.pMax}, Ж:${ranges.fMin}-${ranges.fMax}, У:${ranges.cMin}-${ranges.cMax} (в граммах).
- Распределение калорий по приёмам пищи: breakfast ~${kcalB} ккал (допуск ${kcalBand(kcalB)}), lunch ~${kcalL} ккал (допуск ${kcalBand(kcalL)}), dinner ~${kcalD} ккал (допуск ${kcalBand(kcalD)}).
Если суммы выходят за пределы, отрегулируй portionWeight и состав блюд, чтобы попасть в коридоры.
Разнообразие:
- ${repetitionRule} ${avoidList}
- Чередуй источники белка (птица, рыба, яйца/творог, бобовые) и углеводы (овсянка, рис/киноа/гречка/картофель/паста).
- Избегай одинаковых баз (например, овсянка) два дня подряд на завтрак.
Ограничение источников на неделю (уникальные названия):
- белковые источники: не более ${caps.protein}
- углеводные источники: не более ${caps.carbs}
- клетчатка/овощи/фрукты: не более ${caps.fiber}
Уже использованные источники (предпочитай их, не вводи новые, если не требуется):
- proteinSourcesUsed: ${usedProteinSources.join(', ') || '—'}
- carbSourcesUsed: ${usedCarbSources.join(', ') || '—'}
- fiberSourcesUsed: ${usedFiberSources.join(', ') || '—'}
Если лимит уже исчерпан, используй только из списка уже использованных.
Верни ТОЛЬКО валидный JSON:
{"dayNumber":${dayNumber},"meals":[{"mealTime":"breakfast","name":"...","calories":0,"protein":0,"fat":0,"carbs":0,"portionWeight":0,"proteinSource":"...","carbSource":"...","fiberSource":"..."},{"mealTime":"lunch","name":"...","calories":0,"protein":0,"fat":0,"carbs":0,"portionWeight":0,"proteinSource":"...","carbSource":"...","fiberSource":"..."},{"mealTime":"dinner","name":"...","calories":0,"protein":0,"fat":0,"carbs":0,"portionWeight":0,"proteinSource":"...","carbSource":"...","fiberSource":"..."}]}`;
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
function parseMenuJson(rawJson) {
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
  const nameCounts = new Map();
  const proteinSources = new Map();
  const carbSources = new Map();
  const fiberSources = new Map();
  for (let day = 1; day <= 7; day++) {
    // Блокируем названия, которые уже использованы 2 раза и более
    const blocked = Array.from(nameCounts.entries()).filter(([_, cnt]) => cnt >= 2).map(([name]) => name);
    const usedProt = Array.from(proteinSources.keys());
    const usedCarb = Array.from(carbSources.keys());
    const usedFiber = Array.from(fiberSources.keys());
    const dayPrompt = generateDayMenuPrompt(
      dailyCalories,
      p,
      f,
      c,
      goal,
      day,
      blocked,
      usedProt,
      usedCarb,
      usedFiber,
      { protein: 5, carbs: 3, fiber: 5 }
    );
    const rawDay = await askChatGPT([system, { role: 'user', content: dayPrompt }], { temperature: 0.2, json: true, max_tokens: 450 });
    const parsedDay = parseMenuJson(rawDay);
    validateDayMenuStructure(parsedDay);
    days.push(parsedDay);
    for (const m of parsedDay.meals) {
      if (m && m.name) nameCounts.set(m.name, (nameCounts.get(m.name) || 0) + 1);
      if (m && m.proteinSource) proteinSources.set(m.proteinSource, (proteinSources.get(m.proteinSource) || 0) + 1);
      if (m && m.carbSource) carbSources.set(m.carbSource, (carbSources.get(m.carbSource) || 0) + 1);
      if (m && m.fiberSource) fiberSources.set(m.fiberSource, (fiberSources.get(m.fiberSource) || 0) + 1);
    }
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

module.exports = {
  createWeeklyMenu,
  getShoppingListFromMenu
};
