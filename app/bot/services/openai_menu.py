import openai
import json
from datetime import date, timedelta
from app.bot.config import OPENAI_TOKEN
from app.database.models import Dish
from app.database.db import SessionLocal

# Присвойте корректный ключ
openai.api_key = OPENAI_TOKEN

def generate_weekly_menu(user, products):
    """
    Генерируем меню на 7 дней, возвращаем список словарей
    [
      {
        "day": 1,
        "dishName": "...",
        "ingredients": [
           {"product": "...", "grams": 100},
           ...
        ],
        "recipe": "..."
      },
      ...
    ]
    """
    # Собираем prompt, но лучше использовать messages и ChatCompletion
    # Просим строго вернуть JSON
    messages = [
        {
            "role": "system",
            "content": (
                "Ты — ассистент, который формирует план питания. "
                "Всегда отвечай строго в формате JSON, без пояснений и без кода."
            )
        },
        {
            "role": "user",
            "content": f"""
Составь план питания на 7 дней, учитывая:
- Калорийность: {user.calories:.0f} ккал в день
- Б: {user.protein:.1f} г, Ж: {user.fat:.1f} г, У: {user.carbs:.1f} г в день
- Цель: {user.goal}
- Список доступных продуктов (указывай в блюдах только из этого списка):
  {', '.join([p.name for p in products])}

Формат ответа: JSON со структурой:
[
  {{
    "day": 1,
    "dishName": "...",
    "ingredients": [
       {{"product": "...", "grams": 100}},
       ...
    ],
    "recipe": "Шаги приготовления..."
  }},
  ...
]

На каждый день 3-4 разных блюда (завтрак, обед, ужин, перекус). 
Без дополнительных пояснений — только валидный JSON!
"""
        }
    ]

    # Максимальное количество токенов может быть отрегулировано
    attempt = 0
    menu_data = []
    while attempt < 3:
        attempt += 1
        try:
            response = openai.ChatCompletion.create(
                model="gpt-3.5-turbo",
                messages=messages,
                temperature=0.7
            )
            text = response["choices"][0]["message"]["content"].strip()
            # Пробуем распарсить JSON
            menu_data = json.loads(text)
            # Если всё хорошо — выходим из цикла
            break
        except (json.JSONDecodeError, KeyError) as e:
            # Если ошибка парсинга — попробуем ещё раз
            # Можно подать ChatGPT дополнительный «уточняющий» репромпт
            messages.append({
                "role": "user",
                "content": (
                    "В предыдущем ответе JSON невалиден. "
                    "Пожалуйста, верни строго валидный JSON, без кода и пояснений."
                )
            })
            continue

    return menu_data

def store_weekly_menu(user, menu_data):
    """
    Сохраняем блюда в БД, привязывая к пользователю и датам
    """
    session = SessionLocal()
    start_day = date.today()
    
    for item in menu_data:
        day_offset = item.get("day", 1) - 1
        dish_date = start_day + timedelta(days=day_offset)

        dish_name = item.get("dishName", "Без названия")
        ingredients = item.get("ingredients", [])
        recipe = item.get("recipe", "")

        dish = Dish(
            user_id=user.id,
            date=dish_date,
            name=dish_name,
            ingredients=ingredients,
            recipe=recipe
        )
        session.add(dish)
    
    session.commit()
    session.close()