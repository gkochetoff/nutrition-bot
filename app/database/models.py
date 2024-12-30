from sqlalchemy import Column, Integer, String, Float, Boolean
from sqlalchemy.orm import declarative_base

Base = declarative_base()

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    telegram_id = Column(Integer, unique=True, nullable=False)
    age = Column(Integer)
    gender = Column(String)     # 'male' или 'female'
    weight = Column(Float)
    height = Column(Float)
    activity = Column(String)   # 'low', 'medium', 'high'
    goal = Column(String)       # 'loss', 'maintain', 'gain'

    # Поля для калорий и БЖУ (добавим на шаге 4)
    calories = Column(Float)
    protein = Column(Float)
    fat = Column(Float)
    carbs = Column(Float)
