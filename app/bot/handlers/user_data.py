from aiogram import Router, F
from aiogram.types import Message
from aiogram.fsm.context import FSMContext
from aiogram.filters.command import Command
from aiogram.filters import StateFilter

from app.bot.state import UserDataForm
from app.bot.keyboards.user_data import gender_keyboard, activity_keyboard, goal_keyboard
from app.database.queries import create_or_update_user, get_user_by_telegram_id

router = Router()

@router.message(Command("begin"))
async def cmd_begin(message: Message, state: FSMContext):
    await message.answer("Введите ваш возраст (лет):")
    await state.set_state(UserDataForm.age)

@router.message(UserDataForm.age, F.text)
async def process_age(message: Message, state: FSMContext):
    age_text = message.text
    if not age_text.isdigit():
        await message.answer("Пожалуйста, введите числовое значение возраста.")
        return
    age = int(age_text)
    if age < 18 or age > 100:
        await message.answer("Возраст должен быть от 18 до 100. Попробуйте снова.")
        return

    await state.update_data(age=age)
    await message.answer("Выберите ваш пол:", reply_markup=gender_keyboard)
    await state.set_state(UserDataForm.gender)

@router.message(UserDataForm.gender, F.text)
async def process_gender(message: Message, state: FSMContext):
    gender_text = message.text.lower()
    if gender_text not in ["мужской", "женский"]:
        await message.answer("Выберите из вариантов: Мужской или Женский.")
        return
    gender = "male" if gender_text == "мужской" else "female"
    await state.update_data(gender=gender)
    await message.answer("Введите ваш вес (кг):", reply_markup=None)
    await state.set_state(UserDataForm.weight)

@router.message(UserDataForm.weight, F.text)
async def process_weight(message: Message, state: FSMContext):
    w_text = message.text
    try:
        w = float(w_text.replace(",", "."))
    except:
        await message.answer("Пожалуйста, введите число.")
        return
    if w < 30 or w > 200:
        await message.answer("Вес должен быть в диапазоне 30-200 кг.")
        return
    await state.update_data(weight=w)
    await message.answer("Введите ваш рост (см):")
    await state.set_state(UserDataForm.height)

@router.message(UserDataForm.height, F.text)
async def process_height(message: Message, state: FSMContext):
    h_text = message.text
    try:
        h = float(h_text.replace(",", "."))
    except:
        await message.answer("Пожалуйста, введите число.")
        return
    if h < 100 or h > 250:
        await message.answer("Рост должен быть в диапазоне 100-250 см.")
        return
    await state.update_data(height=h)
    await message.answer("Выберите уровень активности:", reply_markup=activity_keyboard)
    await state.set_state(UserDataForm.activity)

@router.message(UserDataForm.activity, F.text)
async def process_activity(message: Message, state: FSMContext):
    act_text = message.text.lower()
    mapping = {
        "низкий": "low",
        "средний": "medium",
        "высокий": "high"
    }
    if act_text not in mapping:
        await message.answer("Выберите из вариантов: Низкий, Средний, Высокий.")
        return
    await state.update_data(activity=mapping[act_text])
    await message.answer("Выберите цель:", reply_markup=goal_keyboard)
    await state.set_state(UserDataForm.goal)

@router.message(UserDataForm.goal, F.text)
async def process_goal(message: Message, state: FSMContext):
    g_text = message.text.lower()
    mapping = {
        "сбросить вес": "loss",
        "поддержание веса": "maintain",
        "набор массы": "gain"
    }
    if g_text not in mapping:
        await message.answer("Выберите из вариантов: Сбросить вес, Поддержание веса, Набор массы.")
        return
    await state.update_data(goal=mapping[g_text])

    data = await state.get_data()
    create_or_update_user(
        tg_id=message.from_user.id, 
        age=data["age"], 
        gender=data["gender"], 
        weight=data["weight"], 
        height=data["height"], 
        activity=data["activity"], 
        goal=data["goal"]
    )

    await message.answer("Данные сохранены. Наберите /calculate для расчёта калорий.")
    await state.clear()

def register_user_data_handlers(dp):
    dp.include_router(router)
