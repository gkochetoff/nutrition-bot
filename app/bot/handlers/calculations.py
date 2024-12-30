from aiogram import Router
from aiogram.types import Message
from aiogram.filters.command import Command

from app.database.queries import get_user_by_telegram_id, create_or_update_user
from app.bot.utils.calculations import calculate_calories

router = Router()

@router.message(Command("calculate"))
async def cmd_calculate(message: Message):
    user = get_user_by_telegram_id(message.from_user.id)
    if not user or not all([user.age, user.gender, user.weight, user.height, user.activity, user.goal]):
        await message.answer("Сначала заполните данные с помощью команды /begin.")
        return

    calories, p, f, c = calculate_calories(
        age=user.age,
        gender=user.gender,
        weight=user.weight,
        height=user.height,
        activity_level=user.activity,
        goal=user.goal
    )

    # Сохраняем результаты в БД
    create_or_update_user(message.from_user.id, calories=calories, protein=p, fat=f, carbs=c)

    await message.answer(
        f"Ваша дневная норма: {calories:.0f} ккал.\n"
        f"Белки: {p:.1f} г\n"
        f"Жиры: {f:.1f} г\n"
        f"Углеводы: {c:.1f} г"
    )

def register_calculation_handlers(dp):
    dp.include_router(router)
