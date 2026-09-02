"""ETL 的运行配置：连哪个库、用哪个数据源、向量从哪个端点来。

源文件路径**不在这里**。它们属于某一套数据的形态，归各自的适配器
（`etl/sources/<name>.py`）自己声明——写在这里的话，公开仓库就得为每一个
私有数据源留一份用不上的路径常量。
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env.local")
load_dotenv(PROJECT_ROOT / ".env")

#: 适配器名，对应 `etl/sources/<name>.py`。默认是仓库自带的 CSV 参考实现。
SOURCE = os.environ.get("TALENT_SOURCE", "").strip() or "csv_dir"

DB_URL = os.environ.get("DATABASE_URL", "").strip()

#: 嵌入端点。从这里出去的是每个人的经历原文——放内网还是公网由部署方决定。
#: 查询侧（`src/server/embed.ts`）读同一组变量：两侧必须属于同一个嵌入空间；
#: ETL 会把身份与 canary 落库，查询进程首次嵌入前核验。
EMBED_BASE_URL = os.environ.get("EMBED_BASE_URL", "").strip()
EMBED_MODEL = os.environ.get("EMBED_MODEL", "").strip()
EMBED_SPACE_ID = os.environ.get("EMBED_SPACE_ID", "").strip()
EMBED_DIM = int(os.environ.get("EMBED_DIM", "").strip() or "1024")
EMBED_API_KEY = os.environ.get("EMBED_API_KEY", "").strip()
EMBED_TIMEOUT_S = int(os.environ.get("EMBED_TIMEOUT_S", "").strip() or "120")
#: 向量的本地缓存（SQLite）。同一个模型对同一串字的向量是确定的，所以它可以
#: 永久留着：重置 Postgres、重跑 ETL 都不必再打一遍端点。放在项目下的
#: `.cache/`，不进版本库，也不放在 Postgres 里——重置库就是要清库，缓存不能跟着死。
EMBED_CACHE_PATH = Path(
    os.environ.get("EMBED_CACHE_PATH", "").strip()
    or PROJECT_ROOT / ".cache" / "embeddings.sqlite"
).expanduser()


def env_path(name: str) -> Path | None:
    """读一个目录/文件路径型环境变量。适配器声明自己的路径时用它。"""
    value = os.environ.get(name, "").strip()
    return Path(value).expanduser() if value else None


def require_database_url() -> str:
    if not DB_URL:
        raise SystemExit("缺少配置：DATABASE_URL")
    return DB_URL


def require_embed_base_url() -> str:
    if not EMBED_BASE_URL or not EMBED_MODEL or not EMBED_SPACE_ID:
        raise SystemExit(
            "缺少配置：EMBED_BASE_URL、EMBED_MODEL 与 EMBED_SPACE_ID（见 .env.example）"
        )
    return EMBED_BASE_URL
