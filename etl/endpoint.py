"""语料侧两处模型调用（嵌入、抽取）共用的那一小段：发一个 JSON 请求，瞬时故障重试。

端点的**响应长什么样、怎么校验**不在这里——嵌入要的是向量、抽取要的是一份
JSON，各归各的模块。这里只有两件对两个端点都成立的事：怎么带鉴权发 POST，
以及哪些失败值得再试一次。
"""

from __future__ import annotations

import json
import random
import time
import urllib.error
import urllib.request
from collections.abc import Callable

#: 一次请求最多试几次，以及瞬时故障第一次重试前等多久（`_backoff`）。
#: 公网端点偶发超时和 5xx 是常态，不是错误；一次抖动不该让二十分钟的
#: 灌库整个回滚。4xx 里除了限流都是我们自己的问题，重试没有意义。
ATTEMPTS = 5
BACKOFF_S = 1.0
#: 限流（429）不是抖动，是按分钟计的配额用完了：一秒后再问只会再撞一次。
#: 从这个数起翻倍，四次重试合计两分多钟，够一个配额窗口过去；端点给了
#: Retry-After 就按它说的等。持续限流仍然会耗尽重试而退出——那是并发调太高，
#: 该改 `EXTRACT_CONCURRENCY`，不该由重试掩盖。
RATE_LIMIT_BACKOFF_S = 10.0


def post_json(url: str, body: object, api_key: str, timeout_s: int) -> object:
    """带可选 Bearer 鉴权的 JSON POST，返回解析后的响应体。HTTP 错误原样抛出。"""
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={
            "content-type": "application/json",
            **({"authorization": f"Bearer {api_key}"} if api_key else {}),
        },
    )
    with urllib.request.urlopen(request, timeout=timeout_s) as resp:
        return json.load(resp)


def retrying[T](what: str, where: str, once: Callable[[], T]) -> T:
    """执行 `once`，瞬时故障按指数退避重试；耗尽或遇到非瞬时错误就报错退出。

    `what` 是端点在报错里的名字（「嵌入」「抽取」），`where` 是它的地址。
    """
    for attempt in range(1, ATTEMPTS + 1):
        try:
            return once()
        except urllib.error.HTTPError as error:
            transient = error.code == 429 or error.code >= 500
            if not transient or attempt == ATTEMPTS:
                raise SystemExit(
                    f"{what}端点返回 HTTP {error.code}：{error.reason}"
                ) from None
            reason: str = f"HTTP {error.code}"
            delay = (
                max(_retry_after(error), _backoff(RATE_LIMIT_BACKOFF_S, attempt))
                if error.code == 429
                else _backoff(BACKOFF_S, attempt)
            )
        except (urllib.error.URLError, TimeoutError) as error:
            if attempt == ATTEMPTS:
                raise SystemExit(f"{what}端点不可用（{where}）：{error}") from None
            reason = str(error)
            delay = _backoff(BACKOFF_S, attempt)
        print(
            f"  {what}请求失败（{reason}），{delay:.0f} 秒后重试 {attempt}/{ATTEMPTS - 1}",
            flush=True,
        )
        time.sleep(delay)
    raise AssertionError("unreachable")


def _backoff(base: float, attempt: int) -> float:
    """第 `attempt` 次重试前等多久：从 `base` 起每次翻倍，带随机抖动。"""
    return base * 2 ** (attempt - 1) * (1 + random.random() * 0.5)


def _retry_after(error: urllib.error.HTTPError) -> float:
    """端点在 Retry-After 里说的秒数；没说或说得不是数就是 0。"""
    try:
        return float(error.headers.get("Retry-After", ""))
    except (TypeError, ValueError):
        return 0.0
