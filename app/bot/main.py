import asyncio
from aiogram import Bot, Dispatcher

from app.bot.config import BOT_TOKEN
from app.bot.handlers.start import register_start_handlers
from app.bot.handlers.user_data import register_user_data_handlers
from app.bot.handlers.calculations import register_calculation_handlers

async def main():
    bot = Bot(token=BOT_TOKEN, parse_mode="HTML")
    dp = Dispatcher()

    # Регистрируем хэндлеры
    register_start_handlers(dp)
    register_user_data_handlers(dp)
    register_calculation_handlers(dp)

    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
