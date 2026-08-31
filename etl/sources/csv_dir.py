"""参考数据源：一个目录里的三个 CSV，列名就是 `etl/contract.py` 的契约列。

它有两个作用：**契约的可执行说明**——想接自己的人事数据，最省事的路径就是从
上游导出这三张表；以及**开箱可跑**——不配任何环境变量时读仓库自带的合成样例，
`uv run python etl/run.py` 直接能把库填满。

    <TALENT_CSV_DIR>/
      employees.csv    emp_id,name,hire_date,education_level,school,recruitment
      assignments.csv  emp_id,start_date,end_date,org,org_path,title,level,
                       seq_l1,seq_l2,seq_l3[,segment_key]
      external.csv     emp_id,start_date,end_date,org,title,description,
                       company_tag,industry,nature,unemployed

日期写 `YYYY-MM-DD`，留空表示「至今」或「未知」，具体含义见契约。
`unemployed` 写 `true` / `1` / `Y` 表示待业段，留空即否。

`segment_key` 这一列可以不给：不给时按「部门 + 岗位」判定相邻段是否同一件事。
源系统里有更可靠的判据（组织 id、job code）时才需要自己填。
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

import config as C
from contract import ASSIGNMENT_COLUMNS, EMPLOYEE_COLUMNS, EXTERNAL_COLUMNS, SourceData

#: 不配 TALENT_CSV_DIR 时读的合成样例。它进版本库，因为里面没有一个真人。
SAMPLE_DIR = Path(__file__).resolve().parent / "sample"

TRUE_VALUES = {"true", "1", "y", "yes", "是"}


def _read(directory: Path, name: str, columns: list[str]) -> pd.DataFrame:
    path = directory / name
    if not path.exists():
        raise SystemExit(f"源文件缺失：{path}")
    frame = pd.read_csv(path, dtype=str, keep_default_na=False)
    frame.columns = [c.lstrip("﻿").strip() for c in frame.columns]
    for column in columns:
        if column not in frame.columns:
            frame[column] = ""
    return frame


def extract() -> SourceData:
    directory = C.env_path("TALENT_CSV_DIR") or SAMPLE_DIR
    if directory == SAMPLE_DIR:
        print("  未配置 TALENT_CSV_DIR，读取仓库自带的合成样例")
    print(f"  源目录 {directory}")

    employees = _read(directory, "employees.csv", EMPLOYEE_COLUMNS)
    assignments = _read(directory, "assignments.csv", ASSIGNMENT_COLUMNS)
    external = _read(directory, "external.csv", EXTERNAL_COLUMNS)

    # 没给 segment_key 就按「部门 + 岗位」判断相邻段是不是同一件事
    blank = assignments.segment_key.str.strip() == ""
    assignments.loc[blank, "segment_key"] = (
        assignments.org.str.strip() + "|" + assignments.title.str.strip()
    )

    external["unemployed"] = external.unemployed.str.strip().str.lower().isin(
        TRUE_VALUES
    )
    return SourceData(employees, assignments, external)
