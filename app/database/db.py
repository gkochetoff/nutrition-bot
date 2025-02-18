from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.bot.config import DATABASE_URL
from app.database.models import AvailableProduct

print("DATABASE_URL =", DATABASE_URL)
engine = create_engine(DATABASE_URL, echo=False)
SessionLocal = sessionmaker(bind=engine)

def seed_available_products():
    session = SessionLocal()
    products = [
        AvailableProduct(name="Курица (филе)", region="RU"),
        AvailableProduct(name="Яйца куриные", region="RU"),
        AvailableProduct(name="Творог 5%", region="RU"),
        AvailableProduct(name="Овсянка", region="EU"),
        AvailableProduct(name="Рис", region="EU"),
        # Добавляйте далее по необходимости
    ]
    session.add_all(products)
    session.commit()
    session.close()