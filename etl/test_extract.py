"""抽取的收窄规则、哪些段会去问端点、缓存身份与读出时的收窄。"""

from __future__ import annotations

import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

import chat
import config as C
import extract as X


def setUpModule() -> None:
    """整个模块用假的抽取身份，不看本机有没有 .env.local。"""
    unittest.enterModuleContext(
        mock.patch.multiple(
            C,
            EXTRACT_BASE_URL="http://extract.test/v1",
            EXTRACT_MODEL="fake",
            EXTRACT_CONCURRENCY=2,
        )
    )


def external(description: str, org: str = "云枢智能", title: str = "算法工程师") -> dict[str, str]:
    return {"kind": "external", "org": org, "title": title, "description": description}


class InvolvementsTest(unittest.TestCase):
    def test_every_involvement_has_a_guide_line_in_the_prompt(self) -> None:
        self.assertTrue(X.INVOLVEMENTS)
        for involvement in X.INVOLVEMENTS:
            self.assertIn(involvement, X.SYSTEM)


class ConformTest(unittest.TestCase):
    def test_keeps_short_deduped_tags_in_order(self) -> None:
        got = X.conform(
            {"skills": ["推荐算法", " Python ", "推荐算法", "Ｐｙｔｈｏｎ"], "did": []},
            org="云枢智能",
        )
        self.assertEqual(got.skills, ("推荐算法", "Python"))

    def test_drops_company_name_and_over_long_tags(self) -> None:
        got = X.conform(
            {
                "skills": ["云枢智能", "云枢智能的推荐", "推荐", "负责推荐系统召回与排序模型的迭代和上线"],
                "did": [{"involvement": "负责建设", "domain": "云枢智能"}],
            },
            org="云枢智能",
        )
        self.assertEqual(got.skills, ("推荐",))
        self.assertEqual(got.did, ())

    def test_involvement_outside_the_enum_keeps_the_domain_without_it(self) -> None:
        got = X.conform(
            {
                "skills": [],
                "did": [
                    {"involvement": "主导", "domain": "推荐系统"},
                    {"involvement": "", "domain": "搜索系统"},
                    {"involvement": "从零搭建", "domain": "推荐系统"},
                    "not an object",
                ],
            },
            org="",
        )
        self.assertEqual(got.did, ((None, "推荐系统"), (None, "搜索系统")))

    def test_one_involvement_per_domain_keeps_the_first(self) -> None:
        # 领域就是说法，边的主键是（段、路、说法）：同一领域第二种参与方式没处落
        got = X.conform(
            {
                "skills": [],
                "did": [
                    {"involvement": "从零搭建", "domain": "推荐系统"},
                    {"involvement": "优化改进", "domain": "推荐系统"},
                    {"involvement": "优化改进", "domain": "搜索系统"},
                ],
            },
            org="",
        )
        self.assertEqual(got.did, (("从零搭建", "推荐系统"), ("优化改进", "搜索系统")))

    def test_caps_counts(self) -> None:
        got = X.conform(
            {"skills": [f"技能{i}" for i in range(30)], "did": []}, org=""
        )
        self.assertEqual(len(got.skills), X.MAX_SKILLS)

    def test_garbage_is_empty(self) -> None:
        self.assertEqual(X.conform("nope", org=""), X.EMPTY)
        self.assertEqual(X.conform({"skills": "Python"}, org=""), X.EMPTY)


class ExtractTest(unittest.TestCase):
    def setUp(self) -> None:
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.enterContext(
            mock.patch.object(C, "EXTRACT_CACHE_PATH", Path(tmp.name) / "x.sqlite")
        )

    def test_only_external_segments_with_description_are_asked(self) -> None:
        rows = [
            {"kind": "internal", "org": "平台技术部", "title": "算法工程师", "description": ""},
            external(""),
            external("负责推荐系统召回"),
        ]
        asked: list[str] = []

        def fake(model: str, system: str, schema: object, text: str, what: str) -> object:
            asked.append(text)
            return {"skills": ["召回"], "did": [{"involvement": "负责建设", "domain": "推荐系统"}]}

        with mock.patch.object(chat, "_request", fake), redirect_stdout(io.StringIO()):
            got = X.extract(rows)
        self.assertEqual(asked, ["岗位：算法工程师\n公司：云枢智能\n描述：负责推荐系统召回"])
        self.assertEqual(got[:2], [X.EMPTY, X.EMPTY])
        self.assertEqual(got[2], X.Extraction(("召回",), (("负责建设", "推荐系统"),)))

    def test_second_run_reads_the_cache_and_reconforms(self) -> None:
        rows = [external("负责推荐系统召回")]
        with mock.patch.object(
            chat, "_request", return_value={"skills": ["召回", "云枢智能"], "did": []}
        ) as request, redirect_stdout(io.StringIO()):
            X.extract(rows)
            X.extract(rows)
        self.assertEqual(request.call_count, 1)
        # 缓存里是模型原话，收窄在读出时做：改了收窄规则不必换空间 id
        with mock.patch.object(chat, "_request", side_effect=AssertionError("打了端点")), \
             mock.patch.object(X, "MAX_TAG_LEN", 1), redirect_stdout(io.StringIO()):
            self.assertEqual(X.extract(rows)[0], X.EMPTY)

    def test_changing_the_prompt_asks_again(self) -> None:
        rows = [external("负责推荐系统召回")]
        with mock.patch.object(chat, "_request", return_value={"skills": [], "did": []}) as request, \
             redirect_stdout(io.StringIO()):
            X.extract(rows)
            with mock.patch.object(X, "SYSTEM", X.SYSTEM + "\n- 再多一条规则"):
                X.extract(rows)
        self.assertEqual(request.call_count, 2)


if __name__ == "__main__":
    unittest.main()
