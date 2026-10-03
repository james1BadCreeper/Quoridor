"""FastAPI 请求/响应模型。"""
from __future__ import annotations

from typing import Any, Literal
from pydantic import BaseModel, Field


class CreateGameRequest(BaseModel):
    playerTypes: list[Literal["human", "ai"]] = Field(default_factory=lambda: ["human", "human"])
    aiIds: list[str | None] = Field(default_factory=lambda: [None, None])
    names: list[str] | None = None


class DoMoveRequest(BaseModel):
    move: dict[str, Any]


class AiMoveRequest(BaseModel):
    timeout: float = 2.0


class ReplayRequest(BaseModel):
    record: dict[str, Any]
