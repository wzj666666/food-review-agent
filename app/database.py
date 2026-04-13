from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.engine.url import URL
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import settings

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

if settings.database_url:
    db_url = settings.database_url
else:
    db_path = str((DATA_DIR / "dianping.db").resolve())
    db_url = URL.create("sqlite", database=db_path)

connect_args = {"check_same_thread": False} if str(db_url).startswith("sqlite") else {}
engine = create_engine(db_url, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
