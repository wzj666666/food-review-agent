import json
from pathlib import Path

import httpx
from fastapi import APIRouter

from app.config import settings

router = APIRouter(prefix="/api/regions", tags=["regions"])

_CACHE: list | None = None


def _load_regions() -> list:
    global _CACHE
    if _CACHE is not None:
        return _CACHE

    k = (settings.amap_key or "").strip()
    if k:
        try:
            resp = httpx.get(
                "https://restapi.amap.com/v3/config/district",
                params={"key": k, "keywords": "中国", "subdistrict": 3, "extensions": "base"},
                timeout=30,
            )
            data = resp.json()
            out: list = []
            for prov in data["districts"][0]["districts"]:
                cities = []
                for city in prov.get("districts", []):
                    districts = [d["name"] for d in city.get("districts", [])]
                    cities.append({"name": city["name"], "districts": districts})
                out.append({"name": prov["name"], "cities": cities})
            _CACHE = out
            return _CACHE
        except Exception:
            pass

    # 高德未配置或请求失败时降级读静态文件
    path = Path(__file__).resolve().parent.parent / "data" / "regions.json"
    with open(path, encoding="utf-8") as f:
        _CACHE = json.load(f)
    return _CACHE


@router.get("")
def get_regions():
    """省 -> 市 -> 区 三级结构（优先从高德行政区接口实时拉取并缓存，降级读静态文件）。"""
    return _load_regions()
