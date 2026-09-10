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
bun run sync     # 不配数据源时同步仓库自带的合成样例进库
bun run dev      # 应用起来之后，派生任务几分钟内自己接上：抽取、嵌入、连边
```

嵌入端点会收到每个人的经历原文，建议放在本地或内网；用公网服务意味着把经历交给第三方，
这是部署方按数据政策做的决定。派生和查询用同一个模块调它，所以两侧天然属于同一个嵌入空间。
派生会把空间身份、模型、维数和一条 canary 向量写进数据库；查询进程首次
嵌入前会同时核对配置与端点实际输出，不一致就拒绝检索。模型、权重或归一化方式变化时，
更换 `EMBED_SPACE_ID`，下一轮派生会把说法整张作废、所有段重新算。算过的向量按（空间、模型、文本）留在库里，重算不必再打端点。

应用默认监听 `http://localhost:3100`。

首次同步进来的是 `src/corpus/sources/sample/` 里的二十个人——全部是编的，与任何真实组织无关。它存在只为让检索、排序和界面立刻有东西可看。

## 语料怎么长出来

语料侧分三种任务，节奏不同、执行者不同，落的是同一张记录（`task_run`），在任务台 `/tasks`（顶栏右上角）上一起看：

- **同步**（`bun run sync`）：读数据源、切段校验，一笔短事务增删变了的人和段。不调模型，几秒跑完，挂给 cron 按天跑或随手跑。段按**内容**认（`experience.key`，由库自己算）：没变的段连同它的派生结果原样留下，改了一个字的段是新段。
- **派生**（后台，每 5 分钟看一次有没有活）：给还没派生到当前版本的段抽能力词和做过的事、对齐公司序列、嵌入、连边。几百段一批，每批一笔短事务，一轮最多十分钟，跑不完下一轮接着。「当前版本」是抽取与对齐的提示词、模型和嵌入空间的摘要：改一次提示词等于所有段待派生，缓存让没变的部分几乎不花钱。
- **整理**（后台，每天一次）：给能力词建词表，一个词一周判一次，决定写进 `skill_term`。词表分两层：**同一件事的不同写法**归成一个标准词，能力词那一路的边随之改指它；**一个词属于哪个更宽的词**（「销售数据分析」属于「数据分析」）只记一条归属，细的词原样留在人身上，筛选栏沿归属往上聚——点「数据分析」看到做过各种数据分析的人，点「销售数据分析」只看到销售那一种。判卷这一步可以交给外部 agent，见下。

数据页 `/data` 列出库里的人，点进去看每一段登记的、对齐的、抽出来的，以及这一段派生到当前版本了没有。

派生和整理由 pg-boss 排班，队列表在同一个 Postgres 里（它自己的 `pgboss` schema，首次启动自建），不需要第二个服务；任务台上能「现在跑一次」。三种任务共用一把咨询锁，写者一次只有一个：后台任务拿不到锁就下一轮再来，命令行的同步排队等。

每一次运行落成 `task_run` 的一行，它说过的每一行话都在那一行里——拒绝了几段、为什么拒绝、合并了哪些写法、各表几行；失败时还有那一步报的错连同它的来由。「此刻有没有人在跑」问的是那把咨询锁，不是表里那一列：持锁的连接一断，这件事当场就不成立，所以进程中途没了留下的那一行读作「中断」而不是一次永远跑不完的任务。

读者不受写者影响：每一笔写都是短事务，一次检索跑在 repeatable read 里，看到的永远是某一笔提交之后的整体。

### 判卷交给外部 agent

整理一轮分四步：**作废、结算、出题、判卷**。前三步是机械的——按向量把相似的能力词圈成组、把答卷落进词表；只有判卷需要判断力（「人员管理」和「团队管理」是不是同一件事，「销售团队管理」属不属于「团队管理」，「团队培训」属不属于）。这一步可以换人做：

