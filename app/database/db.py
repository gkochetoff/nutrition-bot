from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.bot.config import DATABASE_URL

print("DATABASE_URL =", DATABASE_URL)
engine = create_engine(DATABASE_URL, echo=False)
SessionLocal = sessionmaker(bind=engine)
