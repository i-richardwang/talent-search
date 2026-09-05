"""经历段 → 四路向量。语料侧唯一一处调用嵌入端点的地方。

**四路的原文怎么拼，是语料侧与查询侧共同的契约的一半**：查询侧嵌的是用户的
说法（「渠道运营」），语料侧嵌的是这里拼出来的字符串；两边只有用同一个模型
（`EMBED_MODEL`）才可比。拼法的定义在这里；测试夹具
（`tests/fixture.ts`）为了造语料要在 TypeScript 里再拼一遍，两侧各自对
`etl/route_texts.contract.json` 求值。改这里的拼法就要改那份契约，改完两边
一起红，不靠「记得同步」。

- `seq`：序列三级，用「 · 」连（「技术 · 算法 · 推荐」）；
- `title`：岗位名，原样；
- `org`：公司内是完整部门路径（「示例科技/技术中心/平台技术部」），入职前
  是公司名；
- `description`：简历描述，原样。

序列和岗位各嵌各的，不拼成一串：短文本的相似度最锐利，「算法」对「算法工程师」
是一回事，对「技术 · 算法 · 推荐 / 高级算法工程师」这一长串就被稀释了。

哪一路原文为空就没有那一路：不嵌空串，也不存零向量。
"""

from __future__ import annotations

import hashlib
import json
import math
import random
import sqlite3
import time
from array import array
from collections.abc import Mapping
import urllib.error
import urllib.request

import config as C

#: 一次请求送多少段。bge-m3 在 CPU 上一批几十条是延迟与吞吐的平衡点，再大只是
#: 让单次请求更容易超时。整条链路只有这一个批量：调用方把整份语料一次交给
#: `embed`，请求批量、缓存连接的寿命和进度打印都由它决定，调用方只交整份语料。
BATCH = 32

#: `route_texts` 读的字段。取数据的那一侧（`load.py` 从暂存经历表里查）照它
#: 取列，两边就不会各写一份「四路原文要哪些字段」。
ROUTE_FIELDS = (
    "kind",
    "org",
    "org_path",
    "title",
    "seq_l1",
    "seq_l2",
    "seq_l3",
    "description",
)


def route_texts(row: Mapping[str, str]) -> dict[str, str]:
    """一段经历的四路原文。空的那一路不出现在结果里。"""
    texts = {
        "seq": " · ".join(
            s for s in (row["seq_l1"], row["seq_l2"], row["seq_l3"]) if s
        ),
        "title": row["title"],
        "org": (
            row["org_path"]
            if row["kind"] == "internal" and row["org_path"]
            else row["org"]
        ),
        "description": row["description"],
    }
    return {route: text for route, text in texts.items() if text}


def embed(texts: list[str]) -> list[list[float]]:
    """按入参顺序返回向量。端点是 OpenAI 兼容的 `/embeddings`。

    同一串字永远得到同一个向量，所以先查缓存、再去重、最后才打端点：语料里
    序列名只有一百多种、岗位名几千种，逐段送过去是把同一个问题问四遍；重跑
    ETL 更是把整份语料再问一遍。缓存按（嵌入空间、模型、文本）键入，换空间
    自然失效。
    查询侧的进程内缓存（`src/server/embed.ts`）是同一个道理。

    进度只报没命中缓存的那几种：要等端点的就是它们，按总数报会让一次全命中的
    重跑看起来仍在打端点。
    """
    unique = list(dict.fromkeys(texts))
    with _cache() as cache:
        vectors = _cached(cache, unique)
        missing = [t for t in unique if t not in vectors]
        for start in range(0, len(missing), BATCH):
            chunk = missing[start : start + BATCH]
            fresh = list(zip(chunk, _request(chunk), strict=True))
            _store(cache, fresh)
            vectors.update(fresh)
            print(
                f"  已嵌入 {start + len(chunk)}/{len(missing)} 种新说法", flush=True
            )
    return [vectors[t] for t in texts]


def _cache() -> sqlite3.Connection:
    C.EMBED_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(C.EMBED_CACHE_PATH)
    conn.execute(
        "create table if not exists embedding ("
        " identity text not null, sha text not null, vec blob not null,"
        " primary key (identity, sha))"
    )
    return conn


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def _cache_key() -> str:
    return f"{C.EMBED_SPACE_ID}\x1f{C.EMBED_MODEL}"


