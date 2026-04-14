import json
from typing import AsyncIterator

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.deps import get_current_user
from app.models import Review, User
from app.schemas import AIChatRequest
from app.upload_paths import parse_images_json

router = APIRouter(prefix="/api/ai", tags=["ai"])


def _vllm_headers() -> dict[str, str]:
    h: dict[str, str] = {"Content-Type": "application/json"}
    if settings.ai_api_key:
        h["Authorization"] = f"Bearer {settings.ai_api_key.strip()}"
    return h


def _vllm_payload(messages: list[dict]) -> dict:
    return {
        "model": settings.ai_model,
        "messages": messages,
        "stream": True,
        "chat_template_kwargs": {"enable_thinking": False},
    }


def _build_reviews_knowledge(db: Session) -> tuple[str, int]:
    """格式化数据库中全部点评；返回 (文本, 条数)。超长按配置截断。"""
    reviews = db.query(Review).order_by(Review.created_at.asc()).all()
    users = {u.id: u.username for u in db.query(User).all()}
    chunks: list[str] = []
    for i, r in enumerate(reviews, start=1):
        try:
            dishes = json.loads(r.dishes_json) if r.dishes_json else []
            if not isinstance(dishes, list):
                dishes = []
        except json.JSONDecodeError:
            dishes = []
        dishes_str = "、".join(str(x) for x in dishes) if dishes else "无"
        wai = "（外卖：口味与性价比为本人填写；服务/环境为参考估算）" if r.dining_type == "takeaway" else ""
        ov = round((r.taste_score + r.service_score + r.environment_score + r.value_score) / 4.0, 2)
        uname = users.get(r.user_id, "?")
        n_img = len(parse_images_json(getattr(r, "images_json", None) or "[]"))
        img_note = f"配图 {n_img} 张" if n_img else "无配图"
        block = (
            f"【{i}】店名：{r.restaurant_name} | 就餐：{r.dining_type} | 用户：@{uname}\n"
            f"地点：{(r.province or '') + r.city + (r.district or '')} | 人均：{r.avg_price} 元\n"
            f"口味 {r.taste_score} · 服务 {r.service_score} · 环境 {r.environment_score} · 性价比 {r.value_score} · 综合 {ov} {wai}\n"
            f"推荐菜：{dishes_str}\n"
            f"{img_note}\n"
            f"评价正文：{r.content}\n"
            f"记录时间：{r.created_at}"
        )
        chunks.append(block)
    full = "\n\n".join(chunks)
    n = len(reviews)
    cap = max(10_000, settings.ai_reviews_context_max_chars)
    if len(full) > cap:
        full = full[:cap] + f"\n\n...[此处已截断；记录实际共 {n} 条，下文仅展示前部]"
    return full, n


@router.post("/chat")
async def chat(
    body: AIChatRequest,
    _: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    流式转发 vLLM。每条请求将全库点评 + 人设合并为**一条**开头的 system（vLLM 要求 system 仅能在开头且通常只能一条），
    对话中去掉首条 user 之前的 assistant（如界面欢迎语）。
    """
    kb_body, n = _build_reviews_knowledge(db)
    system_kb = (
        f"以下是用户在本应用里保存的**全部店铺评价与打分**，共 **{n}** 条（多用户汇总）。"
        "请将其视为**唯一可信的店铺事实来源**：可做归纳、对比、引用店名与分数；"
        "**禁止编造**不存在的店铺、评分或评价原文；若用户问到这些记录里没有的店，自然说明「我这边没有你记过这家店」即可。\n\n"
        "--- 记录开始 ---\n\n"
        f"{kb_body}\n\n"
        "--- 记录结束 ---\n\n"
        "【人设与表达】你是亲切的中文美食小参谋，回答简洁实用；可用 Markdown（列表、加粗等）排版；"
        "不要输出思考标签或长篇内心独白。\n"
        "对用户说话时**不要**出现「数据库」「数据表」「SQLite」「上下文」「点评记录」等后台技术词；"
        "引用上述内容时用自然说法即可，如「你记过的」「大家记的那家」「记录里口味 4.x」。\n"
        "常识、百科、闲聊类问题：直接正常回答即可，**禁止**在末尾用括号写「（注：…与…无关）」「与上文店铺无关」等题外说明。\n"
        "外卖店服务/环境分项若为参考估算，用口语化表述即可，避免生硬说「系统推导」。"
    )
    dialogue = [m.model_dump() for m in body.messages if m.role in ("user", "assistant")]
    # vLLM/Qwen：只允许开头一条 system；且对话应从 user 开始（去掉界面里的欢迎 assistant）
    while dialogue and dialogue[0].get("role") == "assistant":
        dialogue.pop(0)
    if not dialogue:
        raise HTTPException(status_code=400, detail="至少需要一条用户消息")
    messages: list[dict] = [{"role": "system", "content": system_kb}, *dialogue]

    url = settings.ai_base_url.rstrip("/") + settings.ai_chat_path
    payload = _vllm_payload(messages)
    headers = _vllm_headers()

    async def gen() -> AsyncIterator[bytes]:
        async with httpx.AsyncClient(timeout=httpx.Timeout(300.0)) as client:
            req = client.build_request("POST", url, json=payload, headers=headers)
            try:
                r = await client.send(req, stream=True)
            except httpx.ConnectError as e:
                raise HTTPException(
                    status_code=503,
                    detail=f"无法连接模型服务 ({settings.ai_base_url}): {e}",
                ) from e

            try:
                if r.status_code >= 400:
                    raw = (await r.aread()).decode("utf-8", errors="replace")[:2000]
                    hint = ""
                    if r.status_code == 401:
                        hint = "（若 vLLM 启用了 --api-key，请设置 AI_API_KEY）"
                    raise HTTPException(
                        status_code=502,
                        detail=f"模型服务错误: {r.status_code} {raw}{hint}",
                    )

                async for line in r.aiter_lines():
                    if line is None:
                        continue
                    yield (line + "\n").encode("utf-8")
                    if line.strip() == "data: [DONE]":
                        break
            except (httpx.ReadError, httpx.RemoteProtocolError, httpx.StreamClosed):
                pass
            finally:
                await r.aclose()

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
