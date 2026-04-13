from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models import Review, User
from app.schemas import UserProfileUpdate, UserPublic

router = APIRouter(prefix="/api/me", tags=["me"])


@router.get("", response_model=UserPublic)
def me(user: User = Depends(get_current_user)):
    return user


@router.patch("", response_model=UserPublic)
def update_me(
    body: UserProfileUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if body.display_name is not None:
        user.display_name = body.display_name.strip() or user.username
    if body.bio is not None:
        user.bio = body.bio.strip()[:256]
    if body.city is not None:
        user.city = body.city.strip()[:32]
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@router.get("/stats")
def my_stats(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    count = db.query(func.count(Review.id)).filter(Review.user_id == user.id).scalar() or 0
    restaurants = (
        db.query(Review.restaurant_name)
        .filter(Review.user_id == user.id)
        .distinct()
        .all()
    )
    names = [r[0] for r in restaurants]
    return {
        "review_count": int(count),
        "restaurant_count": len(names),
        "restaurants": sorted(names)[:200],
    }
