# talent-search · 人才搜索

面向 HR 与业务负责人的人才搜索工具。它从组织内任职和入职前经历中寻找员工，并把每项匹配还原到可核对的经历证据。

- 产品目标与范围：[docs/PROJECT.md](docs/PROJECT.md)
- 开发约定：[AGENTS.md](AGENTS.md)

## 本地运行

需要 Bun 1.4+ 和 Postgres 17，不需要额外的扩展。模型端点按用到的能力配：聊天端点读简历并判词表；嵌入端点只供词表整理给要判的词找相近的参考词；查询理解端点负责 AI 搜索（理解需求、读候选人的经历、判断谁符合），不配时只有关键词搜索。

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

AI 搜索在只读角色 `talent_query` 下查询人才库：应用的数据库用户要么能建角色，要么事先建好 `talent_query` 并授予应用用户。

## 登录与账号管理

所有页面都要求登录，不开放注册，没有默认账号。普通用户可以搜索、查看人才库；只有管理员能看「标签」「任务」「审计」和「账号」、
手动触发解析或整理。搜索记录只属于发起它的账号，别人的记录打不开，管理员也一样。
外部 `GET/POST /api/review` 使用独立的 `REVIEW_TOKEN`，不使用浏览器会话。

搜索、查看个人详情、导出名单和账号页上的每一件事各留一行操作记录，只追加，管理员在「审计」页查。

管理员在「账号」页建账号（选普通用户或管理员）、重置密码、设为或取消管理员、停用和恢复，自己的账号除外；
新密码由服务端生成，只显示一次。第一个管理员由能登录部署机器的人在终端里建；命令行什么账号都能管，
密码输入不回显，操作不记进操作记录：

```bash
bun run auth:user list
bun run auth:user create --username admin --name 管理员 --role admin
bun run auth:user create --username hr_user --name 招聘同事
bun run auth:user reset-password --username hr_user
bun run auth:user set-role --username hr_user --role admin
bun run auth:user disable --username hr_user
bun run auth:user enable --username hr_user
```

用户名不区分大小写，由 3–30 个英文字母、数字、下划线或点组成；密码长度为 12–128 个字符。
重置密码和停用会让该账号已登录的会话全部失效。账号只停用、不删除：搜索记录和操作记录引用它。
登录的人点导航栏左上角自己的名字可以改自己的密码。

`BETTER_AUTH_SECRET` 至少 32 个字符；`BETTER_AUTH_URL` 是用户在浏览器里打开的那个固定来源地址。
公网部署要用 HTTPS，并在网关限制登录及查询理解请求的频率。

## 数据管线

三种任务同一时刻只运行一个，运行记录都在 `/tasks`；解析和整理也能在那里手动触发。

- `sync`：读取数据源，校验并切分经历，同步变更；内容未变的段保留解析结果，不调用模型。只从命令行运行。
- `derive`：抽取能力词和投入档、对齐序列；按批提交，端点故障中止这一轮，下一轮接着。
- `review`：维护词表。每个还没判过的短说法交给判定方，判它和谁是同一件事、属于哪个更宽的词、自成一项，或者不是一项能力。一个词只判一次；判得不对的，管理员在标签页退回重新判定。每轮最后按此刻的人数给每一项定名字：用这一项里写的人最多的写法。

提示词或判定标准变化后，旧的解析结果自动重新生成，期间检索继续读上一版，全部解析完后一次替换。换模型不作废已有结果。

### 更新表结构

`src/db/schema.ts` 变了（比如新增一列）要上线时：先停应用和后台任务，备份整个 Postgres 并确认能恢复，备份含业务数据，不进版本库。然后运行 `bun run db:push`，逐项核对它列出的差异，只应用这次的结构调整；出现计划外的删除、重建或截断就取消、先查明原因，不用 `--force`。完成后再启动应用。

## 接入数据源

所有适配器输出 [`src/corpus/contract.ts`](src/corpus/contract.ts) 定义的 `employees`、`assignments`、`external` 和 `levels`，可选再给记录的三批：`streams`（记录流：评级或状态）、`scales`（评级流的档位表）和 `records`（一期一档的评级、一段一段的状态）；以及公司知识的五批：`industries`（行业树）、`companies`（公司和所属集团）、`company_industries`（公司做哪些行业、哪些是主营）、`company_circles`（名企组合）和 `company_aliases`（经历上的公司写法对到哪家公司）。公司是什么不由本项目判断，数据源给结论；对不上的公司写法按人数列在同步报告里。同一人同一期的几条修订按登记时刻只留最终一条，分不出的整组拒绝并报告。契约逐行核验必需列，显式空值可以保留，缺列则报告表名、行号和列名并拒绝。通用校验、切段与解析在 `src/corpus/pipeline.ts`，适配器只负责源字段转换。

职级和学历按档检索。`levels` 是职级表，写明每个职级归哪一档、档有多高，分档方法由数据源自己定；学历写契约里的五档之一（高中及以下、大专、本科、硕士、博士），源里的写法由适配器归档。筛选和「某档及以上」都按档走，职级原文只在详情里显示。

两种接入方式：

