from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from starlette.formparsers import MultiPartParser

from app.database import Base, engine
from app.routers import ai, auth, regions, reviews, uploads, user
from app.upload_paths import UPLOADS_ROOT

# Starlette 默认 multipart 单段约 1MB，超过会解析失败；配图 10MB、视频 80MB
MultiPartParser.max_part_size = 85 * 1024 * 1024
MultiPartParser.max_file_size = 85 * 1024 * 1024

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

# 避免手机 WebView / 浏览器长期缓存入口页，仍指向旧 hash 的 JS/CSS
_HTML_NO_CACHE = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
}

app = FastAPI(title="个人点评", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(reviews.router)
app.include_router(user.router)
app.include_router(regions.router)
app.include_router(ai.router)
app.include_router(uploads.router)

UPLOADS_ROOT.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_ROOT)), name="uploads")


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    if engine.dialect.name == "sqlite":
        with engine.begin() as conn:
            rows = conn.execute(text("PRAGMA table_info(reviews)")).fetchall()
            col_names = {row[1] for row in rows}
            if "images_json" not in col_names:
                conn.execute(text("ALTER TABLE reviews ADD COLUMN images_json TEXT NOT NULL DEFAULT '[]'"))
            if "recommend_tier" not in col_names:
                conn.execute(
                    text("ALTER TABLE reviews ADD COLUMN recommend_tier VARCHAR(16) NOT NULL DEFAULT '人上人'")
                )
            if "latitude" not in col_names:
                conn.execute(text("ALTER TABLE reviews ADD COLUMN latitude REAL"))
            if "longitude" not in col_names:
                conn.execute(text("ALTER TABLE reviews ADD COLUMN longitude REAL"))
            if "videos_json" not in col_names:
                conn.execute(text("ALTER TABLE reviews ADD COLUMN videos_json TEXT NOT NULL DEFAULT '[]'"))
            if "attachments_json" not in col_names:
                conn.execute(text("ALTER TABLE reviews ADD COLUMN attachments_json TEXT NOT NULL DEFAULT '[]'"))


@app.get("/api/health")
def health():
    return {"ok": True}


if STATIC_DIR.exists():

    @app.get("/")
    def index_html():
        return FileResponse(STATIC_DIR / "index.html", headers=_HTML_NO_CACHE)

    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        file = STATIC_DIR / full_path
        if file.is_file():
            return FileResponse(file)
        return FileResponse(STATIC_DIR / "index.html", headers=_HTML_NO_CACHE)

else:

    @app.get("/")
    def root():
        return {
            "message": "前端未构建：在 frontend 目录执行 npm install && npm run build",
            "docs": "/docs",
        }
