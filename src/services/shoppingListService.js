const { askChatGPT } = require('../services/openaiService');

/**
 * Собирает все ингредиенты из массива meals,
 * формирует prompt и запрашивает ChatGPT для генерации списка покупок.
 */
async function generateShoppingListFromMeals(meals) {
  // 1) Собираем все ингредиенты
  const allIngredients = [];
  for (const meal of meals) {
    if (!meal.recipe) continue;

    let recipeData;
    try {
      // Если meal.recipe хранится в базе как TEXT, сделаем JSON.parse:
      recipeData = typeof meal.recipe === 'string'
        ? JSON.parse(meal.recipe)
        : meal.recipe;
    } catch {
      recipeData = { ingredients: [], steps: [], cookingTimeMinutes: 0 };
    }
    if (Array.isArray(recipeData.ingredients)) {
      // Добавляем все ингредиенты в общий список
      allIngredients.push(...recipeData.ingredients);
    }
  }

  // 2) Формируем prompt, просим ChatGPT вернуть список покупок в удобном формате (JSON или текст)
  const prompt = `
У меня есть список ингредиентов для недели:
${allIngredients.map((ing, i) => `${i + 1}. ${ing}`).join('\n')}

Сформируй список покупок, сгруппировав ингредиенты по категориям (мясо, рыба, овощи и т.д.). Сложи граммовки. Если ингридиенты называется по-разному, но это одно и то же, нужно скомпоновать.
Верни, пожалуйста, ТОЛЬКО валидный JSON в формате:
{
  "categories": [
    {
      "name": "Название категории",
      "items": [ "ингредиент 1", "ингредиент 2", ... ]
    },
    ...
  ]
}
Чтобы все было на русском языке, без пояснений и без дополнительного текста.`;

  // 3) Делаем запрос к ChatGPT
  let rawShopping = await askChatGPT([{ role: 'user', content: prompt }]);
  // Удаляем служебные строки (```json) если GPT их добавил
  rawShopping = rawShopping.replace(/```json/g, '').replace(/```/g, '');

  // 4) Пытаемся распарсить JSON
  let parsed;
  try {
    parsed = JSON.parse(rawShopping);
  } catch (err) {
    console.error('Ошибка парсинга JSON списка покупок от ChatGPT:', err);
    // Если парсинг провалился, fallback — возвращаем весь ответ как текст
    return rawShopping;
  }

  // 5) Формируем человекочитаемый текст из JSON
  if (!parsed.categories || !Array.isArray(parsed.categories)) {
    // Если почему-то нет "categories", вернём ответ целиком
    return rawShopping;
  }

  let finalText = '';
  for (const cat of parsed.categories) {
    if (!cat.items || cat.items.length === 0) continue;
    finalText += `*${cat.name}*\n`;
    for (const item of cat.items) {
      finalText += ` - ${item}\n`;
    }
    finalText += '\n';
  }

  return finalText.trim() || 'Список покупок пуст.';
}

module.exports = {
  generateShoppingListFromMeals
};