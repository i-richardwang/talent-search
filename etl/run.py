#!/usr/bin/env python
"""整库重建：读数据源 → 切段校验 → 写 Postgres。

表结构由 Drizzle 维护，跑之前先 `npm run db:push`。整个过程幂等，可反复跑。

    uv run python etl/run.py

数据源由 `TALENT_SOURCE` 选择，默认是仓库自带的 CSV 参考实现（读合成样例）。
"""

from __future__ import annotations

import time

import config as C
from load import load

if __name__ == "__main__":
    C.require_database_url()
    t0 = time.time()
    load(C.SOURCE)
    print(f"\n完成，用时 {time.time() - t0:.0f}s")
