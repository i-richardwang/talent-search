# talent-search · 人才搜索

面向 HR 与业务负责人的人才搜索工具。它从 HRIS 任职记录和外部候选人简历中寻找人才，并把每项匹配还原到可核对的经历证据。

- 产品目标与范围：[docs/PROJECT.md](docs/PROJECT.md)
- 开发约定：[AGENTS.md](AGENTS.md)

## 本地运行

需要 Bun 1.4+ 和 Postgres 17，不需要额外的扩展。模型端点按用到的能力配：聊天端点读简历并判词表；嵌入端点只供词表整理给要判的词找相近的参考词；查询理解端点负责 AI 搜索（理解需求、逐段确认是否符合、为入围证据评匹配分），不配时只有关键词搜索。

```bash
docker run -d --name talent-pg \
  -e POSTGRES_USER=talent -e POSTGRES_PASSWORD=talent -e POSTGRES_DB=talent \
  -p 55434:5432 postgres:17

cp .env.example .env.local
# 编辑 .env.local：设置数据库、模型配置；用 openssl rand -base64 32 生成 BETTER_AUTH_SECRET。
bun install
bun run db:push
bun run auth:user create --username admin --name 管理员 --role admin --org 示例科技
bun run sync
bun run dev
```

应用默认监听 `http://localhost:3100`。默认数据源是 `src/corpus/sources/sample/` 中的合成样例；启动后，后台任务会继续完成抽取、序列对齐和词表整理。

页面和 AI 的读取在读者角色 `talent_reader` 下进行，数据库按本次账号有权访问的员工资料和人才池过滤人员、经历、联系方式与原件；
AI 写的筛选在只读角色 `talent_query` 下执行。应用的数据库用户要么能建角色，要么事先建好这两个角色并授予应用用户。
应用的数据库用户是表的属主：同步、简历入池、解析和整理以它的身份写入，不受读取策略约束；读取一律先切到读者角色，范围不随应用用户的权限扩大。

## 登录与账号管理

所有页面都要求登录，不开放注册，没有默认账号。普通用户可以搜索、查看人才库和标签；只有管理员能看「任务」「审计」和「账号」、
手动触发解析或整理，在「标签」页复查判成不是能力的词、退回重新判定。搜索记录只属于发起它的账号，别人的记录打不开，管理员也一样。
外部解析和词表整理分别使用独立的 `DERIVE_TOKEN` 和 `REVIEW_TOKEN`。

管理员在「审计」页可以查看搜索、个人详情、导出、账号变更和外部服务读取经历的记录。导出、外部读取、已入池原件的预览和下载按人记录。候选人入池、关联和移除同样留痕。

每个账号有几个组织路径。员工资料随当前部门授权，能看上级组织的账号也能看其下级。人才池可设为所有登录账号可见，或挂靠到某个组织，沿用同一方向的授权。员工资料和池内资料分别授权，同一个人只展示一次。只有人才池权限时，搜索、详情、导出和 AI 只读该池公开给这个账号的资料。管理员管全局任务、审计和账号，搜索时也遵守资料权限。

管理员在「账号」页建账号（选普通用户或管理员，选数据范围）、重置密码、改数据范围、设为或取消管理员、停用和恢复，自己的账号除外；
新密码由服务端生成，只显示一次。第一个管理员由能登录部署机器的人在终端里建；命令行什么账号都能管，
密码输入不回显，操作不记进操作记录。组织写完整的部门路径，级与级之间用 `>`；`>` 在终端里是重定向，路径要加引号：

