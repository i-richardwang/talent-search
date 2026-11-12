# talent-search · 人才搜索

面向 HR 与业务负责人的人才搜索工具。它从组织内任职和入职前经历中寻找员工，并把每项匹配还原到可核对的经历证据。

- 产品目标与范围：[docs/PROJECT.md](docs/PROJECT.md)
- 开发约定：[AGENTS.md](AGENTS.md)

## 本地运行

需要 Bun 1.4+ 和 Postgres 17，不需要额外的扩展。模型端点按用到的能力配：聊天端点读简历并判词表；嵌入端点只供词表整理把相近的写法分组；查询理解端点负责 AI 搜索（理解需求、读候选人的经历、判断谁符合），不配时只有关键词搜索。

```bash
docker run -d --name talent-pg \
  -e POSTGRES_USER=talent -e POSTGRES_PASSWORD=talent -e POSTGRES_DB=talent \
  -p 55434:5432 postgres:17

cp .env.example .env.local
# 编辑 .env.local：设置数据库、模型配置；用 openssl rand -base64 32 生成 BETTER_AUTH_SECRET。
bun install
bun run db:push
bun run auth:user create --username admin --name 管理员 --role admin
bun run sync
bun run dev
```

应用默认监听 `http://localhost:3100`。默认数据源是 `src/corpus/sources/sample/` 中的合成样例；启动后，后台任务会继续完成抽取、序列对齐和词表整理。

## 登录与账号管理

所有业务页面和 RPC 都要求登录。普通用户可以搜索、查看人才库与标签；只有管理员能看「任务」、
读取任务状态和日志、手动触发解析或整理。任务权限在服务端检查，直接访问地址或调用接口也不能绕过。
搜索记录仍由登录用户共享，包括查看、追加和删除，不是个人私有历史。
外部 `GET/POST /api/review` 使用独立的 `REVIEW_TOKEN`，不使用浏览器会话。

认证使用 Better Auth 的 Username、Admin 插件与 PostgreSQL Drizzle Adapter，不开放注册。
用户名不区分大小写，由 3–30 个英文字母、数字、下划线或点组成；密码长度为 12–128 个字符。
账号由能登录部署机器的管理员通过交互终端管理，密码输入不回显，也不写进命令行参数：

```bash
bun run auth:user create --username admin --name 管理员 --role admin
bun run auth:user create --username hr_user --name 招聘同事
bun run auth:user reset-password --username hr_user
```

创建时用户名重复会拒绝，不覆盖已有账号。重置密码在同一事务里撤销该账号的已有会话。
没有默认账号或默认密码。浏览器只开放认证的登录、退出和会话接口，不开放 Admin 插件的账号管理、
提权或模拟登录接口。数据库里的认证用户和人才库员工没有关联外键。
Better Auth 内部仍要求 email 字段，创建时使用随机的 `@users.invalid` 不可投递地址；用户无需提供邮箱，
系统不发邮件，不使用邮箱登录或邮箱找回密码。

`BETTER_AUTH_SECRET` 必须至少 32 个字符，保存在部署环境；`BETTER_AUTH_URL` 是应用固定来源地址，
生产必须是 HTTPS。会话使用 HttpOnly Cookie，不在浏览器存 token；未启用 Cookie 会话缓存，
退出或撤销后下一次服务端请求即失效。认证缺少配置或数据库不可用时拒绝访问，不退回匿名模式。
Better Auth 的进程内登录限流保持开启；公网部署还应在网关限制登录及查询理解请求，
并覆盖而不是透传客户端提交的转发 IP 头，多实例不能只依赖进程内计数。

### 数据库维护

认证使用 `auth_user`、`auth_session`、`auth_account`、`auth_verification` 四张表，与人才语料独立。
账号管理不需要运行 `sync`、`derive` 或重新整理词表。

