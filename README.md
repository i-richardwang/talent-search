# talent-search · 人才搜索

面向 HR 与业务负责人的人才搜索工具。它从组织内任职和入职前经历中寻找员工，并把每项匹配还原到可核对的经历证据。

- 产品目标与范围：[docs/PROJECT.md](docs/PROJECT.md)
- 开发约定：[AGENTS.md](AGENTS.md)

## 本地运行

需要 Bun 1.4+、带 pgvector 的 Postgres 17，以及嵌入和重排两个模型端点；查询理解端点可选，不配时只有关键词搜索。

```bash
docker run -d --name talent-pg \
  -e POSTGRES_USER=talent -e POSTGRES_PASSWORD=talent -e POSTGRES_DB=talent \
  -p 55434:5432 pgvector/pgvector:pg17
docker exec talent-pg psql -U talent -d talent \
  -c "create extension if not exists vector"

cp .env.example .env.local
bun install
bun run db:push
bun run sync
bun run dev
```

应用默认监听 `http://localhost:3100`。默认数据源是 `src/corpus/sources/sample/` 中的合成样例；启动后，后台任务会继续完成抽取、嵌入和词表整理。

## 数据管线

三种任务共用 `src/corpus/session.ts` 的写者锁，运行记录统一写入 `task_run`，可在 `/tasks` 查看或手动触发。持锁连接的 `application_name` 标记当前运行，任务状态按这一关联读取。

- `sync`：读取数据源，校验并切分经历，以短事务同步变更，同时刷新未结束经历的累计月数；内容未变的段保留身份和派生结果，不调用模型。
- `derive`：抽取能力词和做过的事、对齐序列、嵌入并连接经历段；仅成功段按批提交。抽取或对齐失败保留待处理，下一轮重试，本轮继续处理后面的段。
- `review`：维护能力词的同义写法、宽细归属和短说法释义。

短说法指当前仍有技能、做过的事、岗位名或序列名边的文本，范围由 `schema.ts` 的 `GLOSSED_ROUTES` 定义。释义收集、计数、标准核验和召回共用该范围；仅作为原文或部门使用的文本不读保留释义。

检索在 repeatable-read 快照中读取语料，模型调用在快照外进行。查询向量和两份召回快照必须对应同一个空间行版本，变化后重算。取事实的快照重新召回，并按完整候选文本核对分数，新说法或释义变化后重新判定。重排缓存按空间、查询词和完整候选文本的摘要识别输入，并发调用都消费第一份成功落库的值。

派生版本由提示词、模型和嵌入空间共同决定；这些输入变化后，旧结果会自动进入待处理状态。已派生段或当前短说法的释义出现不同标准时，检索明确报错，等待派生与整理统一标准后恢复。待业段只用于展示时间线，不进入检索、累计工作年限或模型派生。

语料可以从数据源重新构建。结构更新若需要重建语料，先停止应用，运行 `bun run db:push`；新表和生成列选择新建，随后运行 `bun run sync`、`bun run derive`，完成后再启动应用。

## 接入数据源

所有适配器输出 [`src/corpus/contract.ts`](src/corpus/contract.ts) 定义的 `employees`、`assignments`、`external` 和 `levels`。通用校验、切段与派生在 `src/corpus/pipeline.ts`，适配器只负责源字段转换。

职级和学历按档检索。`levels` 是职级表，写明每个职级归哪一档、档有多高，分档口径由数据源自己定；学历写契约里的五档之一（高中及以下、大专、本科、硕士、博士），源里的写法由适配器归档。筛选和「某档及以上」都按档走，职级原文只在详情里显示。

两种接入方式：

1. 按 `src/corpus/sources/sample/` 的列名导出四个 CSV，并设置 `TALENT_CSV_DIR`。
2. 实现一个导出 `extract(report): Promise<SourceData>` 的模块，并将 `TALENT_SOURCE` 设为该文件的绝对路径。

`src/corpus/sources/` 默认忽略私有适配器，只保留 `csv-dir` 与合成样例。私有模块在运行时加载，不进入 Vite 构建产物。适配器使用的 npm 包应安装在根 `package.json`，以便从项目根 `node_modules` 解析。

## 模型与数据边界

| 能力 | 接收的数据 | 失败行为 |
|---|---|---|
| 查询理解 | 用户输入、当前条件、少量筛选值，以及工具查到的人数与人才库里的写法 | 查询报错，可重试；未配置时只有关键词搜索 |
| 嵌入 | 查询词与经历说法 | 检索或派生报错 |
| 重排 | 查询词、候选说法及释义 | 检索报错 |
| 抽取与对齐 | 入职前岗位、公司和描述 | 派生记录错误，保留待处理并在下一轮重试 |
| 词表整理 | 短说法与人数 | 整理记录错误 |

