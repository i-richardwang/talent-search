"""语料暂存、说法规划与发布生命周期。"""

from __future__ import annotations

import io
import unittest
from contextlib import redirect_stdout
from unittest import mock

import load as loader
from extract import EMPTY, Extraction
from load import _phrase_plan


def experience_row(
    experience_id: int,
    *,
    kind: str = "internal",
    org: str = "平台技术部",
    org_path: str = "示例科技/技术中心/平台技术部",
    title: str = "算法工程师",
    seq_l1: str = "技术",
    seq_l2: str = "算法",
    seq_l3: str = "",
    description: str = "",
) -> tuple:
    return (
        experience_id,
        kind,
        org,
        org_path,
        title,
        seq_l1,
        seq_l2,
        seq_l3,
        description,
    )


class PhrasePlanTest(unittest.TestCase):
    def test_repeated_text_has_one_phrase_and_multiple_edges(self) -> None:
        texts, links = _phrase_plan(
            [
                experience_row(1),
                experience_row(
                    2,
                    kind="external",
                    org="云枢智能",
                    org_path="",
                    seq_l1="",
                    seq_l2="",
                    description="负责推荐系统召回",
                ),
            ],
            [EMPTY, EMPTY],
        )

        self.assertEqual(
            texts,
            [
                "技术 · 算法",
                "算法工程师",
                "示例科技/技术中心/平台技术部",
                "云枢智能",
                "负责推荐系统召回",
            ],
        )
        self.assertEqual(
            links,
            [
                (1, "seq", 1, None),
                (1, "title", 2, None),
                (1, "org", 3, None),
                (2, "title", 2, None),
                (2, "org", 4, None),
                (2, "description", 5, None),
            ],
        )

    def test_empty_corpus_has_no_phrases_or_edges(self) -> None:
        self.assertEqual(_phrase_plan([], []), ([], []))

    def test_extracted_tags_share_the_phrase_table_with_raw_routes(self) -> None:
        # 能力词「算法工程师」和第 1 段的岗位名是同一串字：只嵌一次，两条边各成一条边
        texts, links = _phrase_plan(
            [
                experience_row(1),
                experience_row(
                    2,
                    kind="external",
                    org="云枢智能",
                    org_path="",
                    seq_l1="",
                    seq_l2="",
                    description="负责推荐系统召回",
                ),
            ],
            [
                EMPTY,
                Extraction(("算法工程师", "召回"), (("负责建设", "推荐系统"),)),
            ],
        )
        self.assertEqual(texts.count("算法工程师"), 1)
        # 做过的事的说法只是领域，参与方式落在边上；原文路的边那一列是 None
        self.assertEqual(texts[-2:], ["召回", "推荐系统"])
        self.assertEqual(
            [link for link in links if link[0] == 2 and link[1] in ("skill", "did")],
            [(2, "skill", 2, None), (2, "skill", 6, None), (2, "did", 7, "负责建设")],
        )


class ReloadLifecycleTest(unittest.TestCase):
    def test_imports_are_serialized_and_publish_starts_after_staging_commit(self) -> None:
        events: list[str] = []
        source = mock.MagicMock()
        source.extract.side_effect = lambda: events.append("extract") or "raw"

        connection = mock.MagicMock()
        connection.__enter__.return_value = connection
        connection.commit.side_effect = lambda: events.append("commit")
        statements: list[tuple[str, tuple | None]] = []
        cursor = mock.MagicMock()
        cursor.__enter__.return_value = cursor

        def execute(sql: str, params: tuple | None = None) -> None:
            statements.append((sql, params))
            events.append("lock")

        cursor.execute.side_effect = execute
        connection.cursor.return_value = cursor

        with (
            mock.patch.object(
                loader.C,
                "require_database_url",
                return_value="postgres://test",
            ),
            mock.patch.object(loader.psycopg, "connect", return_value=connection),
            mock.patch.object(loader, "load_source", return_value=source),
            mock.patch.object(
                loader,
                "build",
                side_effect=lambda _: events.append("build")
                or ("employees", "experiences"),
            ),
            mock.patch.object(
                loader,
                "probe",
                side_effect=lambda _: events.append("probe") or [0.1],
            ),
            mock.patch.object(loader.C, "extract_configured", return_value=True),
            mock.patch.object(loader.aliases, "read", return_value={}),
            mock.patch.object(
                loader,
                "align",
                side_effect=lambda frame: events.append("align") or frame,
            ),
            mock.patch.object(
                loader,
                "_create_staging_tables",
                side_effect=lambda *_: events.append("create staging"),
            ),
            mock.patch.object(
                loader,
                "_stage_corpus",
                side_effect=lambda *_: events.append("stage") or (3, 4, 1),
            ),
            mock.patch.object(
                loader,
                "_publish_corpus",
                side_effect=lambda *_: events.append("publish")
                or (2, [("internal", 3)]),
            ),
            redirect_stdout(io.StringIO()),
        ):
            loader.load("sample")

        # 串行化靠**会话级** advisory lock：它要跨过暂存与发布两个事务，换成
        # pg_advisory_xact_lock 或 try 版本，下面的第一次 commit 就把它松开了，
        # 两代语料会赛跑。所以这里对语句本身和锁的键较真。
        self.assertEqual(
            statements,
            [("select pg_advisory_lock(%s)", (loader.CORPUS_RELOAD_LOCK,))],
        )
        self.assertEqual(
            events,
            [
                "lock",
                "commit",
                "extract",
                "build",
                "probe",
                # 对齐是模型调用，和探端点一样落在两笔事务之间，不在任何事务里
                "align",
                "create staging",
                "commit",
                "stage",
                "commit",
                "publish",
                "commit",
            ],
        )


if __name__ == "__main__":
    unittest.main()