```bash
bun run auth:user list
bun run auth:user create --username admin --name 管理员 --role admin --org 示例科技
bun run auth:user create --username hr_user --name 招聘同事 --org "示例科技>出行事业部"
bun run auth:user set-scope --username hr_user --org "示例科技>出行事业部" --org "示例科技>增长中心"
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

三种任务同一时刻只运行一个，运行记录都在 `/tasks`；解析和整理也能在那里手动触发。管理员可在「解析」卡片切换「自动解析经历」，保存后立即生效，重启后保留。关闭时，定时检查和外部结果提交都不会启动新一轮解析，已开始的任务会继续；仍可点「立即运行」或执行 `bun run derive`。首次设置前默认开启，部署可用 `DERIVE_SCHEDULE_ENABLED=false` 指定初始关闭。

- `sync`：读取数据源，校验并切分经历，同步变更；内容未变的段保留解析结果，不调用模型。只从命令行运行。
- `derive`：抽取能力词和投入档、对齐序列；按批提交，端点故障中止这一轮，下一轮接着。
- `review`：维护词表。每个还没判过的短说法交给判定方，判它和谁是同一件事、属于哪个更宽的词、自成一项，或者不是一项能力。一个词只判一次；判得不对的，管理员在标签页退回重新判定。每轮最后按此刻的人数给每一项定名字：用这一项里写的人最多的写法。

提示词或判定标准变化后，旧的解析结果自动重新生成，期间检索继续读上一版，全部解析完后一次替换。换模型不作废已有结果。

每段最多保留 30 项能力。同一个词出现多次时取最深的投入档。通常每个词不超过 16 个字符，有空位时可补入岗位或描述中出现的英文全名，最长 24 个字符，可以直接作为关键词检索。只改能力词的校验规则时，解析会重新使用已保存的模型回答。

### 更新表结构

`src/db/schema.ts` 变了（比如新增一列）要上线时：先停应用和后台任务，备份整个 Postgres 并确认能恢复，备份含业务数据，不进版本库。然后运行 `bun run db:push`，逐项核对它列出的差异，只应用这次的结构调整；出现计划外的删除、重建或截断就取消、先查明原因，不用 `--force`。完成后再启动应用。

`db:push` 不比较视图的定义，也不写读取策略的条件：改了视图先删掉库里的旧视图再 push；读取策略的条件由应用在每个进程第一次读之前照 `schema.ts` 写上，没写上之前读者一行都读不到。

### 已使用 PDF 人才池的数据库补入版本序号

此步骤适用于已有 `profile_source` 且尚无 `seq` 列的数据库。先停应用及作业，在备份副本执行下列事务。已有资料沿用原先的同刻排序，随后发布的资料由数据库分配序号。

```sql
begin;
alter table public.profile_source add column seq integer;
with ordered as (
  select id, row_number() over (order by captured_at, id desc) as n
  from public.profile_source
)
update public.profile_source s set seq = o.n from ordered o where o.id = s.id;
alter table public.profile_source
  alter column seq set not null,
  alter column seq add generated always as identity;
select setval(pg_get_serial_sequence('public.profile_source', 'seq'),
              coalesce(max(seq), 1), count(*) > 0) from public.profile_source;
drop view catalog.person, catalog.experience, catalog.rating, catalog.status,
  public.scope_member, public.person_card, public.visible_employment,
  public.visible_pool, public.visible_profile, public.visible_segment cascade;