修改已有数据库结构前，停止应用及后台任务，备份完整 Postgres 并确认可恢复；备份含业务数据，不能进版本库。
运行 `bun run db:push` 时逐项核对差异，只应用本次结构调整。出现计划外的删除、重建、截断或业务表修改时取消，
先查明差异，不使用 `--force`。完成后核对登录、普通用户权限与任务页，再开放服务。
配置或结构初始化失败时保持应用停止，修复后再启动；恢复备份或部署其他版本时也必须保持访问控制。

## 数据管线

三种任务共用 `src/corpus/session.ts` 的写者锁，运行记录统一写入 `task_run`，可在 `/tasks` 查看或手动触发。拿到锁的连接用 `application_name` 标记当前运行，任务状态按这一关联读取。

- `sync`：读取数据源，校验并切分经历，以短事务同步变更，同时刷新未结束经历的累计月数；内容未变的段保留身份和解析结果，不调用模型。
- `derive`：抽取能力词和投入档、对齐序列并连接经历段；按批提交。模型答不出的段记为未能作答：抽取答不出按整段原文检索，对齐答不出不推断序列，判定标准变了才重新问；端点故障中止这一轮，下一轮接着。
- `review`：维护能力词的同义写法和宽细归属。相近的写法按向量分组后交给判定方；没配嵌入端点时不收集新的组，队列里已有的判定照常生效。

相邻任职仅在任职标识、部门路径、岗位、职级和序列等登记事实均相同时合并；晋升或序列变化保留分段。
CSV 缺少可选的 `segment_key` 列时按部门与岗位生成任职标识；提供该列但留空时保留为独立经历。重复表头拒绝读取，避免字段被覆盖。
模型回答经过形状与领域校验后才能进入缓存，完全不合规的整理回答保留为待判，后续任务继续处理。

短说法指当前仍有技能或入职前岗位名边的文本，范围由 `schema.ts` 的 `SHORT_ROUTES` 定义。词表的收集、计数和关键词搜索的候选词共用该范围。

检索在 repeatable-read 快照中读取语料，检索里没有模型调用：写了判据的条件，哪一段算数用的是查询理解在这次找人任务里存下的结论（规则见 [AGENTS.md](AGENTS.md)）。

解析版本由说法组合方式、提示词、回答形状和序列树共同决定，不包含抽取或对齐模型名。换模型时，同一标准下已完成和暂存的结果继续有效，只处理剩余段；模型回答缓存仍按模型隔离。这些标准输入变化后，旧结果会自动进入待处理状态。新版本的结果先放在一旁，检索继续读上一版，全部解析完后一次替换正式表。对齐只接受树上的完整一对或两级均空；其余回答无效、不缓存，这一段记为未能作答，不推断序列。正式表里出现两份解析版本时，检索明确报错，等解析统一后恢复。待业段只用于展示时间线，不进入检索、累计工作年限或模型解析。

语料可以从数据源重新构建。结构更新若需要重建语料，先停止应用，运行 `bun run db:push`；新表和生成列选择新建，随后运行 `bun run sync`、`bun run derive`，完成后再启动应用。

## 接入数据源

所有适配器输出 [`src/corpus/contract.ts`](src/corpus/contract.ts) 定义的 `employees`、`assignments`、`external` 和 `levels`，可选再给记录的三批：`streams`（记录流：评级或状态）、`scales`（评级流的档位表）和 `records`（一期一档的评级、一段一段的状态）；以及公司知识的五批：`industries`（行业树）、`companies`（公司和所属集团）、`company_industries`（公司做哪些行业、哪些是主营）、`company_circles`（名企组合）和 `company_aliases`（经历上的公司写法对到哪家公司）。公司是什么不由本项目判断，数据源给结论；对不上的公司写法按人数列在同步报告里。同一人同一期的几条修订按登记时刻只留最终一条，分不出的整组拒绝并报告；记录流的覆盖在管理页「数据」上看。契约逐行核验必需列，显式空值可以保留，缺列则报告表名、行号和列名并拒绝。通用校验、切段与解析在 `src/corpus/pipeline.ts`，适配器只负责源字段转换。

