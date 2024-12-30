from aiogram import Router
from aiogram.types import Message
from aiogram.filters.command import Command

router = Router()

@router.message(Command("start"))
async def cmd_start(message: Message):
    await message.answer("Привет! Я помогу рассчитать вашу норму калорий. Наберите /begin для начала сбора данных.")
    
def register_start_handlers(dp):
    dp.include_router(router)
