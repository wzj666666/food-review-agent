import json
import re
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.models import Review, User
from app.recommend_tier import normalize_recommend_tier
from app.schemas import (
    AttachmentItem,
    ReviewCreate,
    ReviewInputTipItem,
    ReviewInputTipsOut,
    ReviewLocationSuggestIn,
    ReviewLocationSuggestOut,
    ReviewOut,
    ReviewPoiSuggestion,
)
from app.upload_paths import delete_files_for_paths, fs_path_for_url, parse_images_json, parse_videos_json

AMAP_V3 = "https://restapi.amap.com/v3"

router = APIRouter(prefix="/api/reviews", tags=["reviews"])


def _overall(r: Review) -> float:
    return (r.taste_score + r.service_score + r.environment_score + r.value_score) / 4.0


def _images_json_for_save(user_id: int, paths: list[str]) -> str:
    if len(paths) > 9:
        raise HTTPException(status_code=400, detail="最多 9 张配图")
    seen: set[str] = set()
    out: list[str] = []
    for p in paths:
        p = (p or "").strip()
        if not p or p in seen:
            continue
        loc = fs_path_for_url(p, user_id)
        if not loc or not loc.is_file():
            raise HTTPException(status_code=400, detail=f"无效或未上传的图片: {p}")
        seen.add(p)
        out.append(p)
    return json.dumps(out, ensure_ascii=False)


def _videos_json_for_save(user_id: int, paths: list[str]) -> str:
    if len(paths) > 3:
        raise HTTPException(status_code=400, detail="最多 3 个视频")
    seen: set[str] = set()
    out: list[str] = []
    for p in paths:
        p = (p or "").strip()
        if not p or p in seen:
            continue
        loc = fs_path_for_url(p, user_id)
        if not loc or not loc.is_file():
            raise HTTPException(status_code=400, detail=f"无效或未上传的视频: {p}")
        seen.add(p)
        out.append(p)
    return json.dumps(out, ensure_ascii=False)


def _is_video_path(p: str) -> bool:
    return p.lower().endswith((".mp4", ".webm", ".mov"))


def parse_attachments_json(raw: str | None) -> list[AttachmentItem]:
    if not raw or not raw.strip():
        return []
    try:
        data = json.loads(raw)
        if not isinstance(data, list):
            return []
        out: list[AttachmentItem] = []
        for x in data:
            if not isinstance(x, dict):
                continue
            t = x.get("type")
            p = (x.get("path") or "").strip()
            if t not in ("image", "video") or not p:
                continue
            out.append(AttachmentItem(type=t, path=p))
        return out
    except (json.JSONDecodeError, ValueError):
        return []


def _attachments_json_for_save(user_id: int, items: list[AttachmentItem]) -> str:
    imgs = sum(1 for a in items if a.type == "image")
    vids = sum(1 for a in items if a.type == "video")
    if imgs > 9 or vids > 3:
        raise HTTPException(status_code=400, detail="配图最多 9 张，视频最多 3 个")
    seen: set[str] = set()
    for a in items:
        p = a.path.strip()
        if not p or p in seen:
            raise HTTPException(status_code=400, detail="媒体路径重复或为空")
        seen.add(p)
        loc = fs_path_for_url(p, user_id)
        if not loc or not loc.is_file():
            raise HTTPException(status_code=400, detail=f"无效或未上传的媒体: {p}")
        is_vid = _is_video_path(p)
        if a.type == "video" and not is_vid:
            raise HTTPException(status_code=400, detail=f"类型与文件不符（应为视频）: {p}")
        if a.type == "image" and is_vid:
            raise HTTPException(status_code=400, detail=f"类型与文件不符（应为图片）: {p}")
    return json.dumps([{"type": a.type, "path": a.path.strip()} for a in items], ensure_ascii=False)


def _media_paths_for_review_row(r: Review) -> list[str]:
    att = parse_attachments_json(getattr(r, "attachments_json", None) or "[]")
    if att:
        return [a.path for a in att]
    return parse_images_json(getattr(r, "images_json", None) or "[]") + parse_videos_json(
        getattr(r, "videos_json", None) or "[]"
    )


