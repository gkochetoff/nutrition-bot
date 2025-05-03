const db = require('../services/db');
const { askChatGPT } = require('../services/openaiService');
const { generateShoppingListFromMeals } = require('../services/shoppingListService');

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

async function createWeeklyMenu(userId, dailyCalories, p, f, c, goal) {
    const prompt = `
  Составь меню на неделю (7 дней) для человека с суточной нормой ${dailyCalories} ккал 
  (белки: ${p} г, жиры: ${f} г, углеводы: ${c} г). 
  Калории, белки, жиры и углеводы для всех блюд на день должны находиться в диапазоне ${dailyCalories * 0.99} - ${dailyCalories * 1.01} ккал, ${p * 0.99} - ${p * 1.01} г белков, ${f * 0.99} - ${f * 1.01} г жиров, ${c * 0.99} - ${c * 1.01} г углеводов.
  Завтрак должен составлять 25% от суточной нормы (${dailyCalories * 0.25} ккал), обед – 40% (${dailyCalories * 0.4} ккал), ужин – 35% (${dailyCalories * 0.35} ккал).
  И блюда подобраны в соответствии с целью "${goal}".
  Распредели на 7 дней, в каждом дне 3 приёма пищи (завтрак, обед, ужин). 
  Нужно чтобы ингридиенты во всех блюдах можно было распределить на 7 дней в других блюдах. Чтобы не приходилось покупать на неделю разные продукты, которые пропадут.
  Для каждого блюда укажи поля:
    - mealTime (строка: 'breakfast', 'lunch', 'dinner')
    - name (название блюда)
    - calories (число)
    - protein (число)
    - fat (число)
    - carbs (число)
    - portionWeight (число, примерный вес порции в граммах)
  
  Верни ТОЛЬКО валидный JSON-объект такого формата:
  {
    "days": [
      {
        "dayNumber": 1,
        "meals": [ { ... }, { ... }, { ... } ]
      },
      ...
    ]
  }`;
  
    let rawJson = await askChatGPT([{ role: 'user', content: prompt }]);
    rawJson = rawJson.replace(/```json/g, '').replace(/```/g, '');
    let parsedMenu;
    try {
      parsedMenu = JSON.parse(rawJson); // Парсим JSON, который вернул ChatGPT
    } catch (err) {
      console.error('Ошибка парсинга JSON от ChatGPT:', err);
      throw new Error('Невалидный JSON от ChatGPT');
    }
  
    // Ожидаем, что parsedMenu.days — это массив { dayNumber, meals: [...] }
    if (!parsedMenu.days || !Array.isArray(parsedMenu.days)) {
      throw new Error('Отсутствует поле "days" в ответе ChatGPT');
    }
  
    // Сохраняем в таблицу menus
    const insertMenu = await db.query(
      `INSERT INTO menus (user_id, total_calories, days) VALUES ($1, $2, $3) RETURNING id`,
      [userId, dailyCalories, JSON.stringify(parsedMenu)] // можно сохранить JSON целиком
    );
    const menuId = insertMenu.rows[0].id;
  
    // Пробегаем по дням и блюдам, записываем в meals
    const savedMeals = [];
    for (const dayData of parsedMenu.days) {
      const day = dayData.dayNumber; // например, 1
      if (!Array.isArray(dayData.meals)) continue;
  
      for (const m of dayData.meals) {
        const res = await db.query(
          `INSERT INTO meals (
             menu_id, day, meal_time, name, 
             calories, protein, fat, carbs, portion_weight
           ) 
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [menuId, day, m.mealTime, m.name, m.calories, m.protein, m.fat, m.carbs, m.portionWeight]
        );
        savedMeals.push({
          id: res.rows[0].id,
          day,
          meal_time: m.mealTime,
          name: m.name,
          calories: m.calories,
          protein: m.protein,
          fat: m.fat,
          carbs: m.carbs,
          portion: m.portionWeight
        });
      }
    }
  
    // Генерируем рецепты (запросим тоже в JSON!)
    // Например, для каждого блюда попросим список ингредиентов (массив) и шаги приготовления (массив), время (число).
    for (const meal of savedMeals) {
      const recipePrompt = `
  Составь рецепт для блюда "${meal.name}" объемом ${meal.portion} г c калорийностью ${meal.calories} ккал, протеином ${meal.protein} г, жиром ${meal.fat} г и углеводами ${meal.carbs} г.
  Ккалории, белки, жиры и углеводы должны быть максимально приближены к этим числам. И блюда должны быть подобраны в соответствии с целью "${goal}".
  Верни ТОЛЬКО валидный JSON.
  Формат:
  {
    "ingredients": [ "String 1", "String 2", ... ],
    "steps": [ "Шаг 1...", "Шаг 2..." ],
    "cookingTimeMinutes": 30
  }`;
      let rawRecipeJson = await askChatGPT([{ role: 'user', content: recipePrompt }]);
      rawRecipeJson = rawRecipeJson.replace(/```json/g, '').replace(/```/g, '');
      let recipe;
      try {
        recipe = JSON.parse(rawRecipeJson);
      } catch (err) {
        console.error('Ошибка парсинга JSON рецепта:', err);
        recipe = {
          ingredients: [],
          steps: [],
          cookingTimeMinutes: 0
        };
      }
  
      // Сохраним как JSON в поле recipe
      await db.query(
        `UPDATE meals SET recipe = $1 WHERE id = $2`,
        [JSON.stringify(recipe), meal.id]
      );
      meal.recipe = recipe;
    }
  
    return { menuId, meals: savedMeals, rawMenuJson: parsedMenu };
}
  

async function getShoppingListFromMenu(meals) {
  // Функция объединяет рецепты и формирует список
  const shoppingList = await generateShoppingListFromMeals(meals);
  return shoppingList;
}

module.exports = {
  createWeeklyMenu,
  getShoppingListFromMenu
};
