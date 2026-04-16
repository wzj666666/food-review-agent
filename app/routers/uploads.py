import imghdr
import uuid
from typing import Final

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.deps import get_current_user
from app.models import User
from app.schemas import UploadedImagePath
from app.upload_paths import UPLOADS_ROOT, delete_files_for_paths, fs_path_for_url

router = APIRouter(prefix="/api/uploads", tags=["uploads"])

MAX_BYTES: Final = 10 * 1024 * 1024
MAX_VIDEO_BYTES: Final = 80 * 1024 * 1024
ALLOWED_CT: Final = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/heic",
    "image/heif",
}
CT_TO_EXT: Final = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/heic": ".heic",
    "image/heif": ".heic",
}


def _sniff_heic(data: bytes) -> bool:
    if len(data) < 12:
        return False
    if data[4:8] != b"ftyp":
        return False
    brand = data[8:16]
    return b"heic" in brand or b"heix" in brand or b"mif1" in brand or b"msf1" in brand


@router.post("/review-image")
async def upload_review_image(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    ct = (file.content_type or "").split(";")[0].strip().lower()
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=400, detail="单张图片不超过 10MB")
    kind = imghdr.what(None, h=data)
    if not kind and len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        kind = "webp"
    if not kind and len(data) >= 3 and data[:3] == b"\xff\xd8\xff":
        kind = "jpeg"
    is_heic = _sniff_heic(data)
    if is_heic:
        kind = "heic"
    if kind not in ("jpeg", "png", "gif", "webp", "heic"):
        raise HTTPException(status_code=400, detail="仅支持 JPEG、PNG、WebP、GIF、HEIC/HEIF 照片")
    kind_to_ct = {
        "jpeg": "image/jpeg",
        "png": "image/png",
        "gif": "image/gif",
        "webp": "image/webp",
        "heic": "image/heic",
    }
    if ct not in ALLOWED_CT:
        ct = kind_to_ct[kind]
    ext = CT_TO_EXT[ct]
    uid_dir = UPLOADS_ROOT / str(user.id)
    uid_dir.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}{ext}"
    out = uid_dir / name
    out.write_bytes(data)
    url_path = f"/uploads/{user.id}/{name}"
    return {"path": url_path}


def _video_magic_ok(data: bytes, ext: str) -> bool:
    if len(data) < 12:
        return False
    if ext == ".webm":
        return data[:4] == b"\x1a\x45\xdf\xa3"
    # MP4 / MOV：ISO BMFF，ftyp 在偏移 4
    if ext in (".mp4", ".mov"):
        return data[4:8] == b"ftyp"
    return False


ALLOWED_VIDEO_CT: Final = {
    "video/mp4",
    "video/webm",
    "video/quicktime",
}
VIDEO_CT_TO_EXT: Final = {
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
}


@router.post("/review-video")
async def upload_review_video(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
):
    ct = (file.content_type or "").split(";")[0].strip().lower()
    data = await file.read()
    if len(data) > MAX_VIDEO_BYTES:
        raise HTTPException(status_code=400, detail="单个视频不超过 80MB")
    if ct not in ALLOWED_VIDEO_CT:
        ct = ""
    ext = VIDEO_CT_TO_EXT.get(ct, "")
    if not ext:
        if len(data) >= 12 and data[4:8] == b"ftyp":
            ext = ".mp4"
        elif data[:4] == b"\x1a\x45\xdf\xa3":
            ext = ".webm"
        else:
            raise HTTPException(status_code=400, detail="仅支持 MP4、WebM、MOV 视频")
    if not _video_magic_ok(data, ext):
        raise HTTPException(status_code=400, detail="视频文件头校验失败，请换文件或格式重试")
    uid_dir = UPLOADS_ROOT / str(user.id)
    uid_dir.mkdir(parents=True, exist_ok=True)
    name = f"{uuid.uuid4().hex}{ext}"
    out = uid_dir / name
    out.write_bytes(data)
    url_path = f"/uploads/{user.id}/{name}"
    return {"path": url_path}


@router.post("/review-image/delete")
def delete_review_image(
    body: UploadedImagePath,
    user: User = Depends(get_current_user),
):
    loc = fs_path_for_url(body.path, user.id)
    if not loc or not loc.is_file():
        raise HTTPException(status_code=404, detail="文件不存在或无权删除")
    try:
        loc.unlink()
    except OSError as e:
        raise HTTPException(status_code=500, detail=str(e)) from e
    return {"ok": True}
