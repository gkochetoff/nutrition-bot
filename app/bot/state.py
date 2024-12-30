from aiogram.fsm.state import StatesGroup, State

class UserDataForm(StatesGroup):
    age = State()
    gender = State()
    weight = State()
    height = State()
    activity = State()
    goal = State()
