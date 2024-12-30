from app.database.db import SessionLocal
from app.database.models import User

def get_user_by_telegram_id(tg_id: int):
    session = SessionLocal()
    user = session.query(User).filter(User.telegram_id == tg_id).first()
    session.close()
    return user

def create_or_update_user(tg_id: int, **kwargs):
    session = SessionLocal()
    user = session.query(User).filter(User.telegram_id == tg_id).first()
    if not user:
        user = User(telegram_id=tg_id, **kwargs)
        session.add(user)
    else:
        for k, v in kwargs.items():
            setattr(user, k, v)
    session.commit()
    session.close()