职级和学历按档检索。`levels` 是职级表，写明每个职级归哪一档、档有多高，分档方法由数据源自己定；学历写契约里的五档之一（高中及以下、大专、本科、硕士、博士），源里的写法由适配器归档。筛选和「某档及以上」都按档走，职级原文只在详情里显示。

两种接入方式：

1. 按 [`src/corpus/sources/csv-dir.ts`](src/corpus/sources/csv-dir.ts) 文件头的格式导出 CSV，并设置 `TALENT_CSV_DIR`：`employees`、`assignments`、`external`、`levels` 四个必需，记录的三个和公司知识的五个各自可选。
2. 实现一个导出 `extract(report): Promise<SourceData>` 的模块，并将 `TALENT_SOURCE` 设为该文件的绝对路径。

`src/corpus/sources/` 默认忽略私有适配器，只保留 `csv-dir` 与合成样例。私有模块在运行时加载，不进入 Vite 构建产物。适配器使用的 npm 包应安装在根 `package.json`，以便从项目根 `node_modules` 解析。

## 模型与数据边界

| 能力 | 接收的数据 | 失败行为 |
|---|---|---|
| 查询理解 | 用户输入、当前条件、数据目录的说明、少量筛选值与记录流的覆盖，工具查到的人数与人才库里的写法，以及它要读的候选经历：公司或部门、序列、岗位、技能和简历原文 | 查询报错，可重试；未配置时只有关键词搜索 |
| 抽取与对齐 | 入职前岗位、公司和描述 | 端点故障时解析记录错误、下一轮接着；单段答不出记为未能作答 |
| 词表整理 | 短说法与人数 | 整理记录错误 |
| 嵌入 | 进词表的短说法 | 整理记录错误；未配置时不收集新的组 |

模型端点会收到人才库里的内容：查询理解收到工具查到的人数和说法、公司、部门、学校的写法，以及候选人被搜到的那几段经历（公司或部门、序列、岗位、技能、简历原文）；抽取和对齐收到经历内容，整理和嵌入收到简历里读出的短说法。查询理解的请求里没有姓名和工号（`tests/understand-privacy.test.ts` 检查）。端点要部署在这些数据可以去的范围内，由部署方按数据政策选择内网或公网服务。真实员工数据、导出结果和真实验收用例不得进入版本库。

嵌入只用于词表整理的分组，向量按 `EMBED_SPACE_ID` 和模型名缓存。模型、归一化或端点行为变化时，需要更换 `EMBED_SPACE_ID`，旧向量不再被读到。

## 外部判定

`REVIEW_JUDGE` 决定词表整理由谁判定：

```dotenv
REVIEW_JUDGE=model      # 使用 REVIEW_MODEL，未设置时回退到 EXTRACT_MODEL
REVIEW_JUDGE=external   # 使用外部判定接口
REVIEW_JUDGE=off        # 不运行整理
REVIEW_TOKEN=...        # external 模式必需
```

外部接口使用 `Authorization: Bearer <REVIEW_TOKEN>`：

- `GET /api/review?limit=20`：返回尚未判定且未过期的组（`groups`），以及判定标准的原文和身份（`guide`）。
- `POST /api/review`：提交一组的首份判定；请求必须原样带回 `id` 和 `guideIdentity`，并写上判定方的名字 `judge` 和逐词的 `judgments`。

判定逐词提交 `word`、`why`、`sameAs` 与 `parent`，四项均为字符串；没有同义或归属关系时对应值为空字符串，缺字段不算有效判定。请求正文最多 64 KiB，按 UTF-8 字节计算。接口只保存判定原话，整理任务在写者锁内校验并生效；它不允许直接修改词表或经历边。请求封装格式错误返回 400，凭据错误返回 401，不可用或过期返回 404，重复提交返回 409。

## 配置

配置放在 `.env.local` 或运行环境中。完整示例见 [.env.example](.env.example)。