def _parse_place_text_pois(data: dict[str, Any], limit: int = 3) -> list[ReviewPoiSuggestion]:
    raw = data.get("pois")
    if raw is None:
        pois: list[Any] = []
    elif isinstance(raw, list):
        pois = raw
    else:
        pois = []
    out: list[ReviewPoiSuggestion] = []
    for p in pois:
        if not isinstance(p, dict):
            continue
        loc = p.get("location") or ""
        parts = str(loc).split(",")
        if len(parts) != 2:
            continue
        try:
            lng = float(parts[0].strip())
            lat = float(parts[1].strip())
        except ValueError:
            continue
        name = str(p.get("name") or "").strip()
        addr = str(p.get("address") or p.get("business_area") or "").strip()
        if not name:
            continue
        out.append(
            ReviewPoiSuggestion(
                name=name,
                address=addr,
                longitude=lng,
                latitude=lat,
                adcode=str(p.get("adcode") or ""),
                type=str(p.get("type") or ""),
            )
        )
        if len(out) >= limit:
            break
    return out


def _amap_place_text(keywords: str, city: str) -> dict[str, Any]:
    k = (settings.amap_key or "").strip()
    if not k:
        raise HTTPException(status_code=503, detail="服务端未配置 AMAP_KEY，无法检索位置")
    params: dict[str, Any] = {
        "key": k,
        "keywords": keywords,
        "city": city or None,
        "citylimit": "true" if city.strip() else "false",
        "page": 1,
        "offset": 10,
        "extensions": "all",
        "output": "json",
    }
    params = {a: b for a, b in params.items() if b is not None and b != ""}
    url = f"{AMAP_V3}/place/text"
    with httpx.Client(timeout=25.0) as client:
        r = client.get(url, params=params)
        r.raise_for_status()
        return r.json()


def _amap_input_tips(keywords: str, city: str) -> dict[str, Any]:
    k = (settings.amap_key or "").strip()
    if not k:
        raise HTTPException(status_code=503, detail="服务端未配置 AMAP_KEY，无法检索位置")
    params: dict[str, Any] = {
        "key": k,
        "keywords": keywords,
        "city": city or None,
        "citylimit": "true" if city.strip() else "false",
        "datatype": "poi",
        "output": "json",
    }
    params = {a: b for a, b in params.items() if b is not None and b != ""}
    url = f"{AMAP_V3}/assistant/inputtips"
    with httpx.Client(timeout=15.0) as client:
        r = client.get(url, params=params)
        r.raise_for_status()
        return r.json()


def _tip_str(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, list):
        parts = [str(x).strip() for x in v if x is not None and str(x).strip()]
        return parts[0] if parts else ""
    return str(v).strip()


def _strip_tip_html(s: str) -> str:
    return re.sub(r"<[^>]*>", "", s or "")


def _input_tip_subtitle(t: dict[str, Any]) -> str:
    type_full = _tip_str(t.get("type"))
    cat = type_full.split(";")[0].strip() if type_full else ""
    prov = _tip_str(t.get("province"))
    ct = _tip_str(t.get("city"))
    dist = _tip_str(t.get("district"))
    addr = _tip_str(t.get("address"))
    geo = "-".join(p for p in (prov, ct, dist, addr) if p)
    if cat and geo:
        return f"{cat} · {geo}"
    if geo:
        return geo
    return cat or dist or addr


def _input_tip_kind(t: dict[str, Any], has_loc: bool) -> Literal["poi", "bus", "keyword"]:
    if not has_loc:
        return "keyword"
    tc = str(t.get("typecode") or "")
    name = str(t.get("name") or "")
    dtype = str(t.get("datatype") or "").lower()
    if dtype == "bus" or "地铁" in name or "公交站" in name or tc.startswith("1505") or tc.startswith("1507"):
        return "bus"
    return "poi"