commit;
```

随后运行 `bun run db:push` 重建视图与依赖的读取策略。遇到 `profile_original_per_pool_person` 的唯一约束提示，选择保留表数据（`No, add the constraint without truncating the table`）。重启应用后首次读取会装载 RLS 条件。切换连接前用授权账号与受限账号分别核对资料。

### 从员工单表版本升级

在独立数据库恢复原库备份，保留原库作为回退点。停用副本上的应用和作业，先将旧 `public` 和 `catalog` 分别重命名为 `employee_archive`、`catalog_archive`，创建新的 `public`。归档 schema 仅部署角色可访问，撤回读者角色及 PUBLIC 的使用权限。让 `DATABASE_URL` 指向副本，依次执行：

```sh
bun run db:push
bun run db:import-employees employee_archive
```

导入只接受空目标，在一个事务内复制账号、搜索链、审计、词表、模型缓存和经历，保留段编号并转换人员键与既有判断的内容键。核对输出的人员、经历、审计条数与旧表一致，使用受限账号核对旧搜索与组织范围后再切换应用连接。迁移和新一轮 HRIS 同步是两个独立步骤。

## 从 PDF 导入人才

1. 登录后打开「人才池」，选目标池，选择一份或多份 PDF。每份最多 20 MiB、120 页。内置的「外部人才池」初始对所有登录账号公开。管理员可新建人才池，或将已有池挂靠到授权范围内的部门。
2. 后台按页取文字，由独立的离线模型通过工具提交结构化简历。上传页显示排队、解析、待确认和入池结果。识别不清的页、缺失的日期或疑似同一人的资料可人工核对。上传者可在核对窗口打开本次原件，对照修改或删除经历，也可以重试失败文件。核对原件要求同时拥有该任务和目标池的读取权限。
3. 同一原件或核心身份及完整经历相同的简历自动去重。手机号、邮箱相同，或姓名与学校学历、任职公司及时间相符，会提示并排核对。选择关联已有档案、另建一人或放弃。比对的范围与操作者的搜索权限一致。人工选择另建会分配独立的人员编号。同池同人的同一原件再次上传只产生导入记录。
4. 入池后可立即按岗位、职责原文和人才池检索，能力标签和序列随后由现有解析流程补齐。可在详情登记最近接触日期和备注。在个人详情查看原始日期粒度、预览或下载历次 PDF。录入者或管理员可更新该池成员的资料，新版只覆盖非空的联系方式。每个池用最近采集的简历提供搜索经历，采集时刻相同时使用后发布的一版。同一段经历有多个来源时只计一次。

配置 `RESUME_BASE_URL`、`RESUME_MODEL` 和可选的 `RESUME_API_KEY`，指向允许接收**完整简历和联系方式**的自部署工具调用模型。端点独立于查询和能力抽取。PDF 和扫描页在本机处理，扫描页可配置本地 Tesseract 和语言包（`RESUME_OCR_BIN`、`RESUME_OCR_LANG`）。经历入库前剥离电话、邮箱与微信等联系方式。下游模型仍会收到公司、岗位和清理后的经历原文，部署范围应允许处理这些资料。

原件按 SHA-256 写入 `TALENT_FILES_DIR`，默认是工作目录下的 `.talent-files/`。生产使用持久卷，多实例共享同一目录。备份与恢复需要同时覆盖数据库和原件目录。移出某一人才池会撤回该池的资料和版本，其他来源继续有效，最后一条引用消失后回收文件。

## 接入 HRIS 数据源

所有适配器输出 [`src/corpus/contract.ts`](src/corpus/contract.ts) 定义的 `employees`、`assignments`、`external`、`levels` 和 `sequences`，可选再给记录的三批：`streams`（记录流：评级或状态）、`scales`（评级流的档位表）和 `records`（一期一档的评级、一段一段的状态）；以及公司知识的五批：`industries`（行业树）、`companies`（公司和所属集团）、`company_industries`（公司做哪些行业、哪些是主营）、`company_circles`（名企组合）和 `company_aliases`（经历上的公司写法对到哪家公司）。公司是什么不由本项目判断，数据源给结论；对不上的公司写法按人数列在同步报告里。同一人同一期的几条修订按登记时刻只留最终一条，分不出的整组拒绝并报告。契约逐行核验必需列，显式空值可以保留，缺列则报告表名、行号和列名并拒绝。`assignments` 的 `department_path` 从最上一级（集团）写到这一段所在的部门，级与级之间用 `>`，账号的数据范围按它一级一级地分。通用校验、切段与解析在 `src/corpus/pipeline.ts`，适配器只负责源字段转换。

`sequences.csv` 每行是一对公司现行的一级和二级岗位序列（`seq_l1`、`seq_l2`），两列都必填，组合唯一。各组织共用这份目录；没有可选序列时提供只有表头的文件。更新目录后，系统沿用同一标准下的能力抽取，只按新目录重新判断外部经历的序列。

职级和学历按档检索。`levels` 是职级表，写明每个职级归哪一档、档有多高，分档方法由数据源自己定；学历写契约里的五档之一（高中及以下、大专、本科、硕士、博士），源里的写法由适配器归档。筛选和「某档及以上」都按档走，职级原文只在详情里显示。

`bun run sync --people-only` 只读取员工、经历、职级和按期记录，保留现有的公司与序列目录。`bun run sync --knowledge-only` 只发布公司、行业、别名与序列目录，可以从独立的 CSV 目录运行。默认 `bun run sync` 仍在同一事务内发布完整快照。

员工源可以额外提供 `phone`、`email` 及已人工确认的 `linked_person_id`。前两项归一化后保存摘要用于比对。已确认的人员编号用于将新工号关联到已有候选人，冲突会中止本次同步。多个工号在同一快照指向一人，或指向已绑定其他在职工号的人时，整批回滚。HRIS 快照只对账自身的雇佣关系、履历和按期记录。公共公司、行业和序列目录供两类经历共用，上传 PDF 时无需重复提交。

两种接入方式：

1. 按 [`src/corpus/sources/csv-dir.ts`](src/corpus/sources/csv-dir.ts) 文件头的格式导出 CSV，并设置 `TALENT_CSV_DIR`：`employees`、`assignments`、`external`、`levels`、`sequences` 五个必需，记录的三个和公司知识的五个各自可选。
2. 实现一个导出 `extract(report): Promise<SourceData>` 的模块，并将 `TALENT_SOURCE` 设为该文件的绝对路径。

`src/corpus/sources/` 默认忽略私有适配器，只保留 `csv-dir` 与合成样例。私有模块在运行时加载，不进入 Vite 构建产物。适配器使用的 npm 包应安装在根 `package.json`，以便从项目根 `node_modules` 解析。

## 模型与数据边界

PDF 解析端点部署在允许读取完整简历的离线环境。其他模型端点的部署范围按其实际接收的资料确定。

| 能力 | 接收的数据 | 未配置时 |
|---|---|---|
| 查询理解 | 用户输入、当前条件、工具查到的人数与人才库里的写法（说法、公司、部门、学校），以及要读的候选经历：公司或部门、序列、岗位、技能和简历原文。评分请求只含判据和已经确认符合的经历文字。以上请求均不附姓名和工号 | 只有关键词搜索 |
| PDF 解析 | PDF 各页完整文字、姓名与联系方式，仅交给独立配置的离线端点 | 可手工核对入池或配置后重试 |
| 抽取与对齐 | 外部岗位、公司和描述 | 内置模式缺少模型配置时使用原文，外部模式从接口接收结果 |
| 词表整理 | 待判词、参考词及其人数 | `REVIEW_JUDGE=off` 时不运行 |
| 嵌入 | 进词表的短说法 | 整理不收集要判的词 |

真实员工数据、导出结果和真实验收用例不得进入版本库。

## 用外部服务解析经历

按上文「更新表结构」完成 `db:push`，在运行服务端与命令行解析的进程中设置 `DERIVE_MODE=external` 和 `DERIVE_TOKEN`。若同时配置词表整理的 `REVIEW_TOKEN`，两个凭据必须取不同的值。启动应用后解析任务每五分钟检查一次，也可以运行 `bun run derive` 准备第一批经历。外部服务通过 HTTP 读取经历和提交结果，应用运行期间才能访问接口。

这个凭据允许读取全库需要解析的外部岗位、公司和完整职责描述。只发给允许接收这类数据的服务，它调用的模型也必须在同一数据使用范围内。返回数据前，应用在审计页记录外部解析服务读取了哪些人的经历。传输使用 HTTPS 或本机回环连接。

**取经历。** 请求带 `Authorization: Bearer <DERIVE_TOKEN>`。按任务类型请求 `GET /api/derive?kind=extract&limit=20` 和 `GET /api/derive?kind=align&limit=20`。响应中的 `instructions` 和 `schema` 说明这一批要提取什么、结果怎么写；`standard` 标识这份要求。`inputs` 每项包含 `id`、`title`、`company`、`description`。同一类任务中，相同输入只返回一份。没有职责描述的经历只需要对齐序列。空数组表示这一类目前没有可取的经历。

每次可取 1 至 100 项。多个服务一起处理时，可以约定相同的 `parts`（1 至 1024），分别传不同的 `part`（从 0 开始）。读取后断线可以重取；遇到长描述时保留完整原文。

**提交结果。** 把请求时的 `kind`、响应里的 `standard` 和对应的输入编号发到 `POST /api/derive`。以下为合成示例，请将标准标识和编号替换为 GET 返回的值。

```json
{
  "kind": "extract",
  "standard": "<GET 返回的 standard>",
  "results": [
    {"id": 12, "result": {"items": [{"text": "数据分析", "depth": "主导"}]}},
    {"id": 13, "result": {"items": []}},
    {"id": 14, "unable": true}
  ]
}
```

对齐结果为 `{"seq":"二级（一级）"}`，取值照抄当批列表；没有合适的序列时填 `{"seq":""}`。空列表和空序列都表示已完成判断。只有已经尝试且确实无法处理时才交 `unable: true`。断线或尚未处理的项留到下次。

每次提交 1 至 100 项，正文最多 512 KiB。响应 `results` 逐项返回状态。首次保存或重发相同结果为 `accepted`，已有不同结果为 `conflict`，当前输入或标准已失效为 `expired`，格式或序列取值有误为 `invalid`。提交项本身格式有误时，用从 0 开始的 `index` 指出位置。整个请求格式错误返回 400，超出正文上限返回 413，凭据错误返回 401，接口未启用返回 404。

自动解析开启时，收到新结果后，应用安排一轮解析。若已有任务在运行，定时任务会继续处理。任务页显示剩余的外部结果数和已解析的经历段数。一段经历所需结果齐备后才写入；标准变更时所有段完成后统一生效。切回默认的 `DERIVE_MODE=model` 可继续使用内置模型，已按相同标准生成的经历结果继续有效。

## 用外部服务整理词表

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

## 内置和外部 agent 通过 MCP 处理解析和整理

`DERIVE_MODE=model` 和 `REVIEW_JUDGE=model` 使用应用内置的 agent。任务收集待办后，模型调用 `derive_list` 读取经历、标准和回答格式，调用 `derive_submit` 提交抽取或对齐结果。整理模型用 `review_list` 读取词和参考词，用 `review_submit` 逐词提交判定。每批独立对话，模型能根据工具回执修正解析答案。只有工具接收的答案才计入进度，任务中断后下一轮从剩下的待办继续。

内置客户端通过进程内的 Streamable HTTP 请求调用同一套 MCP 工具，后台任务和 `bun run derive` 都可直接运行。模型端点须支持 OpenAI 兼容的多轮工具调用，包括 `tools`、`tool_choice=required` 和工具返回消息。抽取与对齐端点会收到当批岗位、公司和经历描述，整理端点会收到词、人数和参考词。部署方须选择允许接收这些数据的端点。

模型作答期间释放语料写者锁。工具只保存队列答案，解析和整理任务拿到写者锁后才让结果生效。切换内置和外部模式时，相同问题已接收的答案继续有效。

### 配置外部 agent

应用通过 **Streamable HTTP** 提供两个 MCP 连接。客户端直接连接部署地址，在每个请求的 `Authorization` 头发送对应的 Bearer 凭据。只做词表整理的 agent 配置第二个连接即可；同一个 agent 需要两组工具时配置两个连接。

| MCP 地址（相对于 `BETTER_AUTH_URL`） | 应用端配置 | 提供的工具 |
|---|---|---|
| `/api/mcp/derive` | `DERIVE_MODE=external` 和 `DERIVE_TOKEN` | `derive_list`、`derive_submit` |
| `/api/mcp/review` | `REVIEW_JUDGE=external` 和 `REVIEW_TOKEN` | `review_list`、`review_submit` |

例如应用在 `http://localhost:3100` 运行时，解析连接的 URL 为 `http://localhost:3100/api/mcp/derive`，请求头为 `Authorization: Bearer <外部解析凭据>`。远程部署使用应用的 HTTPS 地址，通过客户端的密钥配置传入凭据。反向代理须保留对外的 Host 并透传 SSE 响应流。能读取经历的 agent、它使用的模型和会话记录均须处于允许处理简历原文的范围内。

