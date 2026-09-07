"""把完整语料准备在连接私有的暂存表中，再原子发布到 Postgres。

表结构由 Drizzle 维护（`npm run db:push`），这里只负责整库幂等重灌。嵌入和
校验发生在公开语料之外；只有最终发布会短暂挡住检索，因此端点延迟或失败不会
让正在服务的语料变成空库，也不会让读者等待整轮嵌入。
"""

from __future__ import annotations

import csv
import io

import pandas as pd
import psycopg

import config as C
from align import align
from embed import ROUTE_FIELDS, embed, probe, route_texts
from extract import EMPTY, Extraction, extract
from pipeline import EMPLOYEE_OUT, EXPERIENCE_OUT, build
from sources import load_source

# 只有这几列允许为空；其余文本列的缺失一律写成空串，不写 NULL
NULLABLE = {"hire_date", "start_date", "end_date", "org_meta"}

# 同一数据库一次只准备一版语料；会话锁跨过暂存与发布两个事务。
CORPUS_RELOAD_LOCK = int.from_bytes(b"talent", "big")

CANARY_TEXT = "talent-search embedding canary"

STAGED_EMPLOYEE = "staged_employee"
STAGED_EXPERIENCE = "staged_experience"
STAGED_PHRASE = "staged_phrase"
STAGED_LINK = "staged_experience_phrase"


def _copy_frame(
    cur: psycopg.Cursor, table: str, df: pd.DataFrame, cols: list[str]
) -> None:
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


def _phrase_plan(
    rows: list[tuple], extractions: list[Extraction]
) -> tuple[list[str], list[tuple[int, str, int, str | None]]]:
    """把经历行规划成稳定去重的说法和指向说法 id 的边。

    抽取的两路和原文四路进同一张说法表：一个能力词恰好和某个岗位名是同一串字
    时只嵌一次，两条边各指向它。做过的事的说法是领域，参与方式落在边的第四列，
    其余路那一列是 None。
    """
    raw_links: list[tuple[int, str, str, str | None]] = []
    for (exp_id, *values), extraction in zip(rows, extractions, strict=True):
        fields = dict(zip(ROUTE_FIELDS, values, strict=True))
        for route, text in route_texts(fields).items():
            raw_links.append((exp_id, route, text, None))
        for skill in extraction.skills:
            raw_links.append((exp_id, "skill", skill, None))
        for involvement, domain in extraction.did:
            raw_links.append((exp_id, "did", domain, involvement))

    texts = list(dict.fromkeys(text for _, _, text, _ in raw_links))
    id_of = {text: phrase_id for phrase_id, text in enumerate(texts, start=1)}
    links = [
        (exp_id, route, id_of[text], involvement)
        for exp_id, route, text, involvement in raw_links
    ]
    return texts, links


def _stage_phrases(cur: psycopg.Cursor) -> tuple[int, int, int]:
    """嵌入暂存经历的原文四路与抽取两路，返回（说法数，边数，抽出说法的段数）。

    整份语料一次交给 `extract` 和 `embed`：批量、缓存与进度是它们的事，这里只管
    把结果写进暂存表——在外面再切一层批就等于同一件事有两个尺寸。
    """
    cur.execute(
        f"select id, {', '.join(ROUTE_FIELDS)} from {STAGED_EXPERIENCE} order by id"
    )
    rows = cur.fetchall()
    extractions = (
        extract([dict(zip(ROUTE_FIELDS, values, strict=True)) for _, *values in rows])
        if C.extract_configured()
        else [EMPTY] * len(rows)
    )
    texts, links = _phrase_plan(rows, extractions)

    vectors = embed(texts)
    buf = io.StringIO()
    writer = csv.writer(buf)
    for phrase_id, (text, vector) in enumerate(
        zip(texts, vectors, strict=True), start=1
    ):
        writer.writerow([phrase_id, text, f"[{','.join(map(str, vector))}]"])
    buf.seek(0)
    with cur.copy(
        f"copy {STAGED_PHRASE} (id, text, embedding) from stdin with (format csv)"
    ) as cp:
        cp.write(buf.read())

    buf = io.StringIO()
    writer = csv.writer(buf)
    # 没有参与方式的边写 \N：CSV 里的空字段是空串，不是 NULL
    writer.writerows(
        (exp_id, route, phrase_id, involvement if involvement is not None else "\\N")
        for exp_id, route, phrase_id, involvement in links
    )
    buf.seek(0)
    with cur.copy(
        f"copy {STAGED_LINK} (experience_id, route, phrase_id, involvement) "
        r"from stdin with (format csv, null '\N')"
    ) as cp:
        cp.write(buf.read())
    return len(texts), len(links), sum(1 for e in extractions if e != EMPTY)