```
REVIEW_JUDGE=model      # 默认：用 REVIEW_MODEL 判，一轮里出题、答题、结算连着做
REVIEW_JUDGE=external   # 只出题和结算，题挂在队列上等外部 agent 交卷
REVIEW_JUDGE=off        # 整理不跑
REVIEW_TOKEN=...        # 外部接口的凭据
```

接口只在 `REVIEW_JUDGE=external` 且配了 `REVIEW_TOKEN` 时开着，其余情况回 404，等于不存在——自带模型判卷时队列永远是空的，一条只会说「不」的接口不如没有；归外部却没配凭据，整理任务会在记录里说出来。外部这一侧是两个动作，同一条路径，凭据走 `Authorization: Bearer <REVIEW_TOKEN>`：

```bash
# 拉题：还没人答、还没过期的题，最早出的在前。limit 默认 20，上限 100
curl -H "Authorization: Bearer $REVIEW_TOKEN" "$HOST/api/review?limit=20"
```

```jsonc
{
  "questions": [
    {
      "id": 418,
      "words": [                                // 一组写法相近的词，一律平等，没有谁是「标准词」
        { "word": "团队管理", "people": 40 },
        { "word": "人员管理", "people": 12 },
        { "word": "销售团队管理", "people": 6 },
        { "word": "团队培训", "people": 5 }
      ],
      "askedAt": "2026-09-10T03:00:12Z",
      "expiresAt": "2026-09-17T03:00:12Z"       // 到点没人答就作废，那些词下一轮重出
    }
  ],
  "guide": "……判卷标准……"                      // 发给自带模型的同一段字，一字不差
}
```

```bash
# 交卷：一道题一次，先到先得。每个词两问：和组里哪个词是同一件事（sameAs），属于哪个更宽的词（parent）
curl -X POST -H "Authorization: Bearer $REVIEW_TOKEN" -H 'content-type: application/json' \
  -d '{"id":418,"judge":"hr-bot","judgments":[
        {"word":"团队管理","why":"这组的通名","sameAs":"","parent":""},
        {"word":"人员管理","why":"同一件事的不同写法","sameAs":"团队管理","parent":""},
        {"word":"销售团队管理","why":"团队管理的一种，限定了对象","sameAs":"","parent":"团队管理"},
        {"word":"团队培训","why":"只是其中一个环节","sameAs":"","parent":""}]}' \
  "$HOST/api/review"
```

`judge` 是裁判自报的名字（1 到 40 个字母、数字、`-`、`_` 或 `.`），只作显示——管理页 `/skills` 上每条决定都写着是谁判的。`why` 收下但不读，它在那里是为了约束判断：让裁判先说理由再下结论，比让它直接列名单准。`sameAs` 连成的每一片是同一件事，片里人最多的写法做标准词，裁判不选写法；`parent` 是裁判起的名字，可以是这组里没有、语料里也没人写过的词，写最近的一层。回应是 `200`（收下，`{"accepted":true}`）、`400`（形状不对）、`401`（凭据不对）、`404`（接口没开，或这道题不在队列里）、`409`（已经有人答过）。

交卷只写题那一行。词表和边由整理任务在写者锁里改，所以交卷不必等派生放锁；交完会催一次整理，几分钟内生效，催不动也不丢，下一轮照样结算。什么时候生效是服务端自己的事，回应里不说。答卷要过和自带模型同一处收窄：不在题里的词、指向题外的 `sameAs`、含着这个词的 `parent`（方向反了），一律当没说。

## 接入自己的数据

语料侧分成两层，接数据只碰下面那一层：

- **管线**（`src/corpus/pipeline.ts`）不认任何一家公司的字段名。它只做「无论数据从哪来都必须做」的事：区间校验、开放区间封口、相邻段合并、时长与当前信息派生；
- **适配器**（`src/corpus/sources/<name>.ts`）把某一套人事数据翻译成 [`src/corpus/contract.ts`](src/corpus/contract.ts) 定义的三张表：`employees`（人群与档案）、`assignments`（组织内任职段）、`external`（入职前经历）。

两条路：