姓名和工号不会发送到模型端点。嵌入、重排、抽取和对齐会接触经历内容，部署方应按数据政策选择内网或公网服务。真实员工数据、导出结果和真实验收用例不得进入版本库。

查询与语料必须属于同一嵌入空间。查询每次核对空间身份、模型、维数和 fresh canary；canary 与未缓存的查询词同批请求。派生每轮核验已有空间的 canary。模型、归一化或端点行为变化时，需要更换 `EMBED_SPACE_ID`。重排行为变化时需要更换 `RERANK_SPACE_ID`。

## 外部判定

`REVIEW_JUDGE` 决定词表整理由谁判定：

```dotenv
REVIEW_JUDGE=model      # 使用 REVIEW_MODEL，未设置时回退到 EXTRACT_MODEL
REVIEW_JUDGE=external   # 使用外部判定接口
REVIEW_JUDGE=off        # 不运行整理
REVIEW_TOKEN=...        # external 模式必需
```

外部接口使用 `Authorization: Bearer <REVIEW_TOKEN>`：

- `GET /api/review?limit=20`：返回尚未判定且未过期的 `group` 或 `gloss` 组，以及各类判定标准的身份。
- `POST /api/review`：提交一组的首份判定；请求必须原样带回 `id`、`kind` 和 `guideIdentity`。

归并判定逐词提交 `sameAs` 与 `parent`；释义判定逐词提交 `gloss`。接口只保存判定原话，整理任务在写者锁内校验并生效；它不允许直接修改词表、释义或经历边。形状错误返回 400，凭据错误返回 401，不可用或过期返回 404，重复提交返回 409。

## 配置

配置放在 `.env.local` 或运行环境中。完整示例见 [.env.example](.env.example)。

| 变量 | 必需 | 说明 |
|---|---|---|
| `DATABASE_URL` | 是 | 带 pgvector 的 Postgres 连接串 |
| `EMBED_BASE_URL` / `EMBED_MODEL` / `EMBED_SPACE_ID` | 是 | 嵌入端点、模型与空间身份 |
| `RERANK_MODEL` / `RERANK_SPACE_ID` | 是 | 重排模型与缓存空间身份 |
| `RERANK_BASE_URL` / `RERANK_API_KEY` | 否 | 默认沿用 `EMBED_*` |
| `LLM_BASE_URL` / `LLM_MODEL` | 否 | 查询理解端点与模型；不配时不能用一句话找人 |
| `EXTRACT_BASE_URL` / `EXTRACT_MODEL` | 否 | 抽取、对齐和模型整理共用的聊天端点 |
| `REVIEW_MODEL` | 否 | 整理模型，默认使用 `EXTRACT_MODEL` |
| `REVIEW_JUDGE` / `REVIEW_TOKEN` | 否 | 判定方与外部接口凭据 |
| `TALENT_SOURCE` | 否 | `csv-dir` 或私有适配器的绝对路径 |
| `TALENT_CSV_DIR` | 否 | `csv-dir` 的输入目录；默认使用合成样例 |

各端点的 API key、超时、并发、结构化输出与思考开关见 `.env.example`。`*_TIMEOUT_MS` 表示每次尝试的上限。嵌入维数只在 `src/db/schema.ts` 的 `EMBED_DIM` 定义。

## 常用命令

```bash
bun run dev          # 开发服务器
bun run sync         # 同步数据源
bun run derive       # 运行一轮派生
bun run query "算法,+后端"
bun run eval
bun run eval:extract
bun run eval:review
bun run eval:understand
bun run db:push
bun run verify       # 格式、类型、测试、生产构建
bun run ui           # 设计系统：浏览、调整设计令牌与组件，导出改动
```

`bun run test` 只从 `.env.local` 读取 `DATABASE_URL`，随后在不加载环境文件的子进程中运行。每个集成测试文件使用独立临时 schema 和进程内假模型，不会访问真实数据源或模型端点。

## 代码结构

```text
src/corpus/       数据同步、派生、词表整理与数据源契约
src/db/           Drizzle 表结构与数据库连接
src/search/       查询契约、召回、排名、分面与结果类型
src/server/       RPC、查询记录、后台任务和模型端点
src/routes/       页面、路由私有组件与交互逻辑
src/components/   跨页面产品组件与通用组件（ui/）
src/lib/          与界面无关的跨层纯函数
scripts/          命令行入口与验收工具
scripts/design-system/  设计系统：令牌、组件与产品界面的展示页（`bun run ui`）
evals/            合成验收样例；真实用例仅保存在本机
tests/            单元、渲染与 Postgres 集成测试
```

公开表结构的唯一来源是 `src/db/schema.ts`；修改后运行 `bun run db:push`。页面通过 `src/server/functions.ts` 的 RPC 访问服务端，带连接或密钥的模块必须保持 `server-only`。
