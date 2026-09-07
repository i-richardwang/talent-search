"""嵌入路由、缓存、端点重试与响应校验。"""

from __future__ import annotations

import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

import config as C
import embed as E
import endpoint

#: 四路原文的拼法契约，语料侧与测试夹具侧共用。见 `etl/route_texts.contract.json`。
CONTRACT = json.loads(
    (Path(__file__).parent / "route_texts.contract.json").read_text(encoding="utf-8")
)


def setUpModule() -> None:
    """整个模块用假的嵌入身份，不看本机有没有 .env.local。

    被测代码要的是完整的身份（`require_embed_base_url` 三个变量缺一不可），
    只补一个就等于把「本机配好了端点」当成测试的前提。
    """
    unittest.enterModuleContext(
        mock.patch.multiple(
            C,
            EMBED_BASE_URL="http://embed.test/v1",
            EMBED_MODEL="fake",
            EMBED_SPACE_ID="fake-v1",
            EMBED_DIM=2,
        )
    )


class RouteTextTest(unittest.TestCase):
    """四路原文的拼法。

    用例和期望的输出都在 `etl/route_texts.contract.json` 里，不写在这里：
    测试夹具（`tests/fixture.ts`）为了造语料也要拼一遍同样的字符串，那边是
    TypeScript，没法调这里的函数。两侧于是各自对同一份契约求值——谁改了拼法而
    另一侧没跟上，就红在同一个文件上，而不是等到夹具嵌的和 ETL 嵌的悄悄不是
    一种字符串。
    """

    def test_matches_the_contract(self) -> None:
        for case in CONTRACT["cases"]:
            with self.subTest(case["name"]):
                self.assertEqual(E.route_texts(case["row"]), case["texts"])


class EmbedCacheTest(unittest.TestCase):
    """去重与持久缓存：同一串字对同一个模型只打一次端点，跨运行也是。"""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        # `embed` 自己报进度，测试只看它送出去了什么
        self.enterContext(redirect_stdout(io.StringIO()))
        for target, attr, value in (
            (C, "EMBED_CACHE_PATH", Path(self.tmp.name) / "e.sqlite"),
            (E, "BATCH", 2),
        ):
            patcher = mock.patch.object(target, attr, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.sent: list[list[str]] = []

        def fake_request(chunk):
            self.sent.append(list(chunk))
            return [[float(len(t)), 0.5] for t in chunk]

        patcher = mock.patch.object(E, "_request", fake_request)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_same_text_is_requested_once_and_order_is_kept(self) -> None:
        out = E.embed(["算法", "运营", "算法", "深度学习", "运营"])
        self.assertEqual(out, [[2.0, 0.5], [2.0, 0.5], [2.0, 0.5], [4.0, 0.5], [2.0, 0.5]])
        self.assertEqual(self.sent, [["算法", "运营"], ["深度学习"]])

    def test_second_run_only_requests_what_the_cache_lacks(self) -> None:
        E.embed(["算法", "运营"])
        self.sent.clear()
        out = E.embed(["运营", "风控", "算法"])
        self.assertEqual(self.sent, [["风控"]])
        self.assertEqual(out, [[2.0, 0.5], [2.0, 0.5], [2.0, 0.5]])

    def test_cache_is_keyed_by_model(self) -> None:
        E.embed(["算法"])
        self.sent.clear()
        with mock.patch.object(C, "EMBED_MODEL", "another"):
            E.embed(["算法"])
        self.assertEqual(self.sent, [["算法"]])

    def test_cache_is_keyed_by_embedding_space(self) -> None:
        E.embed(["算法"])
        self.sent.clear()
        with mock.patch.object(C, "EMBED_SPACE_ID", "fake-v2"):
            E.embed(["算法"])
        self.assertEqual(self.sent, [["算法"]])

    def test_invalid_cached_vector_is_replaced(self) -> None:
        from array import array

        E.embed(["算法"])
        with E._cache() as cache:
            cache.execute(
                "update embedding set vec = ?", (array("f", [0.0, 0.0]).tobytes(),)
            )
            cache.commit()
        self.sent.clear()
        self.assertEqual(E.embed(["算法"]), [[2.0, 0.5]])
        self.assertEqual(self.sent, [["算法"]])

    def test_empty_input_does_not_hit_the_endpoint(self) -> None:
        with mock.patch.object(E, "_request", side_effect=AssertionError("打了端点")):
            self.assertEqual(E.embed([]), [])


class EmbedRetryTest(unittest.TestCase):
    def test_transient_failures_are_retried_then_succeed(self) -> None:
        calls = iter([TimeoutError("read timed out"), endpoint.urllib.error.URLError("reset"), [[1.0]]])

        def flaky(chunk):
            outcome = next(calls)
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        with mock.patch.object(E, "_post", flaky), mock.patch.object(endpoint.time, "sleep") as sleep, redirect_stdout(io.StringIO()):
            self.assertEqual(E._request(["算法"]), [[1.0]])
        self.assertEqual(sleep.call_count, 2)

    def test_client_errors_are_not_retried(self) -> None:
        error = endpoint.urllib.error.HTTPError("u", 400, "bad request", {}, None)
        with mock.patch.object(E, "_post", side_effect=error), mock.patch.object(endpoint.time, "sleep") as sleep:
            with self.assertRaises(SystemExit):
                E._request(["算法"])
        self.assertEqual(sleep.call_count, 0)

    def test_rate_limit_waits_longer_and_honors_retry_after(self) -> None:
        limited = endpoint.urllib.error.HTTPError(
            "u", 429, "too many", {"Retry-After": "45"}, None
        )
        calls = iter([limited, endpoint.urllib.error.HTTPError("u", 429, "too many", {}, None), [[1.0]]])

        def flaky(chunk):
            outcome = next(calls)
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        with mock.patch.object(E, "_post", flaky), mock.patch.object(endpoint.time, "sleep") as sleep, redirect_stdout(io.StringIO()):
            self.assertEqual(E._request(["算法"]), [[1.0]])
        waits = [call.args[0] for call in sleep.call_args_list]
        self.assertGreaterEqual(waits[0], 45)
        # 没有 Retry-After 时也按限流的起步等，不是抖动那一秒
        self.assertGreaterEqual(waits[1], endpoint.RATE_LIMIT_BACKOFF_S * 2)

    def test_connection_dropped_mid_response_is_retried(self) -> None:
        calls = iter([endpoint.http.client.RemoteDisconnected("closed"), [[1.0]]])

        def flaky(chunk):
            outcome = next(calls)
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        with mock.patch.object(E, "_post", flaky), mock.patch.object(endpoint.time, "sleep"), redirect_stdout(io.StringIO()):
            self.assertEqual(E._request(["算法"]), [[1.0]])

    def test_gives_up_after_attempts(self) -> None:
        with mock.patch.object(E, "_post", side_effect=TimeoutError()), mock.patch.object(endpoint.time, "sleep") as sleep, redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit):
                E._request(["算法"])
        self.assertEqual(sleep.call_count, endpoint.ATTEMPTS - 1)


class EmbedResponseTest(unittest.TestCase):
    def test_zero_vector_is_rejected(self) -> None:
        response = mock.MagicMock()
        response.__enter__.return_value = io.StringIO(
            json.dumps({"data": [{"index": 0, "embedding": [0.0, 0.0]}]})
        )
        with mock.patch.object(endpoint.urllib.request, "urlopen", return_value=response):
            with self.assertRaisesRegex(SystemExit, "范数非零"):
                E._post(["算法"])


if __name__ == "__main__":
    unittest.main()