def _parse_input_tips(data: dict[str, Any], limit: int = 15) -> list[ReviewInputTipItem]:
    raw = data.get("tips")
    tips_list: list[Any] = raw if isinstance(raw, list) else []
    out: list[ReviewInputTipItem] = []
    for t in tips_list:
        if not isinstance(t, dict):
            continue
        name = _strip_tip_html(_tip_str(t.get("name")))
        if not name:
            continue
        loc = _tip_str(t.get("location"))
        lng: float | None = None
        lat: float | None = None
        if loc and "," in loc:
            parts = loc.split(",", 1)
            try:
                lng = float(parts[0].strip())
                lat = float(parts[1].strip())
            except ValueError:
                pass
        has_loc = lng is not None and lat is not None
        out.append(
            ReviewInputTipItem(
                name=name,
                subtitle=_input_tip_subtitle(t),
                kind=_input_tip_kind(t, has_loc),
                longitude=lng,
                latitude=lat,
                province=_tip_str(t.get("province")),
                city=_tip_str(t.get("city")),
                district=_tip_str(t.get("district")),
            )
        )
        if len(out) >= limit:
            break
    return out


def _to_out(r: Review, author: User) -> ReviewOut:
    try:
        dishes = json.loads(r.dishes_json) if r.dishes_json else []
        if not isinstance(dishes, list):
            dishes = []
    except json.JSONDecodeError:
        dishes = []
    imgs = parse_images_json(getattr(r, "images_json", None) or "[]")
    vids = parse_videos_json(getattr(r, "videos_json", None) or "[]")
    att = parse_attachments_json(getattr(r, "attachments_json", None) or "[]")
    if not att:
        att = [AttachmentItem(type="image", path=p) for p in imgs] + [
            AttachmentItem(type="video", path=p) for p in vids
        ]
    return ReviewOut(
        id=r.id,
        user_id=r.user_id,
        author_username=author.username,
        restaurant_name=r.restaurant_name,
        dining_type=r.dining_type,
        province=r.province,
        city=r.city,
        district=r.district,
        taste_score=r.taste_score,
        service_score=r.service_score,
        environment_score=r.environment_score,
        value_score=r.value_score,
        avg_price=r.avg_price,
        dishes=[str(x) for x in dishes],
        recommend_tier=normalize_recommend_tier(getattr(r, "recommend_tier", None)),
        images=imgs,
        videos=vids,
        attachments=att,
        content=r.content,
        latitude=getattr(r, "latitude", None),
        longitude=getattr(r, "longitude", None),
        created_at=r.created_at,
        overall_score=round(_overall(r), 2),
    )


@router.get("", response_model=list[ReviewOut])
def list_reviews(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
    q: str | None = Query(None, description="搜索餐厅名或菜品"),
    sort: Literal["time_desc", "time_asc", "score_desc", "score_asc"] = "time_desc",
):
    query = db.query(Review)

    if q and q.strip():
        term = f"%{q.strip()}%"
        dish_match = Review.dishes_json.like(term)
        query = query.filter(or_(Review.restaurant_name.like(term), dish_match))

    reviews = query.all()
    users = {u.id: u for u in db.query(User).all()}

    items: list[tuple[Review, float]] = []
    for r in reviews:
        u = users.get(r.user_id)
        if not u:
            continue
        score = _overall(r)
        items.append((r, score))

    if sort == "time_desc":
        items.sort(key=lambda x: x[0].created_at, reverse=True)
    elif sort == "time_asc":
        items.sort(key=lambda x: x[0].created_at)
    elif sort == "score_desc":
        items.sort(key=lambda x: x[1], reverse=True)
    elif sort == "score_asc":
        items.sort(key=lambda x: x[1])

    return [_to_out(r, users[r.user_id]) for r, _ in items]


