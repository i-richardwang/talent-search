"""ETL 的运行配置：连哪个库、用哪个数据源、向量与抽取从哪个端点来。

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

#: 抽取端点（可选）。从这里出去的是入职前经历的岗位、公司与简历描述——和嵌入
#: 端点同一条数据边界，放内网还是公网由部署方决定。OpenAI 兼容的
#: `/chat/completions`。地址和模型名缺一个就当没配：ETL 打印说明后跳过，能力词与
#: 做过的事两路为空、入职前经历不对齐序列，检索照常可用。
#: 本地缓存按模型名和提示词键入（`chat.py`），没有单独的身份变量要维护。
EXTRACT_BASE_URL = os.environ.get("EXTRACT_BASE_URL", "").strip()
EXTRACT_MODEL = os.environ.get("EXTRACT_MODEL", "").strip()
EXTRACT_API_KEY = os.environ.get("EXTRACT_API_KEY", "").strip()
EXTRACT_TIMEOUT_S = int(os.environ.get("EXTRACT_TIMEOUT_S", "").strip() or "120")
EXTRACT_CONCURRENCY = int(os.environ.get("EXTRACT_CONCURRENCY", "").strip() or "4")
#: 输出预算按「思考轨迹也算输出」给：推理模型在第一个字符之前先烧掉几百到
#: 上千 token；给小了它在思考阶段撞上限，返回空内容而不报错。
EXTRACT_MAX_OUTPUT_TOKENS = int(
    os.environ.get("EXTRACT_MAX_OUTPUT_TOKENS", "").strip() or "4000"
)
#: 推理模型的思考开关。设了才随请求发出（`enable_thinking`，SiliconFlow 等网关认它）；
#: 不设就不发，标准 OpenAI 端点不会收到一个它不认的字段。抽取这件事不需要思考轨迹，
#: 而思考会先把输出预算烧光、返回空内容，所以带思考的模型应当设成 false。
EXTRACT_ENABLE_THINKING: bool | None = (
    None
    if not os.environ.get("EXTRACT_ENABLE_THINKING", "").strip()
    else os.environ["EXTRACT_ENABLE_THINKING"].strip().lower() == "true"
)
#: 端点不支持 `response_format: json_schema` 时设为 false，退回 json_object。
EXTRACT_STRUCTURED_OUTPUTS = (
    os.environ.get("EXTRACT_STRUCTURED_OUTPUTS", "").strip().lower() != "false"
)
#: 整理能力词写法的模型（可选，缺省就是抽取模型）。这一步只有两百来组、每组几十个字，
#: 却要在「团队培训」和「团队管理」之间划线——小模型判不动这条线，大模型在这里花不了
#: 多少钱。抽取要跑几千段，仍然用小模型。
REVIEW_MODEL = os.environ.get("REVIEW_MODEL", "").strip() or EXTRACT_MODEL
EXTRACT_CACHE_PATH = Path(
    os.environ.get("EXTRACT_CACHE_PATH", "").strip()
    or PROJECT_ROOT / ".cache" / "extractions.sqlite"
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


def extract_configured() -> bool:
    return bool(EXTRACT_BASE_URL and EXTRACT_MODEL)