1. **导出三个 CSV**。列名照 `src/corpus/contract.ts` 写，把 `TALENT_CSV_DIR` 指向那个目录即可，不必写代码。格式见 [`src/corpus/sources/csv-dir.ts`](src/corpus/sources/csv-dir.ts)；
2. **写一个适配器**。复制 `csv-dir.ts` 改成 `sources/<你的名字>.ts`，实现 `extract(report) => Promise<SourceData>`，在 `.env.local` 里设 `TALENT_SOURCE=<你的名字>`。

`src/corpus/sources/` 默认不进版本库（`csv-dir` 和样例除外）：表名、字段名、字典码、人群口径本身就是一家组织的内部信息。规则是白名单式的，新写一个适配器天然是私有的。

适配器要用的库（比如读 parquet 的 `hyparquet`）加进根 `package.json`：服务端构建把 npm 依赖留成裸名、在运行时从根 `node_modules` 解析，适配器目录里自己带一份清单是找不到的。所以根清单里会有仓库内没人引用的依赖，那是私有适配器的。

## 配置

配置只放在 `.env.local` 或环境变量中，不进入版本库。

| 变量 | 必需 | 说明 |
|---|---|---|
| `DATABASE_URL` | 是 | Postgres 连接串，库里须有 `vector` 扩展 |
| `EMBED_BASE_URL` | 是 | OpenAI 兼容的嵌入端点；经历原文会送到这里 |
| `EMBED_MODEL` | 是 | 嵌入模型名 |
| `EMBED_SPACE_ID` | 是 | 嵌入空间的稳定身份；模型行为变化时换值，下一轮派生重算全部说法 |
| `EMBED_API_KEY` | 否 | 端点需要鉴权时填写 |
| `EMBED_TIMEOUT_MS` | 否 | 嵌入请求超时，默认 30000 |
| `RERANK_MODEL` | 是 | 重排模型名；命中由它判定 |
| `RERANK_SPACE_ID` | 是 | 重排空间的稳定身份；缓存按它隔离 |
| `RERANK_BASE_URL` / `RERANK_API_KEY` | 否 | 重排端点与密钥，默认沿用 `EMBED_*` |
| `RERANK_TIMEOUT_MS` / `RERANK_CONCURRENCY` | 否 | 重排超时与最大并发，默认 30000 / 4 |
| `EXTRACT_BASE_URL` | 否 | OpenAI 兼容的聊天端点（`/chat/completions`）；派生用它从入职前简历描述抽能力词和做过的事，把入职前岗位对到公司序列，整理用它判能力词的写法与归属。岗位名、公司名和描述原文会送到这里 |
| `EXTRACT_MODEL` | 否 | 抽取模型名。与 `EXTRACT_BASE_URL` 缺一就不抽也不对齐，派生会说明后跳过。回答按模型名和提示词键入存在库里，改提示词后所有段自动待派生 |
| `EXTRACT_API_KEY` | 否 | 端点需要鉴权时填写 |
| `REVIEW_MODEL` | 否 | 整理能力词词表用的模型，同一个端点；不设就用 `EXTRACT_MODEL`。这一步只有两百来组，却要在「团队培训」和「团队管理」之间划线、给「销售数据分析」起「数据分析」这个更宽的名字，小模型做不动，值得单独给一个大的 |
| `REVIEW_JUDGE` | 否 | 整理的判卷交给谁：`model`（默认，用 `REVIEW_MODEL`）、`external`（等外部 agent 交卷）、`off`（整理不跑） |
| `REVIEW_TOKEN` | 否 | 外部判卷接口的 bearer 凭据。接口只在 `REVIEW_JUDGE=external` 且配了它时开着，否则 `/api/review` 回 404 |
| `EXTRACT_ENABLE_THINKING` | 否 | 带思考的模型设为 `false`，否则思考会先烧光输出预算；不设就不发这个字段 |
| `EXTRACT_STRUCTURED_OUTPUTS` | 否 | 端点不支持 JSON Schema 时设为 `false` |
| `EXTRACT_TIMEOUT_MS` / `EXTRACT_CONCURRENCY` / `EXTRACT_MAX_OUTPUT_TOKENS` | 否 | 端点属性，默认 120000 / 4 / 16000 |
| `TALENT_SOURCE` | 否 | 数据源适配器名，默认 `csv-dir` |
| `TALENT_CSV_DIR` | 否 | `csv-dir` 的源目录，默认读仓库自带的合成样例 |
| `LLM_BASE_URL` | 是 | OpenAI 兼容的查询理解端点；只收到用户敲的那句话 |
| `LLM_MODEL` | 是 | 查询理解模型名 |
| `LLM_API_KEY` | 否 | 端点需要鉴权时填写 |
| `LLM_STRUCTURED_OUTPUTS` | 否 | 端点不支持 JSON Schema 时设为 `false` |
| `LLM_ENABLE_THINKING` | 否 | 同 `EXTRACT_ENABLE_THINKING` |
| `LLM_TIMEOUT_MS` / `LLM_MAX_OUTPUT_TOKENS` | 否 | 端点属性，默认 60000 / 16000 |

