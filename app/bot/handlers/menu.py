import json
import asyncio
from datetime import date, datetime, timedelta

from aiogram import Router, F
from aiogram.types import Message, CallbackQuery
from aiogram.filters import Command

# Импорт моделей и сессии
from app.database.db import SessionLocal
from app.database.models import User, Dish, AvailableProduct

# Импортируем функции из openai_menu (исправленные на ChatCompletion)
from app.bot.services.openai_menu import generate_weekly_menu, store_weekly_menu

router = Router()

@router.message(Command("get_week_menu"))
async def handle_get_week_menu(message: Message):
    """
    Генерация меню на неделю
    """
    user_id = message.from_user.id

    # Синхронно полезем в БД
    session = SessionLocal()
    try:
        user = session.query(User).filter_by(telegram_id=user_id).first()
        
        if not user:
            await message.answer("Сначала введите данные с помощью /begin или /calculate")
            session.close()
            return
        
        # Проверяем наличие необходимых полей, чтобы OpenAI мог учесть калорийность и БЖУ
        if not all([user.calories, user.protein, user.fat, user.carbs, user.goal]):
            await message.answer("Сначала рассчитайте норму калорий и БЖУ, командой /calculate.")
            session.close()
            return

        # 1) Проверяем лимит запросов (предполагается, что есть поля week_start_date, week_requests_count)
        if user.week_start_date and (datetime.today().date() - user.week_start_date).days < 7:
            if user.week_requests_count >= 5:
                await message.answer("Лимит запросов (5) на неделю исчерпан.")
                session.close()
                return
        else:
            # Обновляем неделю (сбрасываем счётчик)
            user.week_start_date = datetime.today().date()
            user.week_requests_count = 0
        
        # 2) Инкрементируем счётчик
        user.week_requests_count += 1
        session.commit()
        
        # 3) Получаем продукты
        products = session.query(AvailableProduct).all()
        

        # 4) Генерируем меню (вызов OpenAI)
        # Чтобы не блокировать event-loop, выносим в executor (по желанию).
        # Простой способ — просто вызвать напрямую (будет блокировка).
        menu_data = await asyncio.to_thread(generate_weekly_menu, user, products)
        
        # 5) Сохраняем в БД
        await asyncio.to_thread(store_weekly_menu, user, menu_data)
        # Теперь снова откроем сессию и прочитаем блюда, которые только что записали.
        # Например, все блюда за ближайшую неделю (или только что добавленные)
        session = SessionLocal()
        from datetime import date, timedelta
        start_day = date.today()
        end_day = start_day + timedelta(days=6)
        dishes = session.query(Dish).filter(
            Dish.user_id == user.id,
            Dish.date >= start_day,
            Dish.date <= end_day
        ).all()
        session.close()

        if not dishes:
            await message.answer("Меню не получено или не сохранено. Повторите попытку.")
            return

        # Формируем текст и кнопки. Поскольку блюд может быть много,
        # обычно выводят несколько сообщений — по дням или по 2-3 блюда на сообщение.
        # Для простоты выведем всё в одном сообщении.
        final_text = "Сформировано меню на неделю:\n"
        # Соберём InlineKeyboardMarkup
        from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
        keyboard = InlineKeyboardMarkup()

        for dish in dishes:
            # dish.id — у нас есть ID из базы
            # Добавим в текст краткую строку
            final_text += f"День: {dish.date}, {dish.name}\n"
            # Добавим кнопку «Подробнее» с callback_data вида show_dish_##
            keyboard.add(
                InlineKeyboardButton(
                    text=f"Подробнее про {dish.name[:15]}",
                    callback_data=f"show_dish_{dish.id}"
                )
            )

        await message.answer(final_text, reply_markup=keyboard)
    finally:
        session.close()

@router.callback_query(F.data.startswith("show_dish_"))
async def handle_show_dish(call: CallbackQuery):
    """
    Показ отдельного блюда по нажатию inline-кнопки (если есть)
    """
    dish_id_str = call.data.replace("show_dish_", "")
    if not dish_id_str.isdigit():
        await call.message.answer("Некорректный идентификатор блюда.")
        return

    dish_id = int(dish_id_str)
    session = SessionLocal()
    dish = session.query(Dish).get(dish_id)
    session.close()

    if not dish:
        await call.message.answer("Блюдо не найдено.")
        return

    # Формируем текст ингредиентов
    ingredients_list = dish.ingredients or []
    ingredients_text = ""
    for ing in ingredients_list:
        product = ing.get("product", "???")
        grams = ing.get("grams", "?")
        ingredients_text += f"{product}: {grams} г\n"

    recipe_text = dish.recipe or "Нет рецепта"
    out_text = (
        f"<b>{dish.name}</b>\n\n"
        f"<i>Ингредиенты:</i>\n{ingredients_text}\n"
        f"<i>Рецепт:</i>\n{recipe_text}"
    )

    await call.message.answer(out_text)

@router.message(Command("get_shopping_list"))
async def handle_get_shopping_list(message: Message):
    """
    Собираем список продуктов за 7 дней от сегодня
    """
    user_id = message.from_user.id
    session = SessionLocal()
    user = session.query(User).filter_by(telegram_id=user_id).first()
    
    if not user:
        await message.answer("Сначала введите данные пользователя.")
        session.close()
        return

    today = date.today()
    end_day = today + timedelta(days=6)
    
    dishes = session.query(Dish).filter(
        Dish.user_id == user.id,
        Dish.date >= today,
        Dish.date <= end_day
    ).all()
    session.close()

    if not dishes:
        await message.answer("У вас нет запланированного меню на ближайшие 7 дней.")
        return

    # Суммируем ингредиенты
    shopping_dict = {}
    for d in dishes:
        for ing in d.ingredients:
            product_name = ing.get("product", "???")
            grams = ing.get("grams", 0)
            shopping_dict[product_name] = shopping_dict.get(product_name, 0) + grams

    # Формируем текст для вывода
    shopping_text = "Список покупок на неделю:\n"
    for product, grams in shopping_dict.items():
        shopping_text += f"{product}: {grams} г\n"
    
    await message.answer(shopping_text)

@router.message(Command("today_meal"))
async def handle_today_meal(message: Message):
    """
    Отправляем план (блюда) на сегодня
    """
    user_id = message.from_user.id
    session = SessionLocal()
    user = session.query(User).filter_by(telegram_id=user_id).first()
    if not user:
        await message.answer("Сначала введите данные пользователя.")
        session.close()
        return

    today = date.today()
    dishes = session.query(Dish).filter_by(user_id=user.id, date=today).all()
    session.close()

    if not dishes:
        await message.answer("На сегодня нет запланированного меню.")
        return

    msg = "Вот ваш план на сегодня:\n"
    for dish in dishes:
        msg += f"• {dish.name}\n"

    await message.answer(msg)
