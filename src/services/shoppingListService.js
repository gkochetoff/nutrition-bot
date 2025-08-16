const { askChatGPT } = require('../services/openaiService');
const escapeHtml = require('../utils/escapeHtml');
const escapeMd = require('../utils/escapeMarkdown');

/**
 * Собирает все ингредиенты из массива meals,
 * формирует prompt и запрашивает ChatGPT для генерации списка покупок.
 */
async function generateShoppingListFromMeals(meals) {
    console.log('Generating shopping list from', meals.length, 'meals');
    
    // 1) Собираем все ингредиенты
    const allIngredients = [];
    for (const meal of meals) {
        if (!meal.recipe) {
            console.log('No recipe found for meal:', meal.name);
            continue;
        }

        let recipeData;
        try {
            // Если meal.recipe хранится в базе как TEXT, сделаем JSON.parse:
            recipeData = typeof meal.recipe === 'string'
                ? JSON.parse(meal.recipe)
                : meal.recipe;
            console.log('Successfully parsed recipe for meal:', meal.name);
        } catch (err) {
            console.error('Error parsing recipe for meal:', meal.name, err);
            recipeData = { ingredients: [], steps: [], cookingTimeMinutes: 0 };
        }

        if (Array.isArray(recipeData.ingredients)) {
            // Добавляем все ингредиенты в общий список
            allIngredients.push(...recipeData.ingredients);
            console.log('Added', recipeData.ingredients.length, 'ingredients from meal:', meal.name);
        } else {
            console.log('No ingredients array found in recipe for meal:', meal.name);
        }
    }

    if (allIngredients.length === 0) {
        console.log('No ingredients found in any meals');
        return 'Список покупок пуст. Нет доступных ингредиентов.';
    }

    console.log('Total ingredients collected:', allIngredients.length);

    // 2) Формируем prompt, просим ChatGPT вернуть список покупок в удобном формате (JSON или текст)
    const prompt = `Сгруппируй и суммируй ингредиенты по категориям. Верни ТОЛЬКО JSON:
{"categories":[{"name":"Категория","items":["наименование и количество"]}]}
Ингредиенты (каждый пункт отдельно):\n${allIngredients.map((ing, i) => `${i + 1}. ${ing}`).join('\n')}`;

    // 3) Делаем запрос к ChatGPT
    console.log('Sending request to ChatGPT for shopping list generation');
    const system = { role: 'system', content: 'Ты отвечаешь только валидным JSON без текста до и после.' };
    let rawShopping = await askChatGPT([system, { role: 'user', content: prompt }], { json: true, temperature: 0.2, max_tokens: 700 });

    // 4) Пытаемся распарсить JSON
    let parsed;
    try {
        parsed = JSON.parse(rawShopping);
        console.log('Successfully parsed shopping list JSON');
    } catch (err) {
        console.error('Error parsing shopping list JSON:', err);
        // Если парсинг провалился, fallback — возвращаем весь ответ как текст
        return rawShopping;
    }

    // 5) Формируем человекочитаемый текст из JSON
    if (!parsed.categories || !Array.isArray(parsed.categories)) {
        console.log('Invalid shopping list format: missing or invalid categories');
        // Если почему-то нет "categories", вернём ответ целиком
        return rawShopping;
    }

    let finalText = '';
    for (const cat of parsed.categories) {
        if (!cat.items || cat.items.length === 0) continue;
        finalText += `<b>${escapeHtml(String(cat.name))}</b>\n`;
        for (const item of cat.items) {
            finalText += ` - ${escapeHtml(String(item))}\n`;
        }
        finalText += '\n';
    }

    const result = finalText.trim() || 'Список покупок пуст.';
    console.log('Generated shopping list with', parsed.categories.length, 'categories');
    return result;
}

module.exports = {
    generateShoppingListFromMeals
};