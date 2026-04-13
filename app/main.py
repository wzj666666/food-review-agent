from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.database import Base, engine
from app.routers import ai, auth, regions, reviews, user

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

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


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)


@app.get("/api/health")
def health():
    return {"ok": True}


if STATIC_DIR.exists():

    @app.get("/")
    def index_html():
        return FileResponse(STATIC_DIR / "index.html")

    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/{full_path:path}")
    def spa(full_path: str):
        file = STATIC_DIR / full_path
        if file.is_file():
            return FileResponse(file)
        return FileResponse(STATIC_DIR / "index.html")

else:

    @app.get("/")
    def root():
        return {
            "message": "前端未构建：在 frontend 目录执行 npm install && npm run build",
            "docs": "/docs",
        }