四个 `*_TIMEOUT_MS` 都是**一次尝试**的上限，不是一通调用连同重试的总时长：超时装在每一次请求上（`src/server/endpoint.ts`），于是重试的每一次尝试各拿一份完整的预算。

向量的维数不是配置：它是 `src/db/schema.ts` 里的 `EMBED_DIM`，全库只有那一处，换维数就是改它、换 `EMBED_SPACE_ID`、让派生重算。

查询理解只发送用户输入和库内几维筛选的取值（公司档、职级、招聘渠道、学历），不发送姓名、工号或个人经历，因此可以走公网端点；它不可用时整句搜索报错并可重试，不退回任何别的读法。嵌入、抽取与重排端点则不同：嵌入和抽取从派生收到经历原文，重排在查询时收到语料里的岗位名、部门路径、简历描述和抽出来的说法，放在哪由部署方按数据政策决定；没配嵌入或重排检索直接报错，不降级；没配抽取则派生说明后跳过，能力词与做过的事两路为空，入职前经历不对齐序列。

## 常用命令

```bash
bun run dev          # 开发服务器
bun run sync         # 同步数据源进库（不调模型）
bun run derive       # 派生一轮并盯着标准输出看；应用起着的话后台自己会跑
bun run query "算法,+后端"           # 跑一条查询（一行语法见 src/search/query-syntax.ts）；TOPN=20 可以多打印几个人
bun run eval         # 拿 evals/ 里的已知答案量召回与名次
bun run db:push      # 从 src/db/schema.ts 同步表结构；拉到改过 schema 的提交后要跑一次
bun run verify       # 格式、类型、测试和生产构建
```

`bun run test` 使用临时 schema 运行真实 SQL 集成测试，需要 `.env.local` 中有可连接的 `DATABASE_URL`（带 pgvector）。三个模型端点由测试进程内的假端点提供（字符袋向量，相关度可以手算），不需要真模型；数据源钉在仓库自带的合成样例上。

## 数据边界

真实员工数据不进入版本库。同步从配置的数据源读取，完成校验与切段后写入 Postgres；派生把每段经历的四路原文（序列、岗位、部门或公司、简历描述）去重成「说法」送到嵌入端点换成向量；配了抽取端点时，入职前经历的简历描述还会送去读成能力词和做过的事，作为另外两路说法一并嵌入；每段入职前经历的岗位名、公司名和描述也会送去对到公司序列树，结果只供序列筛选读；整理能力词时，库里的能力词和人数也会送去让模型判断哪些是同一件事的不同写法、哪个词属于哪个更宽的词。查询时召回的说法会送到重排端点判定相关度。除了这三个端点，个人经历不出这台机器；端点选内网还是公网由部署方决定。仓库里的样例和测试夹具全部是合成数据。

判卷交给外部 agent 时（`REVIEW_JUDGE=external`），出这台机器的只有能力词和这个词下面的人数——没有姓名、工号，也没有简历原文。这条接口的数据边界比抽取端点窄得多，和查询理解同一档。

