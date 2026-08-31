"""ETL 的运行配置：连哪个库、用哪个数据源。

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


def env_path(name: str) -> Path | None:
    """读一个目录/文件路径型环境变量。适配器声明自己的路径时用它。"""
    value = os.environ.get(name, "").strip()
    return Path(value).expanduser() if value else None


def require_database_url() -> str:
    if not DB_URL:
        raise SystemExit("缺少配置：DATABASE_URL")
    return DB_URL