@router.post("", response_model=ReviewOut)
def create_review(
    body: ReviewCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    r = Review(
        user_id=user.id,
        restaurant_name=body.restaurant_name.strip(),
        dining_type=body.dining_type,
        province=body.province.strip() if body.province else "",
        city=body.city.strip(),
        district=body.district.strip() if body.district else "",
        taste_score=float(body.taste_score),
        service_score=float(body.service_score),
        environment_score=float(body.environment_score),
        value_score=float(body.value_score),
        avg_price=int(body.avg_price),
        dishes_json=json.dumps(body.dishes, ensure_ascii=False),
        recommend_tier=body.recommend_tier,
        latitude=float(body.latitude) if body.latitude is not None else None,
        longitude=float(body.longitude) if body.longitude is not None else None,
        images_json=_images_json_for_save(user.id, body.images),
        videos_json=_videos_json_for_save(user.id, body.videos),
        attachments_json=_attachments_json_for_save(user.id, body.attachments),
        content=body.content.strip()[:500],
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    return _to_out(r, user)


@router.get("/mine", response_model=list[ReviewOut])
def my_reviews(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    rows = db.query(Review).filter(Review.user_id == user.id).order_by(Review.created_at.desc()).all()
    return [_to_out(r, user) for r in rows]


@router.get("/input-tips", response_model=ReviewInputTipsOut)
def review_input_tips(
    keywords: str = Query("", max_length=96),
    city: str = Query("", max_length=32),
    _: User = Depends(get_current_user),
):
    """高德输入提示：店名输入时联想 POI（与发布时的关键字检索互补）。"""
    kw = keywords.strip()
    if not kw:
        return ReviewInputTipsOut(tips=[])
    data = _amap_input_tips(keywords=kw, city=city.strip())
    st = str(data.get("status") or "")
    if st != "1":
        info = str(data.get("info") or data.get("infocode") or "输入提示失败")
        raise HTTPException(status_code=502, detail=f"高德输入提示失败：{info}")
    return ReviewInputTipsOut(tips=_parse_input_tips(data, limit=5))


@router.post("/location-suggestions", response_model=ReviewLocationSuggestOut)
def review_location_suggestions(
    body: ReviewLocationSuggestIn,
    _: User = Depends(get_current_user),
):
    name = body.restaurant_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="店名不能为空")
    city = body.city.strip()
    district = body.district.strip()
    keywords = f"{name} {district}".strip() if district else name
    data = _amap_place_text(keywords=keywords, city=city)
    st = str(data.get("status") or "")
    if st != "1":
        info = str(data.get("info") or data.get("infocode") or "检索失败")
        raise HTTPException(status_code=502, detail=f"高德检索失败：{info}")
    suggestions = _parse_place_text_pois(data, limit=3)
    return ReviewLocationSuggestOut(suggestions=suggestions)


@router.put("/{review_id}", response_model=ReviewOut)
def update_review(
    review_id: int,
    body: ReviewCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    r = db.query(Review).filter(Review.id == review_id, Review.user_id == user.id).first()
    if not r:
        raise HTTPException(status_code=404, detail="点评不存在或无权修改")
    old_paths = set(_media_paths_for_review_row(r))
    new_json = _images_json_for_save(user.id, body.images)
    new_vjson = _videos_json_for_save(user.id, body.videos)
    new_ajson = _attachments_json_for_save(user.id, body.attachments)
    new_paths = {a.path for a in body.attachments}
    removed = [p for p in old_paths if p not in new_paths]
    if removed:
        delete_files_for_paths(removed, user.id)
    r.restaurant_name = body.restaurant_name.strip()
    r.dining_type = body.dining_type
    r.province = body.province.strip() if body.province else ""
    r.city = body.city.strip()
    r.district = body.district.strip() if body.district else ""
    r.taste_score = float(body.taste_score)
    r.service_score = float(body.service_score)
    r.environment_score = float(body.environment_score)
    r.value_score = float(body.value_score)
    r.avg_price = int(body.avg_price)
    r.dishes_json = json.dumps(body.dishes, ensure_ascii=False)
    r.recommend_tier = body.recommend_tier
    r.latitude = float(body.latitude) if body.latitude is not None else None
    r.longitude = float(body.longitude) if body.longitude is not None else None
    r.images_json = new_json
    r.videos_json = new_vjson
    r.attachments_json = new_ajson
    r.content = body.content.strip()[:500]
    db.add(r)
    db.commit()
    db.refresh(r)
    return _to_out(r, user)


@router.delete("/{review_id}", status_code=204)
def delete_review(
    review_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    r = db.query(Review).filter(Review.id == review_id, Review.user_id == user.id).first()
    if not r:
        raise HTTPException(status_code=404, detail="点评不存在或无权删除")
    all_m = _media_paths_for_review_row(r)
    if all_m:
        delete_files_for_paths(all_m, user.id)
    db.delete(r)
    db.commit()