公开表结构的唯一事实源是 `src/db/schema.ts`，改完跑 `bun run db:push`。

字段去向与约束见 [`src/db/schema.ts`](src/db/schema.ts)：每一列的含义、公司内与入职前各自往哪个字段落、以及每个索引为什么在那里，都写在那一列旁边。

## 代码结构

```text
src/corpus/contract.ts       源契约：适配器要交出的三张表
src/corpus/pipeline.ts       通用切段、校验与派生
src/corpus/sources.ts        按名字取适配器
src/corpus/sources/          数据源适配器（默认不进版本库）
src/corpus/route-texts.ts    四路说法的拼法，语料侧与测试夹具共用
src/corpus/sync.ts           同步：暂存、按内容键做差、一笔事务增删
src/corpus/derive.ts         派生：待派生的段分批抽取、对齐、嵌入、连边，记版本
src/corpus/embed.ts          说法的嵌入与库里的向量缓存
src/corpus/extract.ts        入职前简历描述 → 能力词与做过的事：提示词与收窄
src/corpus/align.ts          入职前岗位 → 公司序列：序列树、提示词与收窄
src/corpus/vocabulary.ts     能力词词表：整理任务圈组、判卷、认写法与归属、边改指标准词
src/corpus/session.ts        写者独占的那条连接与串行化锁
src/db/                      Drizzle 表结构与数据库连接
src/search/                  查询解析、判定（召回 + 重排）、排名、分面与结果契约
src/server/                  服务端函数、查询记录、任务的记录与排班（tasks、jobs）、四个模型适配层
src/server.ts                服务端入口：起后台任务的排班
src/routes/                  零态、搜索工作台，以及三个管理页（/skills、/tasks、/data）
src/routes/-components/      各屏共用的外壳件（顶栏、历史弹层、页框、零态、死链）
src/routes/-lib/             各屏共用的非组件模块（提交查询、值→标签）
src/routes/s/$turnId/        工作台这一条路由，私有的组件与模块在它的 -components/ 与 -lib/ 下
src/components/ui/           coss ui 的组件源码（抄来的，见其 NOTICE.md）
src/lib/                     跨层纯函数
scripts/                     命令行入口：sync（同步）、derive（派生一轮）、query（跑一条查询）、eval（检索质量验收）
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
  的一行：`SearchSpec` 完整保存这次查询的条件（`Term[]`）。
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

- 一句话被查询理解写成一份条件清单：每条落在某一维上——做过什么（走向量），或
  结构化范围（职级、经历来源、经历时长、公司档、招聘渠道、学历、点名的公司或学校）。
  库里没有的条件（如地点）不写。
- 经历条件分两步命中：向量**召回**语料里相似的说法（序列名、岗位名、部门路径、简历
  描述，去重后约两万种），重排模型逐对**判定**相关度，过全站阈值即命中。稠密向量在
  短语上分不开「前端」与「后端」，交叉编码器分得开，两步各管一头。「算法」因此找得到
  岗位写着「推荐算法工程师」的段。专有名词不走向量，走精确条件。
  重排分数按（重排空间、查询词、说法）缓存在库里，同一个词只判定一次。
- 条件之间 AND；一条条件可以有多个**取值**，取值之间 OR、同权：用户并列的「A 或 B」，
  加上查询理解替用户多写的叫法。chip 上只写代表词，其余取值收在菜单里可删；靠非代表词
  命中时证据行标「≈ 那个词」。
  必须条件采用 AND；加分条件只抬升排名；排除词**否决经历段**（阈值更高）——命中它的段
  不再作为任何条件的证据，人只有在失去全部证据时才出局；停用词保留配置但不参与当前检索。
- 一条证据的分量 = 路权重 × 相关度 × 时长 × 近因；受控字段（序列、岗位）最重，简历原文最轻。
- 分面、总人数和排名消费同一份命中事实，计数单位统一为人。
- 分页通过扩大 `limit` 重新取得前 N 名，不使用 offset；界面会明确说明已显示数量、总数与上限。

## 许可证

[MIT](LICENSE)