| 变量 | 必需 | 说明 |
|---|---|---|
| `DATABASE_URL` | 是 | Postgres 17 连接串 |
| `EMBED_BASE_URL` / `EMBED_MODEL` / `EMBED_SPACE_ID` | 否 | 嵌入端点、模型与向量缓存的空间身份；只有词表整理分组用，不配时整理不收集新的组 |
| `LLM_BASE_URL` / `LLM_MODEL` | 否 | 查询理解端点与模型；不配时不能用一句话找人。一轮里它要读上百段经历，用不带思考的快模型（带思考的模型设 `LLM_ENABLE_THINKING=false`） |
| `EXTRACT_BASE_URL` / `EXTRACT_MODEL` | 否 | 抽取与模型整理的聊天端点，对齐默认沿用 |
| `ALIGN_MODEL` | 否 | 序列对齐模型，默认使用 `EXTRACT_MODEL` |
| `ALIGN_BASE_URL` / `ALIGN_API_KEY` | 否 | 对齐专用端点；未设地址时沿用抽取端点与密钥，设了地址则只使用对齐密钥 |
| `REVIEW_MODEL` | 否 | 整理模型，默认使用 `EXTRACT_MODEL` |
| `REVIEW_JUDGE` / `REVIEW_TOKEN` | 否 | 判定方与外部接口凭据 |
| `TALENT_SOURCE` | 否 | `csv-dir` 或私有适配器的绝对路径 |
| `TALENT_CSV_DIR` | 否 | `csv-dir` 的输入目录；默认使用合成样例 |

各端点的 API key、超时、并发、结构化输出与思考开关见 `.env.example`。`EXTRACT_TIMEOUT_MS` 是语料侧一次模型调用的总时限，默认三分钟，含思考、正文读取与重试；总时限耗尽后中止本机请求，不再重试。持续的端点故障使这一批停止领取新段，等在途调用收尾后报错退出，期间成功的回答保留在缓存。不发送输出 token 上限，实际输出仍受模型服务自身限制。其他 `*_TIMEOUT_MS` 表示每次尝试的上限；端点策略同时限制全部尝试与退避的总用时，查询理解的存活判定使用同一份时限。嵌入维数只在 `src/db/schema.ts` 的 `EMBED_DIM` 定义。

## 常用命令

```bash
bun run dev          # 开发服务器
bun run sync         # 同步数据源
bun run derive       # 运行一轮解析
bun run query "算法,+后端"
bun run eval
bun run eval:extract
bun run eval:review
bun run eval:understand
bun run db:push
bun run verify       # 格式、类型、测试、生产构建
bun run ui           # 设计系统：浏览、调整设计令牌与组件，导出改动
```

`bun run test` 只向测试子进程传递 `.env.local` 或运行环境中的 `DATABASE_URL`，固定使用合成 CSV 样例，并禁止子进程加载环境文件。每个集成测试文件使用独立临时 schema 和进程内假模型，不会访问真实数据源或模型端点。

## 代码结构

```text
src/corpus/       数据同步、解析、词表整理与数据源契约
src/db/           Drizzle 表结构与数据库连接
src/search/       查询契约、数据目录、执行外壳、说法匹配、排名、分面与结果类型
src/server/       RPC、查询记录、后台任务和模型端点
src/routes/       页面、路由私有组件与交互逻辑
src/components/   跨页面产品组件与通用组件（ui/）
src/lib/          与界面无关的跨层纯函数
scripts/          命令行入口与验收工具
scripts/design-system/  设计系统：令牌、组件与产品界面的展示页（`bun run ui`）
evals/            合成验收样例；真实用例仅保存在本机
tests/            单元、渲染与 Postgres 集成测试
```

公开表结构和数据目录视图（`catalog` schema）的唯一来源是 `src/db/schema.ts`；修改后运行 `bun run db:push`，视图一并建。AI 搜索里模型写的条件只读这些视图，经 Postgres 解析器的白名单后在只读角色 `talent_query` 下执行：应用的数据库用户要么能建角色，要么事先建好 `talent_query` 并授予应用用户。页面通过 `src/server/functions.ts` 的 RPC 访问服务端，带连接或密钥的模块必须保持 `server-only`。
