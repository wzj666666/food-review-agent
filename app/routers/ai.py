from typing import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessage, HumanMessage

from app.agent import iter_amap_advisor_sse
from app.deps import get_current_user
from app.models import User
from app.schemas import AIChatRequest

router = APIRouter(prefix="/api/ai", tags=["ai"])

_MAX_CHAT_ROUNDS = 8


def _body_to_lc_messages(body: AIChatRequest) -> list[AIMessage | HumanMessage]:
    """参谋对话 → LangChain 消息；丢弃 system；去掉开头的 assistant（欢迎语）；最多保留最近 8 轮（以用户消息计）。"""
    out: list[AIMessage | HumanMessage] = []
    for m in body.messages:
        if m.role == "user":
            out.append(HumanMessage(content=(m.content or "").strip()))
        elif m.role == "assistant":
            out.append(AIMessage(content=(m.content or "").strip()))
    while out and isinstance(out[0], AIMessage):
        out.pop(0)
    human_ix = [i for i, msg in enumerate(out) if isinstance(msg, HumanMessage)]
    if len(human_ix) > _MAX_CHAT_ROUNDS:
        out = out[human_ix[-_MAX_CHAT_ROUNDS] :]
    return out


@router.post("/chat")
async def chat(
    body: AIChatRequest,
    _: User = Depends(get_current_user),
):
    """
    参谋页：高德地图 Agent，SSE 流式。
    与 OpenAI 兼容：`data: {"choices":[{"delta":{"content":"..."}}]}`。
    """
    lc_messages = _body_to_lc_messages(body)
    if not lc_messages:
        raise HTTPException(status_code=400, detail="至少需要一条用户消息")

    async def gen() -> AsyncIterator[bytes]:
        async for chunk in iter_amap_advisor_sse(lc_messages):
            yield chunk

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
