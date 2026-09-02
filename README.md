# talent-search · 人才搜索

面向 HR 与业务负责人的人才搜索工具。它从组织内任职和入职前工作经历中寻找员工，并把每项匹配还原到可核对的经历证据。

- 产品目标与范围：[docs/PROJECT.md](docs/PROJECT.md)
- 工程约束：[AGENTS.md](AGENTS.md)

## 本地运行

需要 Node.js 22、uv、装了 [pgvector](https://github.com/pgvector/pgvector) 的 Postgres 17，
以及两个模型端点：OpenAI 兼容的嵌入（`/embeddings`，`BAAI/bge-m3`）和 Cohere 式的
重排（`/rerank`，`BAAI/bge-reranker-v2-m3`）。内网自建或公网服务均可，同一家服务商通常两个都有。

```bash
docker run -d --name talent-pg \
  -e POSTGRES_USER=talent -e POSTGRES_PASSWORD=talent -e POSTGRES_DB=talent \
  -p 55434:5432 pgvector/pgvector:pg17
docker exec talent-pg psql -U talent -d talent \
  -c "create extension if not exists vector"

cp .env.example .env.local
# 用上面这条 docker 命令的话数据库不用改；EMBED_* / RERANK_* 指向你的模型端点

npm install
uv sync
npm run db:push
uv run python etl/run.py   # 不配数据源时导入仓库自带的合成样例；会把每段经历送去嵌入
npm run dev
```

嵌入端点会收到每个人的经历原文，建议放在本地或内网；用公网服务意味着把经历交给第三方，
这是部署方按数据政策做的决定。ETL 和查询侧用同一组
`EMBED_*` 配置。ETL 会把空间身份、模型、维数和一条 canary 向量写进数据库；查询进程首次
嵌入前会同时核对配置与端点实际输出，不一致就拒绝检索。模型、权重或归一化方式变化时，
更换 `EMBED_SPACE_ID` 并重跑 ETL。向量按（空间、模型、文本）缓存在本地 `.cache/` 里。

应用默认监听 `http://localhost:3100`。

首次导入落进去的是 `etl/sources/sample/` 里的二十个人——全部是编的，与任何真实组织无关。它存在只为让检索、排序和界面立刻有东西可看。

## 接入自己的数据

ETL 分成两层，接数据只碰下面那一层：

- **管线**（`etl/pipeline.py`）不认任何一家公司的字段名。它只做「无论数据从哪来都必须做」的事：区间校验、开放区间封口、相邻段合并、时长与当前信息派生；
- **适配器**（`etl/sources/<name>.py`）把某一套人事数据翻译成 [`etl/contract.py`](etl/contract.py) 定义的三张表：`employees`（人群与档案）、`assignments`（组织内任职段）、`external`（入职前经历）。

两条路：

1. **导出三个 CSV**。列名照 `etl/contract.py` 写，把 `TALENT_CSV_DIR` 指向那个目录即可，不必写代码。格式见 [`etl/sources/csv_dir.py`](etl/sources/csv_dir.py)；
2. **写一个适配器**。复制 `csv_dir.py` 改成 `sources/<你的名字>.py`，实现 `extract() -> SourceData`，在 `.env.local` 里设 `TALENT_SOURCE=<你的名字>`。

`etl/sources/` 默认不进版本库（`csv_dir` 和样例除外）：表名、字段名、字典码、人群口径本身就是一家组织的内部信息。规则是白名单式的，新写一个适配器天然是私有的。

## 配置

配置只放在 `.env.local` 或环境变量中，不进入版本库。

| 变量 | 必需 | 说明 |
|---|---|---|
| `DATABASE_URL` | 是 | Postgres 连接串，库里须有 `vector` 扩展 |
| `EMBED_BASE_URL` | 是 | OpenAI 兼容的嵌入端点；经历原文会送到这里 |
| `EMBED_MODEL` | 是 | 嵌入模型名，ETL 与查询侧必须一致 |
| `EMBED_SPACE_ID` | 是 | 嵌入空间的稳定身份；模型行为变化时换值并重跑 ETL |
| `EMBED_DIM` | 是 | 向量维数，须与 `src/db/schema.ts` 一致，默认 1024 |
| `EMBED_API_KEY` | 否 | 端点需要鉴权时填写 |
| `EMBED_TIMEOUT_S` | 否 | ETL 单次嵌入请求的超时，默认 120 |
| `EMBED_TIMEOUT_MS` | 否 | 查询侧嵌入请求的超时，默认 30000 |
| `EMBED_CACHE_PATH` | 否 | ETL 的向量缓存（SQLite），默认 `.cache/embeddings.sqlite` |
| `RERANK_MODEL` | 是 | 重排模型名；命中由它判定 |
| `RERANK_SPACE_ID` | 是 | 重排空间的稳定身份；缓存按它隔离 |
| `RERANK_BASE_URL` / `RERANK_API_KEY` | 否 | 重排端点与密钥，默认沿用 `EMBED_*` |
| `RERANK_TIMEOUT_MS` / `RERANK_CONCURRENCY` | 否 | 重排超时与最大并发，默认 30000 / 4 |
| `TALENT_SOURCE` | 否 | 数据源适配器名，默认 `csv_dir` |
| `TALENT_CSV_DIR` | 否 | `csv_dir` 的源目录，默认读仓库自带的合成样例 |
| `LLM_BASE_URL` | 否 | OpenAI 兼容端点；未配置时使用本地规则解析 |
| `LLM_MODEL` | 否 | 查询理解模型名 |
| `LLM_API_KEY` | 否 | 端点需要鉴权时填写 |
| `LLM_STRUCTURED_OUTPUTS` | 否 | 端点不支持 JSON Schema 时设为 `false` |
| `LLM_TIMEOUT_MS` / `LLM_MAX_OUTPUT_TOKENS` | 否 | 端点属性，默认 60000 / 8000 |

查询理解只发送用户输入和库内几维筛选的取值（公司档、职级、招聘渠道、学历），不发送姓名、工号或个人经历，因此可以走公网端点。模型不可用时，检索自动使用确定性的本地解析。嵌入与重排端点相反：嵌入从 ETL 收到经历原文，重排在查询时收到语料里的岗位名、部门路径和简历描述，放在哪由部署方按数据政策决定；没配它们检索直接报错，不降级。

## 常用命令

```bash
npm run dev          # 开发服务器
npm run query -- "算法、产品、后端都做过的"
npm run db:push      # 从 src/db/schema.ts 同步表结构
npm run verify       # 格式、类型、ETL、SQL/组件测试和生产构建
```

`npm test` 使用临时 schema 运行真实 SQL 集成测试，需要 `.env.local` 中有可连接的 `DATABASE_URL`（带 pgvector）。嵌入由测试进程内的一个假端点提供，不需要真模型。

## 数据边界

真实员工数据不进入版本库。ETL 从配置的数据源读取，完成校验、切段与描述对齐后，写入 Postgres，并把每段经历的四路原文（序列、岗位、部门或公司、简历描述）去重成「说法」送到嵌入端点换成向量；查询时召回的说法会送到重排端点判定相关度。除了这两个端点，个人经历不出这台机器；端点选内网还是公网由部署方决定。仓库里的样例和测试夹具全部是合成数据。

表结构的唯一事实源是 `src/db/schema.ts`。Python 不建表，也不生成迁移；完整导入由 `etl/run.py` 统一执行。
重灌在一个事务内完成；进行中的检索读完原语料后，后续检索才会看到完整的新语料，不会读到半成品。

字段去向与约束见 [`src/db/schema.ts`](src/db/schema.ts)：每一列的含义、公司内与入职前各自往哪个字段落、以及每个索引为什么在那里，都写在那一列旁边。

## 代码结构

```text
etl/contract.py              源契约：适配器要交出的三张表
etl/pipeline.py              通用切段、校验与派生
etl/sources/                 数据源适配器（默认不进版本库）
etl/embed.py                 四路原文的拼法、嵌入调用与本地向量缓存
etl/load.py                  批量写库、说法去重与写向量
src/db/                      Drizzle 表结构与数据库连接
src/search/                  查询解析、判定（召回 + 重排）、排名、分面与结果契约
src/server/                  服务端函数、查询记录与三个模型适配层（查询理解、嵌入、重排）
src/routes/                  零态与搜索工作台
src/routes/-components/      路由私有的界面组件
src/routes/-lib/             视图状态、筛选表、键盘流等非组件模块
src/components/ui/           coss ui 的组件源码（抄来的，见其 NOTICE.md）
src/lib/                     跨层纯函数
tests/                       单元、渲染与真 SQL 集成测试
```

核心边界：

- **数据源与管线之间只有一份契约。** 适配器交出三张摊平的表，管线负责所有人都逃不掉的
  那几条不变量。接第二个数据源时不会长出第二套「什么算一段经历」。见 `etl/contract.py`。
- **查询是一条记录，视图是几个 URL 参数。** 一次「我要找什么人」落成 `search_turn`
  的一行：`SearchSpec` 完整保存证据要求、结构化范围与未生效提示，`SearchDelta`
  保存当前原话自己的理解供重译替换。地址是 `/s/:turnId`；只影响查看方式的分面、
  翻页留在 query string，当前员工由 `/p/:empId` 子路由表达。见 `src/search/spec.ts`、`src/server/turn.ts` 与
  `src/routes/-lib/view-params.ts`。
- 页面访问数据库只有 `src/server/functions.ts` 一个口子；带连接或密钥的模块标了
  `server-only`，页面从它们取值会让构建失败。页面可读取的结果形状在 `src/search/result.ts`；
- `src/search/search.ts` 只产出命中事实，`src/search/rank.ts` 负责判定、打分、排序与分面；
- 界面组件来自 [coss ui](https://coss.com/ui)，源码进仓库放在 `src/components/ui/`。

更细的工程约定在 [AGENTS.md](AGENTS.md)，它只收「代码里放不下」的那些；
「某处为什么这么写」一律写在那处的注释里。

## 查询行为

- 一句话被查询理解**路由**成三类：语义要求（做过什么，走向量）、结构化范围
  （职级、经历来源、经历时长、公司档、招聘渠道、学历、点名的公司或学校）、
  以及库里放不下的条件（如地点），后者在界面上明说「本次未生效」。
- 语义要求分两步命中：向量**召回**语料里相似的说法（序列名、岗位名、部门路径、简历
  描述，去重后约两万种），重排模型逐对**判定**相关度，过全站阈值即命中。稠密向量在
  短语上分不开「前端」与「后端」，交叉编码器分得开，两步各管一头。「算法」因此找得到
  岗位写着「推荐算法工程师」的段，不需要同义词表。专有名词不走向量，走精确条件。
  重排分数按（重排空间、查询词、说法）缓存在库里，同一个词只判定一次。
- 要求之间 AND；一条要求可以有多个**说法**（用户并列的「A 或 B」），说法之间 OR。
  必须要求采用 AND；加分要求只抬升排名；排除词**否决经历段**（阈值更高）——命中它的段
  不再作为任何要求的证据，人只有在失去全部证据时才出局；停用词保留配置但不参与当前检索。
- 一条证据的分量 = 路权重 × 相关度 × 时长 × 近因；受控字段（序列、岗位）最重，简历原文最轻。
- 分面、总人数和排名消费同一份命中事实，计数单位统一为人。
- 分页通过扩大 `limit` 重新取得前 N 名，不使用 offset；界面会明确说明已显示数量、总数与上限。

## 许可证

[MIT](LICENSE)