def _create_staging_tables(cur: psycopg.Cursor) -> None:
    for staged, public in (
        (STAGED_EMPLOYEE, "employee"),
        (STAGED_EXPERIENCE, "experience"),
        (STAGED_PHRASE, "phrase"),
        (STAGED_LINK, "experience_phrase"),
    ):
        cur.execute(
            f"create temp table {staged} (like {public}) on commit preserve rows"
        )


def _stage_corpus(
    cur: psycopg.Cursor, employee: pd.DataFrame, experience: pd.DataFrame
) -> tuple[int, int, int]:
    _copy_frame(cur, STAGED_EMPLOYEE, employee, EMPLOYEE_OUT)
    staged_experience = experience.assign(id=range(1, len(experience) + 1))
    _copy_frame(cur, STAGED_EXPERIENCE, staged_experience, ["id", *EXPERIENCE_OUT])
    return _stage_phrases(cur)


def _reset_identity(cur: psycopg.Cursor, table: str) -> None:
    cur.execute(
        f"""
        select setval(
          pg_get_serial_sequence('{table}', 'id')::regclass,
          coalesce((select max(id) from {table}), 1),
          exists(select 1 from {table})
        )
        """
    )


def _publish_corpus(
    cur: psycopg.Cursor, canary: list[float]
) -> tuple[int, list[tuple[str, int]]]:
    # 检索先锁 embedding_space 再读语料；发布沿用同一顺序，等待已有读者结束后
    # 一次替换完整代际，不会形成跨表锁环。
    cur.execute("lock table embedding_space in access exclusive mode")
    cur.execute(
        "truncate experience, employee, phrase, embedding_space restart identity cascade"
    )

    for public, staged, cols in (
        ("employee", STAGED_EMPLOYEE, EMPLOYEE_OUT),
        ("experience", STAGED_EXPERIENCE, ["id", *EXPERIENCE_OUT]),
        ("phrase", STAGED_PHRASE, ["id", "text", "embedding"]),
        (
            "experience_phrase",
            STAGED_LINK,
            ["experience_id", "route", "phrase_id", "involvement"],
        ),
    ):
        collist = ", ".join(cols)
        cur.execute(
            f"insert into {public} ({collist}) select {collist} from {staged}"
        )

    _reset_identity(cur, "experience")
    _reset_identity(cur, "phrase")
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

    cur.execute("select count(*) from employee")
    employee_count = cur.fetchone()[0]
    cur.execute("select kind, count(*) from experience group by kind order by 1")
    return employee_count, cur.fetchall()


def load(source_name: str) -> None:
    print(f"读取数据源 {source_name}…")
    with psycopg.connect(C.require_database_url()) as conn, conn.cursor() as cur:
        cur.execute("select pg_advisory_lock(%s)", (CORPUS_RELOAD_LOCK,))
        # 会话锁跨事务保留；先结束取得锁时开启的事务，避免在读取数据源和调用
        # 模型期间留下一个 idle in transaction 的数据库会话。
        conn.commit()

        data = load_source(source_name).extract()

        print("\n切段与校验…")
        employee, experience = build(data)

        print("\n探嵌入端点…")
        canary = probe(CANARY_TEXT)
        print(
            f"  {C.EMBED_SPACE_ID} · {C.EMBED_MODEL} @ {C.EMBED_BASE_URL}，"
            f"{len(canary)} 维；缓存 {C.EMBED_CACHE_PATH}"
        )
        if C.extract_configured():
            print(
                f"\n抽取端点 {C.EXTRACT_SPACE_ID} · {C.EXTRACT_MODEL} @ {C.EXTRACT_BASE_URL}；"
                f"缓存 {C.EXTRACT_CACHE_PATH}"
            )
            print("\n入职前经历对齐公司序列…")
            experience = align(experience)
        else:
            # 打印说明后跳过，不静默：检索仍然可用，但「为什么简历里写了却搜不到
            # 能力词」「为什么按序列筛不到入职前的经历」得有地方看见。
            print(
                "\n未配置抽取端点（EXTRACT_BASE_URL / EXTRACT_MODEL / EXTRACT_SPACE_ID），"
                "能力词与做过的事两路为空，入职前经历不对齐序列"
            )

        print("\n准备语料…")
        _create_staging_tables(cur)
        # LIKE 公开表只为取得列定义；单独结束这笔短事务，不把它取得的表锁
        # 带进后面的模型调用。
        conn.commit()
        phrase_count, link_count, extracted_count = _stage_corpus(
            cur, employee, experience
        )
        # 暂存行按 preserve rows 跨事务保留，发布事务只包含本地 INSERT，
        # 不夹带任何模型调用。
        conn.commit()

        print("\n发布语料…")
        employee_count, experience_counts = _publish_corpus(cur, canary)
        conn.commit()

    print(f"  employee {employee_count} 行")
    for kind, count in experience_counts:
        print(f"  experience[{kind}] {count} 行")
    print(
        f"  phrase {phrase_count} 行，experience_phrase {link_count} 行，"
        f"其中 {extracted_count} 段抽出了能力词或做过的事"
    )
