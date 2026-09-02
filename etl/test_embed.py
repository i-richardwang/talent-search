"""嵌入路由、缓存、端点重试与响应校验。"""

from __future__ import annotations

import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest import mock


class RouteTextTest(unittest.TestCase):
    """四路原文的拼法。`tests/fixture.ts` 的 `routeTexts` 照抄这里，改一处改两处。"""

    def row(self, **over):
        base = {
            "kind": "internal",
            "org": "平台技术部",
            "org_path": "示例科技/技术中心/平台技术部",
            "title": "算法工程师",
            "seq_l1": "技术",
            "seq_l2": "算法",
            "seq_l3": "",
            "description": "",
        }
        return SimpleNamespace(**{**base, **over})

    def test_internal_uses_org_path_and_joins_seq_levels(self):
        from embed import route_texts

        self.assertEqual(
            route_texts(self.row()),
            {
                "seq": "技术 · 算法",
                "title": "算法工程师",
                "org": "示例科技/技术中心/平台技术部",
            },
        )

    def test_external_uses_company_name_and_description(self):
        from embed import route_texts

        texts = route_texts(
            self.row(
                kind="external",
                org="云枢智能",
                org_path="",
                seq_l1="",
                seq_l2="",
                description="负责推荐系统召回",
            )
        )
        self.assertEqual(
            texts,
            {"title": "算法工程师", "org": "云枢智能", "description": "负责推荐系统召回"},
        )

    def test_empty_routes_are_absent_not_empty_strings(self):
        from embed import route_texts

        self.assertEqual(
            route_texts(self.row(org="", org_path="", title="", seq_l1="", seq_l2="")),
            {},
        )


class EmbedCacheTest(unittest.TestCase):
    """去重与持久缓存：同一串字对同一个模型只打一次端点，跨运行也是。"""

    def setUp(self):
        import config as C
        import embed as E

        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        for target, attr, value in (
            (C, "EMBED_CACHE_PATH", Path(self.tmp.name) / "e.sqlite"),
            (C, "EMBED_MODEL", "fake"),
            (C, "EMBED_SPACE_ID", "fake-v1"),
            (C, "EMBED_DIM", 2),
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

    def test_same_text_is_requested_once_and_order_is_kept(self):
        import embed as E

        out = E.embed(["算法", "运营", "算法", "深度学习", "运营"])
        self.assertEqual(out, [[2.0, 0.5], [2.0, 0.5], [2.0, 0.5], [4.0, 0.5], [2.0, 0.5]])
        self.assertEqual(self.sent, [["算法", "运营"], ["深度学习"]])

    def test_second_run_only_requests_what_the_cache_lacks(self):
        import embed as E

        E.embed(["算法", "运营"])
        self.sent.clear()
        out = E.embed(["运营", "风控", "算法"])
        self.assertEqual(self.sent, [["风控"]])
        self.assertEqual(out, [[2.0, 0.5], [2.0, 0.5], [2.0, 0.5]])

    def test_cache_is_keyed_by_model(self):
        import config as C
        import embed as E

        E.embed(["算法"])
        self.sent.clear()
        with mock.patch.object(C, "EMBED_MODEL", "another"):
            E.embed(["算法"])
        self.assertEqual(self.sent, [["算法"]])

    def test_cache_is_keyed_by_embedding_space(self):
        import config as C
        import embed as E

        E.embed(["算法"])
        self.sent.clear()
        with mock.patch.object(C, "EMBED_SPACE_ID", "fake-v2"):
            E.embed(["算法"])
        self.assertEqual(self.sent, [["算法"]])

    def test_invalid_cached_vector_is_replaced(self):
        from array import array

        import embed as E

        E.embed(["算法"])
        with E._cache() as cache:
            cache.execute(
                "update embedding set vec = ?", (array("f", [0.0, 0.0]).tobytes(),)
            )
            cache.commit()
        self.sent.clear()
        self.assertEqual(E.embed(["算法"]), [[2.0, 0.5]])
        self.assertEqual(self.sent, [["算法"]])

    def test_empty_input_does_not_hit_the_endpoint(self):
        import embed as E

        with mock.patch.object(E, "_request", side_effect=AssertionError("打了端点")):
            self.assertEqual(E.embed([]), [])


class EmbedRetryTest(unittest.TestCase):
    def test_transient_failures_are_retried_then_succeed(self):
        import embed as E

        calls = iter([TimeoutError("read timed out"), E.urllib.error.URLError("reset"), [[1.0]]])

        def flaky(chunk):
            outcome = next(calls)
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        with mock.patch.object(E, "_post", flaky), mock.patch.object(E.time, "sleep") as sleep, redirect_stdout(io.StringIO()):
            self.assertEqual(E._request(["算法"]), [[1.0]])
        self.assertEqual(sleep.call_count, 2)

    def test_client_errors_are_not_retried(self):
        import embed as E

        error = E.urllib.error.HTTPError("u", 400, "bad request", {}, None)
        with mock.patch.object(E, "_post", side_effect=error), mock.patch.object(E.time, "sleep") as sleep:
            with self.assertRaises(SystemExit):
                E._request(["算法"])
        self.assertEqual(sleep.call_count, 0)

    def test_gives_up_after_attempts(self):
        import embed as E

        with mock.patch.object(E, "_post", side_effect=TimeoutError()), mock.patch.object(E.time, "sleep") as sleep, redirect_stdout(io.StringIO()):
            with self.assertRaises(SystemExit):
                E._request(["算法"])
        self.assertEqual(sleep.call_count, E.ATTEMPTS - 1)


class EmbedResponseTest(unittest.TestCase):
    def test_zero_vector_is_rejected(self):
        import config as C
        import embed as E

        response = mock.MagicMock()
        response.__enter__.return_value = io.StringIO(
            json.dumps({"data": [{"index": 0, "embedding": [0.0, 0.0]}]})
        )
        with (
            mock.patch.object(C, "EMBED_BASE_URL", "http://embed.test/v1"),
            mock.patch.object(C, "EMBED_DIM", 2),
            mock.patch.object(E.urllib.request, "urlopen", return_value=response),
        ):
            with self.assertRaisesRegex(SystemExit, "范数非零"):
                E._post(["算法"])


if __name__ == "__main__":
    unittest.main()
