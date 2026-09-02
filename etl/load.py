"""把管线产出的两张表写入 Postgres，再把经历原文去重成说法、各嵌一个向量。

表结构由 Drizzle 维护（`npm run db:push`），这里只负责灌数据；整库幂等重灌。

**嵌入端点在写库之前就要探一次**：向量是检索的前提，灌完三万段才发现端点
没起来，等于白等一次 COPY 再从头来。
"""

from __future__ import annotations

import csv
import io
from types import SimpleNamespace

import psycopg

import config as C
from embed import embed, probe, route_texts
from pipeline import EMPLOYEE_OUT, EXPERIENCE_OUT, build
from sources import load_source

# 只有这几列允许为空；其余文本列的缺失一律写成空串，不写 NULL
NULLABLE = {"hire_date", "start_date", "end_date", "org_meta"}

#: 一次拿多少种说法去嵌入。只影响进度打印的粒度，不影响结果。
EMBED_CHUNK = 512
CANARY_TEXT = "talent-search embedding canary"

#: `route_texts` 要读的字段，和下面那条 select 的列序一致。
FIELDS = ("kind", "org", "org_path", "title", "seq_l1", "seq_l2", "seq_l3", "description")


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


def embed_phrases(cur) -> tuple[int, int]:
    """把每段经历的四路原文去重成「说法」，各嵌一次，再把段按路指向说法。
    返回（说法数，段到说法的边数）。

    读回库里的行而不是用管线的 DataFrame：边要挂在 `experience.id` 上，
    而 id 是 COPY 时才分配的。
    """
    cur.execute(f"select id, {', '.join(FIELDS)} from experience order by id")
    links: list[tuple[int, str, str]] = []
    for exp_id, *values in cur.fetchall():
        fields = SimpleNamespace(**dict(zip(FIELDS, values, strict=True)))
        for route, text in route_texts(fields).items():
            links.append((exp_id, route, text))
    texts = list(dict.fromkeys(text for _, _, text in links))

    for start in range(0, len(texts), EMBED_CHUNK):
        chunk = texts[start : start + EMBED_CHUNK]
        vectors = embed(chunk)
        buf = io.StringIO()
        writer = csv.writer(buf)
        for text, vector in zip(chunk, vectors, strict=True):
            writer.writerow([text, f"[{','.join(map(str, vector))}]"])
        buf.seek(0)
        with cur.copy("copy phrase (text, embedding) from stdin with (format csv)") as cp:
            cp.write(buf.read())
        # 进度得当场刷出去：stdout 重定向到文件时按块缓冲，不刷就是跑完前一片空白
        print(f"  已嵌入 {min(start + EMBED_CHUNK, len(texts))}/{len(texts)} 种说法", flush=True)

    cur.execute("select text, id from phrase")
    id_of = dict(cur.fetchall())
    buf = io.StringIO()
    for exp_id, route, text in links:
        buf.write(f"{exp_id},{route},{id_of[text]}\n")
    buf.seek(0)
    with cur.copy(
        "copy experience_phrase (experience_id, route, phrase_id) from stdin with (format csv)"
    ) as cp:
        cp.write(buf.read())
    return len(texts), len(links)


def load(source_name: str) -> None:
    print(f"读取数据源 {source_name}…")
    data = load_source(source_name).extract()

    print("\n切段与校验…")
    employee, experience = build(data)

    print("\n探嵌入端点…")
    canary = probe(CANARY_TEXT)
    print(
        f"  {C.EMBED_SPACE_ID} · {C.EMBED_MODEL} @ {C.EMBED_BASE_URL}，"
        f"{len(canary)} 维；缓存 {C.EMBED_CACHE_PATH}"
    )

    print("\n写入 Postgres…")
    with psycopg.connect(C.require_database_url()) as conn, conn.cursor() as cur:
        # 查询先读 embedding_space，再读其余语料表；重灌也从同一张表起锁，
        # 于是它只会等待完整查询结束，不会先锁住 phrase 再和查询互相等待。
        cur.execute("lock table embedding_space in access exclusive mode")
        # phrase 级联清掉 experience_phrase 和 phrase_relevance：重排分是对旧 id 打的
        cur.execute(
            "truncate experience, employee, phrase, embedding_space restart identity cascade"
        )
        cur.execute(
            "insert into embedding_space "
            "(space_id, model, dimension, canary_text, canary_embedding) "
            "values (%s, %s, %s, %s, %s::halfvec)",
            (
                C.EMBED_SPACE_ID,
                C.EMBED_MODEL,
                C.EMBED_DIM,
                CANARY_TEXT,
                f"[{','.join(map(str, canary))}]",
            ),
        )
        copy_frame(cur, "employee", employee, EMPLOYEE_OUT)
        copy_frame(cur, "experience", experience, EXPERIENCE_OUT)
        print("\n嵌入经历原文…")
        phrases, links = embed_phrases(cur)
        cur.execute("select count(*) from employee")
        n_emp = cur.fetchone()[0]
        cur.execute("select kind, count(*) from experience group by kind order by 1")
        rows = cur.fetchall()
        conn.commit()
    print(f"  employee {n_emp} 行")
    for kind, n in rows:
        print(f"  experience[{kind}] {n} 行")
    print(f"  phrase {phrases} 行，experience_phrase {links} 行")
