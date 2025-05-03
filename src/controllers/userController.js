const db = require('../services/db');

async function upsertUser({
  telegram_id,
  age,
  gender,
  weight,
  height,
  activity,
  goal,
  daily_calories,
  protein,
  fat,
  carbs
}) {
  const query = `
    INSERT INTO users (
      telegram_id, age, gender, weight, height, activity_level, goal, 
      daily_calories, protein, fat, carbs
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (telegram_id)
    DO UPDATE SET
      age = EXCLUDED.age,
      gender = EXCLUDED.gender,
      weight = EXCLUDED.weight,
      height = EXCLUDED.height,
      activity_level = EXCLUDED.activity_level,
      goal = EXCLUDED.goal,
      daily_calories = EXCLUDED.daily_calories,
      protein = EXCLUDED.protein,
      fat = EXCLUDED.fat,
      carbs = EXCLUDED.carbs
    RETURNING id
  `;
  const values = [
    telegram_id, age, gender, weight, height, activity, goal,
    daily_calories, protein, fat, carbs
  ];

  const res = await db.query(query, values);
  return res.rows[0];
}

async function getUserByTelegramId(telegramId) {
  const res = await db.query('SELECT * FROM users WHERE telegram_id=$1', [telegramId]);
  if (res.rows.length > 0) return res.rows[0];
  return null;
}

module.exports = {
  upsertUser,
  getUserByTelegramId
};
