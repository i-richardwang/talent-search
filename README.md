# talent-search · 人才搜索

面向 HR 与业务负责人的人才搜索工具。它从组织内任职和入职前工作经历中寻找员工，并把每项匹配还原到可核对的经历证据。

- 产品目标与范围：[docs/PROJECT.md](docs/PROJECT.md)
- 工程约束：[AGENTS.md](AGENTS.md)

## 本地运行

需要 [Bun](https://bun.sh) 1.4+ 和装了 [pgvector](https://github.com/pgvector/pgvector) 的 Postgres 17，
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

bun install
bun run db:push
bun run import   # 不配数据源时导入仓库自带的合成样例；会把每段经历送去嵌入
bun run dev
```

嵌入端点会收到每个人的经历原文，建议放在本地或内网；用公网服务意味着把经历交给第三方，
这是部署方按数据政策做的决定。导入和查询用同一个模块调它，所以两侧天然属于同一个嵌入空间。
导入会把空间身份、模型、维数和一条 canary 向量写进数据库；查询进程首次
嵌入前会同时核对配置与端点实际输出，不一致就拒绝检索。模型、权重或归一化方式变化时，
更换 `EMBED_SPACE_ID` 并重新导入。算过的向量按（空间、模型、文本）留在库里，重灌不必再打端点。

应用默认监听 `http://localhost:3100`。

首次导入落进去的是 `src/corpus/sources/sample/` 里的二十个人——全部是编的，与任何真实组织无关。它存在只为让检索、排序和界面立刻有东西可看。

## 导入

**导入是这个应用自己的一次运行，不是外面某个脚本。** 两个入口，同一个函数、同一条串行化锁、同一份记录：

- 管理页 `/imports`（顶栏右上角）：一个按钮开始，页面上看得到它跑到哪一步、说了什么、上几次是什么结果；
- 命令行 `bun run import`：过程回显到标准输出，跑完按退出码判断成败，适合挂给定时任务。

同一个库上一次只准备一版语料。已经有一次在跑时，第二次当场被拒绝，不排队。
每一次导入落成 `import_run` 的一行，它说过的每一行话都在那一行里——拒绝了几段、
为什么拒绝、合并了哪些写法、各表最后几行。

导入先在数据库连接私有的暂存表里完成嵌入与校验，再用一个短事务原子发布。准备失败不影响正在服务的语料；
发布期间，已有检索读完旧代，后续检索只会看到完整的新代。

## 接入自己的数据

语料侧分成两层，接数据只碰下面那一层：

- **管线**（`src/corpus/pipeline.ts`）不认任何一家公司的字段名。它只做「无论数据从哪来都必须做」的事：区间校验、开放区间封口、相邻段合并、时长与当前信息派生；
- **适配器**（`src/corpus/sources/<name>.ts`）把某一套人事数据翻译成 [`src/corpus/contract.ts`](src/corpus/contract.ts) 定义的三张表：`employees`（人群与档案）、`assignments`（组织内任职段）、`external`（入职前经历）。

两条路：

1. **导出三个 CSV**。列名照 `src/corpus/contract.ts` 写，把 `TALENT_CSV_DIR` 指向那个目录即可，不必写代码。格式见 [`src/corpus/sources/csv-dir.ts`](src/corpus/sources/csv-dir.ts)；
2. **写一个适配器**。复制 `csv-dir.ts` 改成 `sources/<你的名字>.ts`，实现 `extract(report) => Promise<SourceData>`，在 `.env.local` 里设 `TALENT_SOURCE=<你的名字>`。

`src/corpus/sources/` 默认不进版本库（`csv-dir` 和样例除外）：表名、字段名、字典码、人群口径本身就是一家组织的内部信息。规则是白名单式的，新写一个适配器天然是私有的。

## 配置

配置只放在 `.env.local` 或环境变量中，不进入版本库。

| 变量 | 必需 | 说明 |
|---|---|---|
| `DATABASE_URL` | 是 | Postgres 连接串，库里须有 `vector` 扩展 |
| `EMBED_BASE_URL` | 是 | OpenAI 兼容的嵌入端点；经历原文会送到这里 |
| `EMBED_MODEL` | 是 | 嵌入模型名 |
| `EMBED_SPACE_ID` | 是 | 嵌入空间的稳定身份；模型行为变化时换值并重新导入 |
| `EMBED_API_KEY` | 否 | 端点需要鉴权时填写 |
| `EMBED_TIMEOUT_MS` | 否 | 嵌入请求超时，默认 30000 |
| `RERANK_MODEL` | 是 | 重排模型名；命中由它判定 |
| `RERANK_SPACE_ID` | 是 | 重排空间的稳定身份；缓存按它隔离 |
| `RERANK_BASE_URL` / `RERANK_API_KEY` | 否 | 重排端点与密钥，默认沿用 `EMBED_*` |
| `RERANK_TIMEOUT_MS` / `RERANK_CONCURRENCY` | 否 | 重排超时与最大并发，默认 30000 / 4 |
| `EXTRACT_BASE_URL` | 否 | OpenAI 兼容的聊天端点（`/chat/completions`）；导入用它从入职前简历描述抽能力词和做过的事，把入职前岗位对到公司序列，并整理能力词的不同写法。岗位名、公司名和描述原文会送到这里 |
| `EXTRACT_MODEL` | 否 | 抽取模型名。与 `EXTRACT_BASE_URL` 缺一就不抽也不对齐，导入会说明后跳过。回答按模型名和提示词键入存在库里，改提示词后重跑导入即可 |
| `EXTRACT_API_KEY` | 否 | 端点需要鉴权时填写 |
| `REVIEW_MODEL` | 否 | 整理能力词写法用的模型，同一个端点；不设就用 `EXTRACT_MODEL`。这一步只有两百来组，却要在「团队培训」和「团队管理」之间划线，小模型划不动，值得单独给一个大的 |
| `EXTRACT_ENABLE_THINKING` | 否 | 带思考的模型设为 `false`，否则思考会先烧光输出预算；不设就不发这个字段 |
| `EXTRACT_STRUCTURED_OUTPUTS` | 否 | 端点不支持 JSON Schema 时设为 `false` |
| `EXTRACT_TIMEOUT_MS` / `EXTRACT_CONCURRENCY` / `EXTRACT_MAX_OUTPUT_TOKENS` | 否 | 端点属性，默认 120000 / 4 / 4000 |
| `TALENT_SOURCE` | 否 | 数据源适配器名，默认 `csv-dir` |
| `TALENT_CSV_DIR` | 否 | `csv-dir` 的源目录，默认读仓库自带的合成样例 |
| `LLM_BASE_URL` | 是 | OpenAI 兼容的查询理解端点；只收到用户敲的那句话 |
| `LLM_MODEL` | 是 | 查询理解模型名 |
| `LLM_API_KEY` | 否 | 端点需要鉴权时填写 |
| `LLM_STRUCTURED_OUTPUTS` | 否 | 端点不支持 JSON Schema 时设为 `false` |
| `LLM_TIMEOUT_MS` / `LLM_MAX_OUTPUT_TOKENS` | 否 | 端点属性，默认 60000 / 8000 |

向量的维数不是配置：它是 `src/db/schema.ts` 里的 `EMBED_DIM`，全库只有那一处，换维数就是改它再重新导入。

查询理解只发送用户输入和库内几维筛选的取值（公司档、职级、招聘渠道、学历），不发送姓名、工号或个人经历，因此可以走公网端点；它不可用时整句搜索报错并可重试，不退回任何别的读法。嵌入、抽取与重排端点则不同：嵌入和抽取从导入收到经历原文，重排在查询时收到语料里的岗位名、部门路径、简历描述和抽出来的说法，放在哪由部署方按数据政策决定；没配嵌入或重排检索直接报错，不降级；没配抽取则导入说明后跳过，能力词与做过的事两路为空，入职前经历不对齐序列。

## 常用命令

```bash
bun run dev          # 开发服务器
bun run import       # 跑一次整库导入
bun run query "算法,+后端"           # 跑一条查询（一行语法见 src/search/query-syntax.ts）；TOPN=20 可以多打印几个人
bun run eval         # 拿 evals/ 里的已知答案量召回与名次
bun run db:push      # 从 src/db/schema.ts 同步表结构；拉到改过 schema 的提交后要跑一次
bun run verify       # 格式、类型、测试和生产构建
```

`bun run test` 使用临时 schema 运行真实 SQL 集成测试，需要 `.env.local` 中有可连接的 `DATABASE_URL`（带 pgvector）。三个模型端点由测试进程内的假端点提供（字符袋向量，相关度可以手算），不需要真模型；数据源钉在仓库自带的合成样例上。

## 数据边界

真实员工数据不进入版本库。导入从配置的数据源读取，完成校验、切段与描述对齐后，写入 Postgres，并把每段经历的四路原文（序列、岗位、部门或公司、简历描述）去重成「说法」送到嵌入端点换成向量；配了抽取端点时，入职前经历的简历描述还会送去读成能力词和做过的事，作为另外两路说法一并嵌入；每段入职前经历的岗位名、公司名和描述也会送去对到公司序列树，结果只供序列筛选读；整理能力词时，库里的能力词和人数也会送去让模型判断哪些是同一项能力的不同写法。查询时召回的说法会送到重排端点判定相关度。除了这三个端点，个人经历不出这台机器；端点选内网还是公网由部署方决定。仓库里的样例和测试夹具全部是合成数据。

公开表结构的唯一事实源是 `src/db/schema.ts`，改完跑 `bun run db:push`。

字段去向与约束见 [`src/db/schema.ts`](src/db/schema.ts)：每一列的含义、公司内与入职前各自往哪个字段落、以及每个索引为什么在那里，都写在那一列旁边。

## 代码结构

```text
src/corpus/contract.ts       源契约：适配器要交出的三张表
src/corpus/pipeline.ts       通用切段、校验与派生
src/corpus/sources.ts        按名字取适配器
src/corpus/sources/          数据源适配器（默认不进版本库）
src/corpus/route-texts.ts    四路说法的拼法，语料侧与测试夹具共用
src/corpus/embed.ts          整份语料的嵌入与库里的向量缓存
src/corpus/extract.ts        入职前简历描述 → 能力词与做过的事：提示词与收窄
src/corpus/align.ts          入职前岗位 → 公司序列：序列树、提示词与收窄
src/corpus/aliases.ts        能力词对照表：每次导入前自动圈组、问模型、合并写法
src/corpus/load.ts           暂存、说法去重、写向量与原子发布
src/corpus/session.ts        导入独占的那条连接与串行化锁
src/db/                      Drizzle 表结构与数据库连接
src/search/                  查询解析、判定（召回 + 重排）、排名、分面与结果契约
src/server/                  服务端函数、查询记录、导入编排与四个模型适配层
src/routes/                  零态、搜索工作台，以及两个管理页（/skills、/imports）
src/routes/-components/      各屏共用的外壳件（顶栏、历史弹层、页框、零态、死链）
src/routes/-lib/             各屏共用的非组件模块（提交查询、值→标签）
src/routes/s/$turnId/        工作台这一条路由，私有的组件与模块在它的 -components/ 与 -lib/ 下
src/components/ui/           coss ui 的组件源码（抄来的，见其 NOTICE.md）
src/lib/                     跨层纯函数
scripts/                     命令行入口：import（跑一次导入）、query（跑一条查询）、eval（检索质量验收）
evals/                       验收用例（真实评估用例不进版本库，仓库只带 sample.json）
tests/                       单元、渲染与真 SQL 集成测试
```

核心边界：

- **数据源与管线之间只有一份契约。** 适配器交出三张摊平的表，管线负责所有人都逃不掉的
  那几条不变量。接第二个数据源时不会长出第二套「什么算一段经历」。见 `src/corpus/contract.ts`。
- **语料侧与查询侧共用模型适配层。** 嵌入端点只有 `src/server/embed.ts` 一处调用者，
  聊天端点只有 `src/server/chat.ts` 一处，于是「语料和查询是不是同一个嵌入空间」
  不是一条要记住的约定，而是同一个进程里的同一份配置。
- **查询是一条记录，视图是几个 URL 参数。** 一次「我要找什么人」落成 `search_turn`
  的一行：`SearchSpec` 完整保存证据要求（`Requirement[]`）、结构化范围与注解。
  地址是 `/s/:turnId`；只影响查看方式的分面、
  翻页留在 query string，当前员工由 `/p/:empId` 子路由表达。见 `src/search/spec.ts`、`src/server/turn.ts` 与
  `src/routes/s/$turnId/-lib/view-params.ts`。
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
  岗位写着「推荐算法工程师」的段。专有名词不走向量，走精确条件。
  重排分数按（重排空间、查询词、说法）缓存在库里，同一个词只判定一次。
- 要求之间 AND；一条要求可以有多个**说法**，说法之间 OR：用户并列的「A 或 B」，加上
  查询理解替用户补的变体（同一件事的另一种叫法、相近的说法）。变体不上 chip、收在菜单里
  可删；靠它命中的分数打折，证据行上标「≈ 那个词」。
  必须要求采用 AND；加分要求只抬升排名；排除词**否决经历段**（阈值更高）——命中它的段
  不再作为任何要求的证据，人只有在失去全部证据时才出局；停用词保留配置但不参与当前检索。
- 一条证据的分量 = 路权重 × 相关度 × 时长 × 近因；受控字段（序列、岗位）最重，简历原文最轻。
- 分面、总人数和排名消费同一份命中事实，计数单位统一为人。
- 分页通过扩大 `limit` 重新取得前 N 名，不使用 offset；界面会明确说明已显示数量、总数与上限。

## 许可证

[MIT](LICENSE)