def _cached(cache: sqlite3.Connection, texts: list[str]) -> dict[str, list[float]]:
    out: dict[str, list[float]] = {}
    by_sha = {_sha(t): t for t in texts}
    shas = list(by_sha)
    # SQLite 的绑定参数有上限，按几百个一组查
    for start in range(0, len(shas), 500):
        part = shas[start : start + 500]
        placeholders = ",".join("?" for _ in part)
        rows = cache.execute(
            f"select sha, vec from embedding where identity = ? and sha in ({placeholders})",
            [_cache_key(), *part],
        ).fetchall()
        invalid: list[tuple[str, str]] = []
        for sha, blob in rows:
            vec = array("f")
            try:
                # vec 是 not null 的 blob，读出来一定是 bytes，只可能长度不成
                # 整数个 float——那是一条写坏的缓存，删掉重嵌。
                vec.frombytes(blob)
            except ValueError:
                invalid.append((_cache_key(), sha))
                continue
            vector = vec.tolist()
            if _valid_vector(vector):
                out[by_sha[sha]] = vector
            else:
                invalid.append((_cache_key(), sha))
        cache.executemany(
            "delete from embedding where identity = ? and sha = ?", invalid
        )
    return out


def _store(cache: sqlite3.Connection, fresh: list[tuple[str, list[float]]]) -> None:
    cache.executemany(
        "insert into embedding (identity, sha, vec) values (?, ?, ?) "
        "on conflict (identity, sha) do update set vec = excluded.vec",
        [(_cache_key(), _sha(t), array("f", v).tobytes()) for t, v in fresh],
    )
    cache.commit()


#: 一次请求最多试几次，以及第一次重试前等多久（之后每次翻倍，带随机抖动）。
#: 公网端点偶发超时和 429 / 5xx 是常态，不是错误；一次抖动不该让二十分钟的
#: 灌库整个回滚。4xx 里除了限流都是我们自己的问题，重试没有意义。
ATTEMPTS = 5
BACKOFF_S = 1.0


def _request(chunk: list[str]) -> list[list[float]]:
    """一次请求，向量按送去的顺序返回；瞬时故障按指数退避重试。"""
    for attempt in range(1, ATTEMPTS + 1):
        try:
            return _post(chunk)
        except urllib.error.HTTPError as error:
            transient = error.code == 429 or error.code >= 500
            if not transient or attempt == ATTEMPTS:
                raise SystemExit(f"嵌入端点返回 HTTP {error.code}：{error.reason}") from None
            reason: str = f"HTTP {error.code}"
        except (urllib.error.URLError, TimeoutError) as error:
            if attempt == ATTEMPTS:
                raise SystemExit(f"嵌入端点不可用（{C.EMBED_BASE_URL}）：{error}") from None
            reason = str(error)
        delay = BACKOFF_S * 2 ** (attempt - 1) * (1 + random.random() * 0.5)
        print(f"  嵌入请求失败（{reason}），{delay:.0f} 秒后重试 {attempt}/{ATTEMPTS - 1}", flush=True)
        time.sleep(delay)
    raise AssertionError("unreachable")


def probe(text: str) -> list[float]:
    """绕过缓存读取端点真实输出，供语料的嵌入空间 canary 使用。"""
    return _request([text])[0]


def _valid_vector(vector: object) -> bool:
    return (
        isinstance(vector, list)
        and len(vector) == C.EMBED_DIM
        and all(
            not isinstance(value, bool)
            and isinstance(value, (int, float))
            and math.isfinite(value)
            for value in vector
        )
        and any(value != 0 for value in vector)
    )


def _post(chunk: list[str]) -> list[list[float]]:
    base = C.require_embed_base_url()
    body = json.dumps({"model": C.EMBED_MODEL, "input": chunk}).encode()
    request = urllib.request.Request(
        f"{base.rstrip('/')}/embeddings",
        data=body,
        headers={
            "content-type": "application/json",
            **(
                {"authorization": f"Bearer {C.EMBED_API_KEY}"}
                if C.EMBED_API_KEY
                else {}
            ),
        },
    )
    with urllib.request.urlopen(request, timeout=C.EMBED_TIMEOUT_S) as resp:
        payload = json.load(resp)
    try:
        data = sorted(payload["data"], key=lambda d: d["index"])
    except (KeyError, TypeError):
        raise SystemExit("嵌入端点响应缺少合法的 data 数组") from None
    if len(data) != len(chunk):
        raise SystemExit(
            f"嵌入端点返回 {len(data)} 条向量，送去的是 {len(chunk)} 条"
        )
    vectors = [d.get("embedding") for d in data]
    if any(not _valid_vector(vector) for vector in vectors):
        raise SystemExit(
            f"嵌入端点必须返回 {C.EMBED_DIM} 个有限数值且范数非零的向量"
        )
    return vectors
