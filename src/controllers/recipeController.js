const db = require('../services/db');

async function getRecipeByMealId(mealId) {
    console.log('Fetching recipe for meal:', mealId);
    try {
        const res = await db.query('SELECT name, recipe FROM meals WHERE id=$1', [mealId]);
        if (res.rows.length === 0) {
            console.log('No meal found with id:', mealId);
            return null;
        }

        const row = res.rows[0];
        console.log('Found meal:', row.name);

        if (!row.recipe) {
            console.log('No recipe found for meal:', row.name);
            return {
                name: row.name,
                recipe: { ingredients: [], steps: [], cookingTimeMinutes: 0 }
            };
        }

        let recipeData;
        try {
            // If stored as JSONB, it's already an object; if TEXT, parse
            recipeData = typeof row.recipe === 'string' ? JSON.parse(row.recipe) : row.recipe;
            console.log('Successfully parsed recipe for:', row.name);
        } catch (err) {
            console.error('Error parsing recipe for meal:', row.name, err);
            recipeData = { ingredients: [], steps: [], cookingTimeMinutes: 0 };
        }

        return {
            name: row.name,
            recipe: recipeData
        };
    } catch (err) {
        console.error('Database error while fetching recipe:', err);
        return null;
    }
}

module.exports = {
    getRecipeByMealId
};
