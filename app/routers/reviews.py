import json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Review, User
from app.schemas import ReviewCreate, ReviewOut

router = APIRouter(prefix="/api/reviews", tags=["reviews"])


def _overall(r: Review) -> float:
    return (r.taste_score + r.service_score + r.environment_score + r.value_score) / 4.0


def _to_out(r: Review, author: User) -> ReviewOut:
    try:
        dishes = json.loads(r.dishes_json) if r.dishes_json else []
        if not isinstance(dishes, list):
            dishes = []
    except json.JSONDecodeError:
        dishes = []
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
        content=r.content,
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
    db.delete(r)
    db.commit()
