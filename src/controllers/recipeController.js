const db = require('../services/db');

async function getRecipeByMealId(mealId) {
    const res = await db.query('SELECT name, recipe FROM meals WHERE id=$1', [mealId]);
    if (res.rows.length > 0) {
      const row = res.rows[0];
      let recipeData;
      try {
        recipeData = JSON.parse(row.recipe);
      } catch {
        recipeData = { ingredients: [], steps: [], cookingTimeMinutes: 0 };
      }
      return {
        name: row.name,
        recipe: recipeData
      };
    }
    return null;
  }
  

module.exports = {
  getRecipeByMealId
};
