from sqlalchemy import Column, Integer, String, Text, ForeignKey, Date, Float, Boolean
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import declarative_base, relationship
from datetime import date

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
    week_start_date = Column(Date, nullable=True)
    week_requests_count = Column(Integer, default=0)

class AvailableProduct(Base):
    __tablename__ = "available_products"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False)
    # Допустим, укажем регион доступности. 
    # Можно сделать один столбец region (RU, EU), или булевы флаги. 
    region = Column(String, default="RU")  

class Dish(Base):
    __tablename__ = "dishes"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    date = Column(Date, nullable=False)  # день, на который рассчитано блюдо
    
    name = Column(String, nullable=False)
    # Здесь храним ингредиенты в формате JSON:
    # например [{"product": "Курица (филе)", "grams": 200}, {"product": "Рис", "grams": 100}]
    ingredients = Column(JSONB, nullable=False)
    
    recipe = Column(Text, nullable=False)  # сам рецепт (либо JSON, если удобнее)

    user = relationship("User")  # Связь с моделью пользователя