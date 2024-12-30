from aiogram.types import ReplyKeyboardMarkup, KeyboardButton

gender_keyboard = ReplyKeyboardMarkup(
    keyboard=[
        [KeyboardButton(text="Мужской"), KeyboardButton(text="Женский")]
    ],
    resize_keyboard=True
)

activity_keyboard = ReplyKeyboardMarkup(
    keyboard=[
        [KeyboardButton(text="Низкий"), KeyboardButton(text="Средний"), KeyboardButton(text="Высокий")]
    ],
    resize_keyboard=True
)

goal_keyboard = ReplyKeyboardMarkup(
    keyboard=[
        [KeyboardButton(text="Сбросить вес"), KeyboardButton(text="Поддержание веса"), KeyboardButton(text="Набор массы")]
    ],
    resize_keyboard=True
)
