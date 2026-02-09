const escapeHtml = require('../utils/escapeHtml');

// Утилиты нормализации текста
function preprocessRaw(text) {
    return String(text)
        .replace(/\s+/g, ' ')
        .replace(/\(по желанию\)/gi, '')
        .replace(/по желанию/gi, '')
        .replace(/по вкусу/gi, '')
        .replace(/\s*\(.*?\)/g, '') // убираем скобочные уточнения
        .replace(/ст\.?\s*л\.?/gi, 'ст.л.')
        .replace(/ч\.?\s*л\.?/gi, 'ч.л.')
        .replace(/ожка/gi, 'ложка')
        .replace(/ожки/gi, 'ложки')
        .replace(/ложка/gi, 'ст.л.')
        .replace(/ложки/gi, 'ст.л.')
        .replace(/столовая лложка/gi, 'ст.л.')
        .replace(/столовая лложки/gi, 'ст.л.')
        .replace(/чайная лложка/gi, 'ч.л.')
        .replace(/чайная лложки/gi, 'ч.л.')
        .trim();
}

function parseFraction(str) {
    // Преобразует 1/2, 3/4 в десятичное число
    const m = str.match(/^(\d+)\s*\/\s*(\d+)$/);
    if (!m) return null;
    const num = parseFloat(m[1]);
    const den = parseFloat(m[2]);
    if (!den) return null;
    return num / den;
}

function normalizeName(name) {
    let n = name.toLowerCase().trim();
    
    // Убираем лишние слова
    n = n.replace(/\b(свежий|свежая|свежее|свежие|отварной|отварная|отварное|отварные|запеченный|запеченная|запеченное|запеченные|консервированный|консервированная|консервированное|консервированные)\b/g, '');
    n = n.replace(/\b(для посыпки|для подачи|или кленового сиропа)\b/g, '');
    
    // Синонимы и унификация
    n = n.replace(/куриное?\s+филе|курин[а-я]*\s+грудк[а-я]*/g, 'куриная грудка');
    n = n.replace(/филе\s+индейк[а-я]*/g, 'филе индейки');
    n = n.replace(/филе\s+треск[а-я]*/g, 'филе трески');
    n = n.replace(/лосос[а-я]*/g, 'филе лосося');
    n = n.replace(/тунец.*консерв/i, 'тунец консервированный');
    n = n.replace(/рыб[а-я]*/g, 'рыба');
    n = n.replace(/филе\s+белой\s+рыб[а-я]*/g, 'рыба');
    n = n.replace(/филе\s+рыб[а-я]*/g, 'рыба');
    
    n = n.replace(/овсян[а-я]*\s+хлопь[а-я]*/g, 'овсяные хлопья');
    n = n.replace(/кин[оа]а/gi, 'киноа');
    n = n.replace(/гречк[а-я]*/g, 'гречка');
    n = n.replace(/картофел[а-я]*/g, 'картофель');
    n = n.replace(/помидор[а-я]*\s*черри/g, 'помидоры черри');
    n = n.replace(/помидор[а-я]*/g, 'помидоры');
    n = n.replace(/шпинат[а-я]*/g, 'шпинат');
    n = n.replace(/брокколи[а-я]*/g, 'брокколи');
    n = n.replace(/лук\s+красн[а-я]*/g, 'лук красный');
    n = n.replace(/лук[а-я]*/g, 'лук');
    n = n.replace(/огурц[а-я]*/g, 'огурец');
    n = n.replace(/чеснок[а-я]*/g, 'чеснок');
    n = n.replace(/морков[а-я]*/g, 'морковь');
    n = n.replace(/^овощи.*$/g, 'овощи смешанные');
    n = n.replace(/соль.*перец.*/g, 'соль и перец');
    n = n.replace(/лимонный сок|сок\s+лимон[а-я]*/g, 'лимон');
    n = n.replace(/ягод[а-я]*/g, 'ягоды');
    n = n.replace(/свежих\s+ягод/g, 'ягоды');
    n = n.replace(/яйц[ао]?/g, 'яйца');
    n = n.replace(/творог[а-я]*/g, 'творог');
    n = n.replace(/йогурт[а-я]*/g, 'йогурт');
    n = n.replace(/оливков[а-я]*\s+масл[а-я]*/g, 'оливковое масло');
    n = n.replace(/мед|мёд/gi, 'мед');
    n = n.replace(/кленового сиропа/g, 'кленовый сироп');
    n = n.replace(/кориц[а-я]*/g, 'корица');
    n = n.replace(/орех[а-я]*/g, 'орехи');
    n = n.replace(/миндал[а-я]*/g, 'миндаль');
    
    return n.trim();
}

// Обработка ингредиентов: нормализация и агрегация
function normalizeIngredient(ingredient) {
    const raw = preprocessRaw(ingredient);
    
    // Обработка дробей типа 1/2
    const fractionOnly = parseFraction(raw);
    if (fractionOnly !== null) {
        return { amount: fractionOnly, unit: 'шт', name: 'единица' };
    }
    
    // Извлекаем количество и единицы
    const match = raw.match(/^(\d+(?:[\.,]\d+)?|\d+\/\d+)\s*(г|кг|мл|л|ст\.л\.|ч\.л\.|шт|зубч)?\s*(.+)$/i);
    if (match) {
        let [, amountStr, unitRaw, name] = match;
        let amount = parseFloat(amountStr.replace(',', '.'));
        if (isNaN(amount)) {
            const frac = parseFraction(amountStr);
            amount = frac !== null ? frac : 0;
        }
        let unit = (unitRaw || '').toLowerCase();
        
        // Нормализация единиц
        if (unit === 'стл' || unit === 'ст л' || unit === 'ст. л.' || unit === 'ложка' || unit === 'ложки') unit = 'ст.л.';
        if (unit === 'чл' || unit === 'ч л' || unit === 'ч. л.' || unit === 'чайная ложка' || unit === 'чайные ложки') unit = 'ч.л.';
        if (unit === 'зубчик' || unit === 'зубчика' || unit === 'зубчиков') unit = 'зубч';
        if (unit === 'грамм' || unit === 'гр' || unit === 'граммов') unit = 'г';
        if (unit === 'штук' || unit === 'шт.') unit = 'шт';
        
        name = normalizeName(name);
        return { amount, unit, name };
    }
    
    // Обработка фраз без количества
    let nameOnly = normalizeName(raw);
    return { amount: 0, unit: '', name: nameOnly };
}

