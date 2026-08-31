"""数据源适配器。一个适配器 = 一个 `extract() -> SourceData` 的模块。

**这个目录默认不进版本库**（见根 `.gitignore`）：接进来的人事数据长什么样、
字段叫什么、字典码怎么定义，本身就是一家公司的内部信息。仓库里只保留
`csv_dir` 这一份参考实现，任何新增的适配器天然是私有的——白名单式的 ignore
规则保证「忘了加 ignore」这件事不可能发生。

接自己的数据源：复制 `csv_dir.py` 改成 `sources/<你的名字>.py`，
在 `.env.local` 里设 `TALENT_SOURCE=<你的名字>`。
"""

from __future__ import annotations

from importlib import import_module
from pathlib import Path
from types import ModuleType


def available() -> list[str]:
    return sorted(
        p.stem for p in Path(__file__).parent.glob("*.py") if p.stem != "__init__"
    )


def load_source(name: str) -> ModuleType:
    try:
        module = import_module(f"sources.{name}")
    except ModuleNotFoundError as error:
        if error.name not in (f"sources.{name}", name):
            raise
        raise SystemExit(
            f"没有这个数据源：{name}\n"
            f"可用：{'、'.join(available())}\n"
            "私有适配器放在 etl/sources/ 下（不进版本库），用 TALENT_SOURCE 选中"
        ) from None
    if not hasattr(module, "extract"):
        raise SystemExit(f"数据源 {name} 没有 extract()，它不满足 etl/contract.py")
    return module
