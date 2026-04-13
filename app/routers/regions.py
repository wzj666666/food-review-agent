import json
from pathlib import Path

from fastapi import APIRouter

router = APIRouter(prefix="/api/regions", tags=["regions"])

_CACHE: list | None = None


def _load_regions() -> list:
    global _CACHE
    if _CACHE is not None:
        return _CACHE
    path = Path(__file__).resolve().parent.parent / "data" / "regions.json"
    with open(path, encoding="utf-8") as f:
        _CACHE = json.load(f)
    return _CACHE


@router.get("")
def get_regions():
    """省 -> 市 -> 区 三级结构（精简常用城市）。"""
    return _load_regions()