function aggregateIngredients(ingredients) {
    const groups = new Map();
    
    for (const ing of ingredients) {
        const norm = normalizeIngredient(ing);
        
        // Пропускаем пустые названия
        if (!norm.name || norm.name === 'единица') continue;
        
        // Специальная обработка для специй и приправ
        if (['соль', 'перец', 'специи', 'соль и перец'].includes(norm.name)) {
            norm.amount = 0;
            norm.unit = '';
        }
        
        const key = `${norm.name}|${norm.unit}`;
        if (groups.has(key)) {
            groups.get(key).amount += norm.amount;
        } else {
            groups.set(key, { ...norm });
        }
    }
    
    return Array.from(groups.values());
}

function categorizeIngredients(aggregated) {
    const categories = {
        'Мясо и рыба': [],
        'Овощи': [],
        'Фрукты и ягоды': [],
        'Зерновые и крупы': [],
        'Молочные продукты': [],
        'Яйца': [],
        'Орехи и семена': [],
        'Масла и приправы': [],
        'Прочее': []
    };
    
    for (const item of aggregated) {
        const name = item.name.toLowerCase();
        let category = 'Прочее';
        
        if (/курин|индейк|говяд|свинин|баранин|рыб|лосос|треск|тунец|филе/i.test(name)) {
            category = 'Мясо и рыба';
        } else if (/брокколи|морков|картофел|перец|лук|чеснок|шпинат|помидор|огурец|салат|горошек|фасоль|цукини|капуст/i.test(name)) {
            category = 'Овощи';
        } else if (/ягод|яблок|банан|апельсин|лимон|авокадо|клубник|малин|черник/i.test(name)) {
            category = 'Фрукты и ягоды';
        } else if (/овсян|гречк|рис|киноа|хлопь|крупа|мук/i.test(name)) {
            category = 'Зерновые и крупы';
        } else if (/молок|творог|сыр|йогурт|кефир/i.test(name)) {
            category = 'Молочные продукты';
        } else if (/яйц|яйко/i.test(name)) {
            category = 'Яйца';
        } else if (/орех|семеч|миндал/i.test(name)) {
            category = 'Орехи и семена';
        } else if (/масло|соль|перец|специи|мед|сахар|лимонный сок|уксус|приправ|паприк|корица|ваниль|кленовый сироп/i.test(name)) {
            category = 'Масла и приправы';
        }
        
        categories[category].push(item);
    }
    
    return categories;
}

function formatShoppingList(categories) {
    let result = '';
    
    for (const [catName, items] of Object.entries(categories)) {
        if (items.length === 0) continue;
        
        result += `<b>${escapeHtml(catName)}</b>\n`;
        
        // Сортируем по имени
        const sorted = items.slice().sort((a,b) => a.name.localeCompare(b.name));
        
        // Дополнительная агрегация внутри категории
        const finalAggregated = new Map();
        for (const it of sorted) {
            const key = `${it.name}|${it.unit}`;
            if (!finalAggregated.has(key)) {
                finalAggregated.set(key, { ...it });
            } else {
                finalAggregated.get(key).amount += it.amount;
            }
        }
        
        // Форматируем и выводим
        for (const it of finalAggregated.values()) {
            let qty = '';
            if (it.amount > 0) {
                if (it.unit === 'ст.л.' || it.unit === 'ч.л.') {
                    qty = `${Math.round(it.amount * 10) / 10} ${it.unit} `;
                } else if (it.unit === 'зубч') {
                    qty = `${Math.round(it.amount)} ${it.unit} `;
                } else {
                    qty = `${Math.round(it.amount)} ${it.unit} `;
                }
            }
            
            const line = `${qty}${it.name}`;
            result += ` • ${escapeHtml(line)}\n`;
        }
        
        result += '\n';
    }
    
    return result.trim();
}

async function generateShoppingListFromMeals(meals) {
    console.log('Generating shopping list from', meals.length, 'meals');
    
    const allIngredients = [];
    for (const meal of meals) {
        if (!meal.recipe) {
            console.log('No recipe found for meal:', meal.name);
            continue;
        }

        let recipeData;
        try {
            recipeData = typeof meal.recipe === 'string'
                ? JSON.parse(meal.recipe)
                : meal.recipe;
            console.log('Successfully parsed recipe for meal:', meal.name);
        } catch (err) {
            console.error('Error parsing recipe for meal:', meal.name, err);
            recipeData = { ingredients: [], steps: [], cookingTimeMinutes: 0 };
        }

        if (Array.isArray(recipeData.ingredients)) {
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

    // Локальная обработка: агрегация и категоризация
    const aggregated = aggregateIngredients(allIngredients);
    const categorized = categorizeIngredients(aggregated);
    const result = formatShoppingList(categorized);

    console.log('Generated shopping list with local processing');
    return result || 'Список покупок пуст.';
}

module.exports = {
    generateShoppingListFromMeals
};