以 Codex CLI 为例，在运行客户端的环境中提供相应的令牌，再添加需要的连接。下列命令按环境变量名引用凭据。[Codex MCP 配置文档](https://developers.openai.com/codex/mcp/)

```bash
codex mcp add talent-derive --url http://localhost:3100/api/mcp/derive --bearer-token-env-var DERIVE_TOKEN
codex mcp add talent-review --url http://localhost:3100/api/mcp/review --bearer-token-env-var REVIEW_TOKEN
```

解析和整理任务负责准备待办，词表整理需要嵌入端点来收集待判词。MCP 单次请求（含协议字段）上限分别为 512 KiB 和 64 KiB。连接后可以直接交代以下任务。

- “把当前待处理的外部经历做完能力抽取和序列对齐。” Agent 分别用 `derive_list` 取 `extract` 和 `align`，按各批的说明和格式作答，用 `derive_submit` 交回，逐项核对回执，再取下一批。
- “按当前指南判完待整理的词。” Agent 用 `review_list` 取词，按 `guide` 判断，用 `review_submit` 逐词交回。回执中的 `taken` 表示已有判定，`missing` 表示问题已经失效。收到 `invalid` 时，可按指南修正后再交。

某一类取到空列表表示当下没有可领的题。应用随后运行解析、整理任务，让收到的结果生效。关闭自动解析时，可在任务页运行解析。

## 配置

配置放在 `.env.local` 或运行环境中。完整示例见 [.env.example](.env.example)。

| 变量 | 必需 | 说明 |
|---|---|---|
| `DATABASE_URL` | 是 | Postgres 17 连接串 |
| `EMBED_BASE_URL` / `EMBED_MODEL` / `EMBED_SPACE_ID` | 否 | 嵌入端点、模型与向量缓存的空间身份；只有词表整理找参考词用，不配时整理不收集要判的词 |
| `LLM_BASE_URL` / `LLM_MODEL` | 否 | 查询理解端点与模型，须支持工具调用；不配时只有关键词搜索。一轮要读上千段经历，用不带思考的快模型（带思考的模型设 `LLM_ENABLE_THINKING=false`） |
| `EXTRACT_BASE_URL` / `EXTRACT_MODEL` | 否 | 支持工具调用的抽取与词表整理端点，对齐默认沿用 |
| `ALIGN_MODEL` | 否 | 序列对齐模型，默认使用 `EXTRACT_MODEL` |
| `ALIGN_BASE_URL` / `ALIGN_API_KEY` | 否 | 支持工具调用的对齐专用端点，未设地址时沿用抽取端点与密钥，设了地址则只使用对齐密钥 |
| `REVIEW_MODEL` | 否 | 整理模型，默认使用 `EXTRACT_MODEL` |
| `DERIVE_MODE` / `DERIVE_TOKEN` | 否 | 经历解析方式和独立的外部服务凭据 |
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

`eval:extract` 和 `eval:review` 各自创建临时语料库，用配置的模型运行正式 MCP 工具。每次调用独立评分，在命令退出时清理用例和回答。

测试需要可连接的 Postgres 17，只用合成样例和进程内假模型，不会访问真实数据源或模型端点。

### 经历匹配度盲评

`bun run eval:match run` 用合成经历比较两种排序。正式需求放在本机的 `evals/match/` 下，用 `bun run eval:match corpus 用例.json` 在已经同步的人才库快照里取样。两种模式都调用配置的查询理解模型，仅发送单条判据和对应的经历文本。语料模式按命令行验收的数据范围读取，查询和结果均留在本机；真实用例不命名为 `sample.json`。

语料用例为 `{source, tasks: [{label, requirements: [{label, criterion, patterns, where, params?}]}]}`。每条需求有一项或多项必须满足的经历要求，背景限定写进对应经历的 `where`。先按字面选出满足全部条件的候选，保留排名前 20 人，并从其余名次等距抽取至多 20 人，每人保留全部命中段。

先用正式的是否判断固定入围人员和证据，再单独给符合的经历评 1–100 的整数匹配分。两份名单共用正式排序代码，基线使用投入、累计时长和近因，另一份额外使用匹配分。把两份前十的并集打乱后生成 `盲评.md`，评审填写优先看的编号；同目录的 `对照.json` 保留逐段分数，供揭盲复核。`bun run eval:match score 批次目录 [已填盲评.md]` 统计两种排序意见相反、且评审区分了先后的候选人对，按需求计胜负。每次运行使用独立批次目录。

## 代码结构

```text
src/identity/     身份特征和当前账号权限内的档案比对
src/ingestion/    PDF 取页、解析与资料发布
src/storage/      原件的内容寻址存储
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
