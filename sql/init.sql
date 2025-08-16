-- Создаем таблицу пользователей
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE NOT NULL,
    age INT,
    gender VARCHAR(2),
    weight NUMERIC(5,2),
    height NUMERIC(5,2),
    activity_level VARCHAR(20),
    goal VARCHAR(20),
    daily_calories INT,
    protein INT,
    fat INT,
    carbs INT,
    is_premium BOOLEAN DEFAULT FALSE
);

-- Таблица меню
CREATE TABLE IF NOT EXISTS menus (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    total_calories INT,
    days JSONB  -- исходный JSON меню
);

-- Таблица блюд (meals)
CREATE TABLE IF NOT EXISTS meals (
    id SERIAL PRIMARY KEY,
    menu_id INT REFERENCES menus(id) ON DELETE CASCADE,
    day INT,
    meal_time VARCHAR(20), -- breakfast, lunch, dinner
    name TEXT,
    calories INT,
    protein INT,
    fat INT,
    carbs INT,
    portion_weight INT,
    recipe JSONB
);
