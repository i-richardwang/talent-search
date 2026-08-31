"""把管线产出的两张表写入 Postgres。

表结构由 Drizzle 维护（`npm run db:push`），这里只负责灌数据；整库幂等重灌。
"""

from __future__ import annotations

import io

import psycopg

import config as C
from pipeline import EMPLOYEE_OUT, EXPERIENCE_OUT, build
from sources import load_source

# 只有这几列允许为空；其余文本列的缺失一律写成空串，不写 NULL
NULLABLE = {"hire_date", "start_date", "end_date", "org_meta"}


def copy_frame(cur, table: str, df, cols: list[str]) -> None:
    out = df[cols].copy()
    for col in cols:
        if col not in NULLABLE:
            out[col] = out[col].fillna("")
    buf = io.StringIO()
    # 用 \N 表示 NULL：CSV 里的空字段就是空串，不会被误当成 NULL
    out.to_csv(buf, index=False, header=False, na_rep="\\N")
    buf.seek(0)
    collist = ", ".join(cols)
    with cur.copy(
        rf"copy {table} ({collist}) from stdin with (format csv, null '\N')"
    ) as cp:
        cp.write(buf.read())


def load(source_name: str) -> None:
    print(f"读取数据源 {source_name}…")
    data = load_source(source_name).extract()

    print("\n切段与校验…")
    employee, experience = build(data)

    print("\n写入 Postgres…")
    with psycopg.connect(C.require_database_url()) as conn, conn.cursor() as cur:
        cur.execute("truncate experience, employee restart identity cascade")
        copy_frame(cur, "employee", employee, EMPLOYEE_OUT)
        copy_frame(cur, "experience", experience, EXPERIENCE_OUT)
        conn.commit()

        cur.execute("select count(*) from employee")
        n_emp = cur.fetchone()[0]
        cur.execute("select kind, count(*) from experience group by kind order by 1")
        rows = cur.fetchall()
    print(f"  employee {n_emp} 行")
    for kind, n in rows:
        print(f"  experience[{kind}] {n} 行")