1. 按 [`src/corpus/sources/csv-dir.ts`](src/corpus/sources/csv-dir.ts) 文件头的格式导出 CSV，并设置 `TALENT_CSV_DIR`：`employees`、`assignments`、`external`、`levels` 四个必需，记录的三个和公司知识的五个各自可选。
2. 实现一个导出 `extract(report): Promise<SourceData>` 的模块，并将 `TALENT_SOURCE` 设为该文件的绝对路径。

`src/corpus/sources/` 默认忽略私有适配器，只保留 `csv-dir` 与合成样例。私有模块在运行时加载，不进入 Vite 构建产物。适配器使用的 npm 包应安装在根 `package.json`，以便从项目根 `node_modules` 解析。

## 模型与数据边界

模型端点会收到人才库里的内容，要部署在这些数据可以去的范围内，由部署方按数据政策选择内网或公网服务：

| 能力 | 接收的数据 | 未配置时 |
|---|---|---|
| 查询理解 | 用户输入、当前条件、工具查到的人数与人才库里的写法（说法、公司、部门、学校），以及要读的候选经历：公司或部门、序列、岗位、技能和简历原文。请求里没有姓名和工号 | 只有关键词搜索 |
| 抽取与对齐 | 入职前岗位、公司和描述 | 解析跳过 |
| 词表整理 | 短说法与人数 | `REVIEW_JUDGE=off` 时不运行 |
| 嵌入 | 进词表的短说法 | 整理不收集要判的词 |

真实员工数据、导出结果和真实验收用例不得进入版本库。

## 外部判定

`REVIEW_JUDGE` 决定词表整理由谁判定：

```dotenv
REVIEW_JUDGE=model      # 使用 REVIEW_MODEL，未设置时回退到 EXTRACT_MODEL
REVIEW_JUDGE=external   # 使用外部判定接口
REVIEW_JUDGE=off        # 不运行整理
REVIEW_TOKEN=...        # external 模式必需
```

外部接口使用 `Authorization: Bearer <REVIEW_TOKEN>`：

- `GET /api/review?limit=20`：返回尚未判定的词（`words`，每项是提交时要带回的 `id` 和 `guideIdentity`、要判的词 `word`、人数 `people`、参考词 `near` 和收集时间 `collectedAt`），以及判定标准的原文和身份（`guide`）。
- `POST /api/review`：提交一个词的首份判定；请求必须原样带回 `id` 和 `guideIdentity`，并写上判定方的名字 `judge` 和这个词的 `judgment`。

`judgment` 是 `why`、`kind` 与 `target` 三项，均为字符串：`kind` 取「同一件事」「属于」「自成一项」「不是能力」之一；`target` 在同一件事时是一个参考词，在属于时是更宽的词（参考词或判定方起的名字），其余两种为空字符串。缺字段不算有效判定。请求正文最多 64 KiB，按 UTF-8 字节计算。接口只保存判定原话，整理任务在写者锁内校验并生效；它不允许直接修改词表或经历边。请求封装格式错误返回 400，凭据错误返回 401，不可用、词不在队列里或判定标准已更新返回 404，重复提交返回 409。

## 配置

配置放在 `.env.local` 或运行环境中。完整示例见 [.env.example](.env.example)。

| 变量 | 必需 | 说明 |
|---|---|---|
| `DATABASE_URL` | 是 | Postgres 17 连接串 |
| `EMBED_BASE_URL` / `EMBED_MODEL` / `EMBED_SPACE_ID` | 否 | 嵌入端点、模型与向量缓存的空间身份；只有词表整理找参考词用，不配时整理不收集要判的词 |
| `LLM_BASE_URL` / `LLM_MODEL` | 否 | 查询理解端点与模型，须支持工具调用；不配时只有关键词搜索。一轮要读上千段经历，用不带思考的快模型（带思考的模型设 `LLM_ENABLE_THINKING=false`） |
| `EXTRACT_BASE_URL` / `EXTRACT_MODEL` | 否 | 抽取与模型整理的聊天端点，对齐默认沿用 |
| `ALIGN_MODEL` | 否 | 序列对齐模型，默认使用 `EXTRACT_MODEL` |
| `ALIGN_BASE_URL` / `ALIGN_API_KEY` | 否 | 对齐专用端点；未设地址时沿用抽取端点与密钥，设了地址则只使用对齐密钥 |
| `REVIEW_MODEL` | 否 | 整理模型，默认使用 `EXTRACT_MODEL` |
| `REVIEW_JUDGE` / `REVIEW_TOKEN` | 否 | 判定方与外部接口凭据 |
| `TALENT_SOURCE` | 否 | `csv-dir` 或私有适配器的绝对路径 |
| `TALENT_CSV_DIR` | 否 | `csv-dir` 的输入目录；默认使用合成样例 |

各端点的 API key、超时与并发见 `.env.example`。模型、归一化或端点行为变化时更换 `EMBED_SPACE_ID`，旧向量不再被读到。

读候选经历时每批最多 160 段。模型的上下文放不下 160 段长原文时，设 `LLM_READ_BATCH_BYTES` 限制每批 JSON 的 UTF-8 字节数：单段超过时完整单发，不截断或跳过；端点仍放不下时这次处理失败。字节数不是 token 上限，也不包括系统提示词、工具定义和输出，按实际模型的上下文容量留余量。

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

测试需要可连接的 Postgres 17，只用合成样例和进程内假模型，不会访问真实数据源或模型端点。

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
