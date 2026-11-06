# 检索重构设计稿：数据目录、SQL 条件与固定结果契约

状态：方向已于 2026-11-06 确定，契约待两条原型验证后定稿。本文描述目标形态和迁移路径；
原型过程中改动的部分回写到这里，定稿后并入 [PROJECT.md](PROJECT.md) 与 `AGENTS.md`，本文删除。

## 1. 要解决的问题

现在查询只有一种形状：`Condition[]`，两类条件、九个手写字段（`search/condition.ts`）。
每加一维（绩效、高潜、晋升）要改表结构、契约、维度表、条件类型、提交 schema、提示词、
工具枚举、关键词框和筛选栏七八处；「三年内两次高绩效」「在甲公司做过推荐系统并只按那段算」
「晋升后绩效仍是 A」这类要求没有落点。查询理解模型只能在预先挖好的坑里填值。

重构后，系统里只有三样东西：

1. **数据目录**：有哪些数据、每项什么含义，模型读得懂。
2. **可执行的查询**：一组条件，每条内部用 SQL 自由组合目录里的数据，外部形状固定。
3. **给 HR 的解释**：每条条件的一句话、强度、停用状态和单独人数。

新接入一种数据，只需要同步它、在目录里声明它；条件类型、提示词、chip、筛选栏不再逐维改。

### 不变的原则

- 名单只从检索来：谁在名单上、排第几由执行层和 `rank.ts` 决定，模型不产出、不增删、不重排人。
- 名次只衡量做过什么：深度 = 相关度 × 投入 × 累计时长 × 近因；背景条件和人的条件只定去留和固定加分。
- 分面、总数、名次来自同一次检索。
- 查询理解模型只收到聚合反馈（人数、分布、写法），收不到任何一个人的姓名、工号、经历内容；
  个人证据直接交给界面。
- 查询记录不可变、可回放；每一轮说得出加了什么、去掉了什么。
- 不静默降级。

### 已拍板的假设

- 排名规则沿用。绩效、高潜等记录只作门槛或固定加分，不进深度；「按绩效排」另议。
- 原型用合成数据，不等真实绩效的接入方式确定。
- 旧记录不迁移数据：旧条件表在读取时编译成新查询（§7），照常执行。
- 「独立模型读 SQL 写说明、和标签比对」只是可评估的辅助措施，不是正确性保证。
- 模型不读个人语料，不做逐人比较与推荐。这是本阶段的边界，不是永久决定。

## 2. 总览

```
HR 一句话 ──► 查询理解（模型 + 三个工具）──► Query（§4）──► 执行外壳（§5）──► rank.ts ──► 名单、证据、分面
                 │                                              │
                 │ discover / probe / submit                      │ 目录视图（§3）+ 语义命中表
                 ▼                                              ▼
            只有人数和写法                               只读角色、函数白名单、超时（§6）
```

模型写的是每条条件的 `WHERE`；FROM、输出列、去重、排除顺序、累计、打分全在外壳里，模型碰不到。

## 3. 数据目录

### 3.1 目录是什么

目录是一份模型可读的清单，由代码从视图声明生成，不是手写文档。每个目录项对应 `catalog` schema
里的一个视图，声明它的列、类型、中文名、含义和口径；运行时补上活的统计（行数、覆盖的期次、
有限取值列的取值和人数）。静态部分进查询理解的系统提示词，活的部分由 `discover` 工具按需返回。

视图声明放在 `src/search/catalog.ts`，形状：

```ts
type CatalogView = {
  name: string;            // 视图名，也是 SQL 里的关系名
  label: string;           // 中文名
  rows: string;            // 一行是什么：「一个员工」「一段工作经历」「一期绩效」
  columns: CatalogColumn[];
  notes: string[];         // 口径：缺失算什么、怎么去重、能不能跨期比
  stats: (store) => Promise<CatalogStats>;  // 活的统计
};
type CatalogColumn = {
  name: string; type: "text" | "int" | "float" | "date" | "bool";
  label: string; meaning: string;
  values?: "enum" | "ordinal";   // 有限取值：enum 只筛，ordinal 还能比高低（配 *_rank 列）
};
```

目录文本是提示词的一部分，所以它也是解析版本之外的另一份「标准」：目录变了，验收重跑。

### 3.2 首批视图

全部视图只暴露给只读角色（§6）。不含姓名；描述原文（`experience.description`）也不进视图：
语义匹配已经覆盖它，模型不需要按原文筛。

**`person`** 一行一个员工（来自 `employee`）：

| 列 | 含义 |
| --- | --- |
| `emp_id` | 工号，只作关联键，不发给模型 |
| `level_band`, `level_rank` | 当前职级档、档高（`ordinal`） |
| `education`, `education_rank` | 学历档、档高（`ordinal`） |
| `school`, `school_tier`, `overseas` | 最高学历的学校、学校档（`enum`）、是否海外（`enum`：是/否/没有记录） |
| `recruitment` | 招聘渠道（`enum`） |
| `hire_date` | 入职日 |
| `cur_dept`, `cur_seq_l1`, `cur_seq_l2`, `cur_seq_l3` | 当前部门与序列 |

**`experience`** 一行一段工作经历（`experience` 表去掉待业段）：

| 列 | 含义 |
| --- | --- |
| `id`, `emp_id` | 段身份、人 |
| `kind` | `internal` 公司内任职 / `external` 入职前 |
| `start_date`, `end_date`, `months` | 起止与单段月数；`end_date` 为空表示至今 |
| `company`, `company_tag` | 入职前：公司名、公司档（`enum`）；公司内为空 |
| `department`, `department_path` | 公司内：末级部门、部门路径；入职前为空 |
| `title`, `level` | 岗位名、登记职级原文 |
| `seq_l1`, `seq_l2` | 序列：登记的优先，没有才取对齐的（和今天 `FACT_COLUMNS` 同一表达式） |
| `skills` | 抽取的能力词标准写法及其全部父词（数组，供分面；和今天同一表达式） |

**`hit`** 一行是一个语义词在一段经历上的一次命中，每次检索由外壳物化（§5.1），只在那次检索的
事务里可见：

| 列 | 含义 |
| --- | --- |
| `term` | 条件里声明的语义词名（`terms` 的键） |
| `experience_id`, `emp_id` | 命中的段、人 |
| `route` | 命中的是哪一类说法：`role`/`title`/`skill`/`description` |
| `relevance` | 重排相关度，已按词表修正（`search/phrases.ts`） |
| `phrase` | 命中的说法文本（只有抽取的那类带） |
| `engagement` | 投入档（只有技能带） |
| `value` | 命中的是这条条件 `terms` 里的哪个词 |

**`rating`** 一行一期评级（新表 `employee_record`，§3.3）：

| 列 | 含义 |
| --- | --- |
| `emp_id`, `stream` | 人、记录流（如 `perf`） |
| `period_start`, `period_end` | 这一期的起止日 |
| `value`, `value_rank` | 档名、档高（`ordinal`，按 `scale`） |

口径写在目录里：同一人同一期只有一行（修订只留最终）；没有某一期的行表示没有记录，不表示
任何档；期次长度由 `scale` 所在流声明，「三年」按日期算，不按期数换算。

**`status`** 一行一段状态（高潜池、人才梯队）：`emp_id`, `stream`, `value`, `valid_from`, `valid_to`
（为空表示仍有效）。「当前在池里」是 `valid_to is null or valid_to >= current_date`。

**`scale`** 一行一个档：`stream`, `value`, `rank`, `label`。职级档、学历档、绩效档都在这里，
`person` 和 `rating` 的 `*_rank` 列从它来。模型比高低只比 `rank`，不比档名字面。

**`event`**（晋升、调动）本批不建。职级档变化不等于晋升，等业务给出确认的事件源再接。

### 3.3 新数据怎么进来

```
employee_record(emp_id, stream, kind, period_start, period_end, value, source, synced_at)
record_stream(stream, kind: 'rating' | 'status', label, period_label, notes)
```

适配器契约（`corpus/contract.ts`）新增 `records` 和 `streams` 两批行；同步与员工、经历同一事务、
同一写者锁。`rating`、`status` 是 `employee_record` 按 `kind` 切出的视图。`scale` 由适配器的
`levels` 和各流的档位表合并而成。去重（同一人同一期多条修订）在同步时做，并报告数量。

管理页「数据」展示每条流的覆盖：多少人、哪些期、最近一期。

## 4. 查询与条件

### 4.1 形状

```ts
type Query = { conditions: QueryCondition[] };

type QueryCondition = {
  /** 服务端发的稳定身份：沿用的条件带原 id，新写的不带，提交后由服务端补上 */
  id: string;
  /** 模型写给 HR 的一句话：这条在找什么。不当作已验证的解释 */
  label: string;
  mode: "must" | "boost" | "exclude";   // exclude 只允许 from: "experience"
  off?: "user";                          // 只有用户能停用
  from: "experience" | "person";
  /** 只有 from: "experience" 可写：这条要按意思找的词，键是 hit.term 的取值 */
  terms?: Record<string, string[]>;
  /** SQL 布尔表达式。别名固定：experience 的段是 e、命中是 h；person 的人是 p */
  where: string;
  /** where 里 :name 引用的绑定参数；chip 上可改的数字从这里来 */
  params?: Record<string, string | number>;
  /** 只有 from: "experience"：合格段累计月数门槛，外壳在去重后算 */
  minMonths?: number;
};
```

一条条件的四种角色，和今天 `result.ts` 的 `queryOf` 一一对应：

| from | terms | mode | 角色 | 产出 |
| --- | --- | --- | --- | --- |
| experience | 有 | must / boost | 经历主张（今天的 `Claim`） | 事实行，进名次和证据 |
| experience | 无 | must / boost | 背景（「待过字节」「入职前 3 年以上」） | 合格段，只定去留或加分 |
| experience | 有或无 | exclude | 排除 | 被否决的段 |
| person | 无 | must / boost | 人的条件 | 人的集合 |

### 4.2 例子

```jsonc
// 在甲公司做过推荐系统，只按那段算
{ "label": "入职前在甲公司做过推荐系统", "mode": "must", "from": "experience",
  "terms": { "t1": ["推荐系统", "推荐算法"] },
  "where": "h.term = 't1' and e.kind = 'external' and e.company ilike :company",
  "params": { "company": "%甲公司%" } }

// 三年内至少两次高绩效（高绩效 = A 档及以上，档高从 scale 查）
{ "label": "近三年至少两次绩效 A 及以上", "mode": "must", "from": "person",
  "where": "(select count(*) from rating r where r.emp_id = p.emp_id and r.stream = 'perf'
             and r.period_end >= current_date - interval '3 years'
             and r.value_rank >= (select rank from scale where stream = 'perf' and value = :band)) >= :times",
  "params": { "band": "A", "times": 2 } }

// 现在在高潜池里（加分）
{ "label": "目前在高潜池", "mode": "boost", "from": "person",
  "where": "exists (select 1 from status s where s.emp_id = p.emp_id and s.stream = 'hipo'
            and (s.valid_to is null or s.valid_to >= current_date))" }

// 不要入职前的实习
{ "label": "不算入职前的实习经历", "mode": "exclude", "from": "experience",
  "terms": { "x": ["实习"] }, "where": "h.term = 'x' and e.kind = 'external'" }

// 入职前累计三年以上在大厂（背景，无语义词）
{ "label": "入职前在头部大厂累计三年以上", "mode": "must", "from": "experience",
  "where": "e.kind = 'external' and e.company_tag = '头部大厂'", "minMonths": 36 }
```

修饰语归属同一段还是不同段，体现在写进同一条的 `where` 还是分成两条；模型读句子时判断，
HR 看标签核对。

### 4.3 校验

提交时按顺序检查，任何一步不过都把原因回给模型：

1. 形状：zod；`exclude` 只在 experience；`terms` 只在 experience；标签过 `lib/internal-words.ts`。
2. 解析：用 Postgres 自己的解析器（`libpg-query`）把 `where` 解析成 AST：
   必须是单个布尔表达式；只能引用 `catalog` 里的关系和本条允许的别名（person 条件不能碰 `h`、`hit`）；
   函数只允许白名单（日期、聚合、字符串比较、`coalesce`/`nullif`/`case`）；不允许 `pg_*`、
   大对象、`dblink`、系统目录、`SET`、子查询外的任何语句。
3. 参数：`:name` 全部在 `params` 里，类型是字符串或数字。
4. 试跑：每条单独执行一遍（§5），拿到人数；语义词一个人都找不到、名字一个都匹配不到、
   SQL 执行报错，都退回模型。和今天一样，问题出在用户明说的要求上时原样再提交一次通过。

`params` 里的 LIKE 模式由模型写，`%`、`_` 的转义不是注入问题（整条语句只读、已解析），
但会影响匹配正确性；关键词模式和旧条件编译时走 `escapeLike`，模型写的在试跑人数里暴露。

### 4.4 身份与差异

条件 id 由服务端发（短随机串）。`changesOf` 比较 id：沿用的 id 内容变了算「改了」，
新 id 算「加了」，消失的 id 算「去掉了」。内容相等的定义是 `mode`、`from`、`terms`、`where`、
`params`、`minMonths` 全等；文本不同含义相同的两条算两条，这是接受的代价。

## 5. 执行外壳

`search/execute.ts` 取代今天 `search.ts` 里按条件类型手写的取数；`rank.ts`、`phrases.ts`、
`result.ts`、`empty.ts` 保留。顺序固定，模型写不到：

### 5.1 物化命中

收集全部条件的 `terms`，去重后交给 `withMatchedPhrases`（召回加重排，快照外调模型，快照内取数），
在检索事务里建临时表 `hit`，每条条件按自己的强度取门槛：正向 `RELEVANCE_MIN`，排除
`RELEVANCE_MIN_EXCLUDE`。词表修正（`throughVocabulary`）在这里做完。

### 5.2 排除

对每条 `exclude`，执行

```sql
select e.id from catalog.experience e [join hit h on h.experience_id = e.id and h.cond = $1]
where (<where>)
```

得到被否决的段 `vetoed`。排除不带视图筛选，和今天一样。

### 5.3 每条 must / boost

- experience 有 terms：
  ```sql
  select e.*, h.* from catalog.experience e
  join hit h on h.experience_id = e.id and h.cond = $1
  where e.id <> all($vetoed) and (<where>)
  ```
  外壳按（人，段）去重，留相关度乘投入系数最高的一行（和 `rank.ts` 的 `closer` 一致），
  得到这条的事实行；`minMonths` 在去重后按人累计合格段的月数判。
- experience 无 terms：同上不 join，产出合格段；must 时有合格段（且累计够 `minMonths`）的人进候选，
  boost 时记为满足一条偏好。
- person：
  ```sql
  select p.emp_id from catalog.person p where (<where>)
  ```
  must 进候选交集，boost 记为满足一条偏好。

### 5.4 候选与名次

- 有 must 的经历主张：候选 = 各 must 主张事实行的人的交集 ∩ 各 must 背景、人的条件的人集。
- 没有 must 的经历主张：候选从 `person` 出，∩ 各 must 门槛；没有经历证据的人也在。
- `rank.ts` 原样消费事实行与偏好集合：深度、AND 判定、分面、总数、翻页都不变。
- 事实上限 `FACT_MAX`、人群上限 `RESULT_MAX`、空态原因沿用。

每条语句都在同一个 repeatable read 快照里、同一个 `SET LOCAL ROLE talent_query` 之下执行。

### 5.5 和今天的对应

| 今天 | 重构后 |
| --- | --- |
| `factsSql` 按主张拼段谓词 | 模型写 `where`，外壳只拼 FROM、JOIN、去重 |
| `gateConds` / `fetchPreferred` | person 条件、无 terms 的 experience 条件 |
| `vetoSql` | exclude 条件 |
| `FACT_COLUMNS` | `catalog.experience` 的列定义 |
| `dimCond` 下推 URL 筛选 | 不变：URL 筛选仍是外壳加的谓词，不进条件 |

## 6. 执行隔离

独立模块 `server/sandbox.ts`，两层：

**解析层**（§4.3 第 2 步）：AST 白名单。关系只能是 `catalog.*` 和 `hit`；函数白名单显式列出；
拒绝一切非 SELECT 节点。

**数据库层**：角色 `talent_query`，`NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`，
只有 `catalog` schema 的 `USAGE` 和视图的 `SELECT`，对 `public` 无权限；
执行前 `SET LOCAL ROLE`、`SET LOCAL transaction_read_only = on`、`SET LOCAL statement_timeout`、
`SET LOCAL work_mem`、`SET LOCAL search_path = catalog, pg_temp`。临时表 `hit` 由应用角色在同一会话建，
`SET LOCAL ROLE` 后仍可见。

错误回给模型前脱敏：只保留 SQLSTATE、Postgres 的一句错误文本和位置，不带查询计划、不带行数据。
一次理解内试跑和提交加起来的语句数有上限（沿用 `AGENT_STEPS`），每条语句有超时。

## 7. 两种搜索、旧记录与关键词模式

- `SearchSpec` 变成 `{ query: Query }`。关键词链仍存框里的词（`Keywords`），执行时由
  `search/compile.ts` 编译成 Query：每个经历词一条 experience 主张，公司、部门各一条背景，
  学校一条 person，累计年限写到各主张的 `minMonths`。标签由编译器生成，输入框能从 `Keywords` 读回。
- 旧的 `Condition[]` 由同一个 `compile.ts` 编译成 Query，模板固定、可测试；旧记录不改数据，
  读取时编译，显示和执行都照常。`condition.ts` 的类型保留为「旧记录的形状」，不再接受新写入。
- 两条链的区别不变：链头有原话是对话，链头是 `Keywords` 是关键词。

## 8. 查询理解

三个工具，替换今天的查经历、查属性、提交：

| 工具 | 输入 | 返回 | 记步 |
| --- | --- | --- | --- |
| `discover` | 视图名或列名，可空 | 该项的活统计：行数、有限取值的取值和人数、记录流的覆盖期次 | 是 |
| `lookup_experience` | 几个经历词 | 和今天一样：人数、对应的标准能力词、宽细词 | 是 |
| `probe` | 一份完整 Query | 每条的人数、总人数、每条的校验问题 | 是 |
| `submit` | 一份完整 Query 和说明 | 通过，或问题列表 | 否 |

静态目录（视图、列、口径）直接写在系统提示词里；提示词只交代目标、三样东西的含义、
怎么写 `where`、提交后的反应，不规定查几次。`TurnNotes`（说明与选项）不变，选项是整份 Query。

人数仍只给模型「多少人」，取值和写法沿用 `MIN_PEOPLE_TO_SHOW` 的最小人数门槛；
`probe` 的次数受 `AGENT_STEPS` 限制，防止反复收窄逼近个人。

界面：线程里逐步显示 `discover` 查了什么、`probe` 试出多少人。

## 9. 界面

- chip：标签、强度字样、停用虚线、删除格不变；chip 右端加单独人数。`params` 里的数字先不开放直接编辑，
  改数字走对话；执行器从第一天支持绑定参数，界面编辑是后续增量。
- 名单、证据行、详情、分面、筛选栏不变：事实契约没变。
- 说明和选项不变。

## 10. 验收

### 10.1 原型一：三年内两次高绩效

合成样例 `records.csv`：半年一期的 `perf` 流，档 `C < B < B+ < A < A+`。人物：

| 人 | 记录 | 期望 |
| --- | --- | --- |
| R1 | 近三年 A、B、A、B、B、B | 进名单（两次 A） |
| R2 | 近三年 A、B、B、B、B、B，三年零一天前另有一个 A | 不进（边界外） |
| R3 | 同一期两条修订 A 和 B，最终为 B；其余 B | 不进（修订去重后只有 0 次 A） |
| R4 | 只有两期记录，都是 A | 进；缺失的期不算低绩效也不算高 |
| R5 | 没有任何绩效记录 | 不进；「从没拿过 C」这种否定条件也不因缺记录而满足 |

检查：模型写出的条件在 `probe` 里人数正确；换成「连续两期 A」「从没拿过 C」各一条用例。

### 10.2 原型二：限定公司内的语义经历

合成样例：

| 人 | 经历 | 期望 |
| --- | --- | --- |
| E1 | 甲公司推荐系统 12 个月；乙公司推荐系统 96 个月 | 进名单；证据只有甲那段；累计 12 个月 |
| E2 | 甲公司推荐系统 36 个月 | 进名单，排在 E1 前 |
| E3 | 乙公司推荐系统 60 个月 | 不进 |
| E4 | 甲公司推荐系统 6 个月（实习）；另有排除条件「不要实习」 | 不进：唯一证据被否决 |

检查：名单、证据行、累计时长、名次四项都只用合格证据；分面人数与总数一致。

### 10.3 边界

- 整轮理解发给模型的内容里没有姓名、工号、经历原文（测试抓发出的请求体）。
- 解析层拒绝：引用 `public.employee`、`pg_sleep`、`pg_read_file`、多语句、`SET`。
- 数据库层拒绝：即使解析层放过，角色也读不到目录外的表。
- 旧记录编译：现有 `tests/search.test.ts` 的全部用例改成经 `compile.ts` 跑，结果不变。

## 11. 迁移顺序

每一步都能跑 `bun run verify`。

1. **目录与数据**：`catalog` schema 与首批视图；`employee_record`、`record_stream`、`scale`；
   契约与 `csv-dir` 样例加 `records`；同步写入与去重；管理页覆盖展示。
2. **执行外壳与沙箱**：`execute.ts`、`sandbox.ts`、`compile.ts`；旧 `Condition[]` 和 `Keywords`
   经编译执行，`search.test.ts` 全部通过；`search.ts` 里按类型手写的取数删除。
3. **查询理解**：Query 的 zod 与解析校验；三个工具；提示词；`trace` 新步骤；`eval:understand`
   改成按名单与证据打分，加 §10 的样例。
4. **界面**：chip 的人数；线程新步骤；设计系统页面。
5. **收尾**：`condition.ts` 收缩为旧记录形状；`AGENTS.md` 与 `PROJECT.md` 改写；本文删除。

原型一、二在第 3 步末验收，不过不进第 4 步。

## 12. 要改写的规则

`AGENTS.md` 里与新形态冲突、定稿时要改的条目：

- 「查询的唯一表示是 `Condition[]`」「条件只有两种」：改为 Query 与四种角色。
- 「检索 SQL 手写，集中在 `search/phrases.ts` 和 `search/search.ts`」：改为外壳手写；条件的 `where`
  由模型写，经解析白名单与只读角色执行。
- 「模型看不到整张条件表搜出多少人」：改为模型通过 `probe` 看到人数与分布，不看人。
- 「查询理解有三个工具」：换成 §8 的四个。
- 「SQL 的 ILIKE 输入必须经过 `escapeLike`」：限定为编译器生成的谓词；模型写的模式由试跑人数暴露。
- 「公开表结构唯一来源是 `src/db/schema.ts`」：视图定义也在 `schema.ts`，`db:push` 一并建。

## 13. 待定

- 绩效流的期次单位和档位表由谁给：适配器（随同步）还是管理页上传。影响 `record_stream` 的写者。
- 「按绩效排」要不要做；做的话是注册在 `scale` 上的一个「可计分」标记，还是单独的排序维。
- `probe` 返回分面分布到什么粒度；最小人数门槛是否也用于人数本身。
- 标签与 SQL 的比对调用要不要上线，还是只在验收里跑。

## 14. 实现中的调整

第 1–2 步落地时和上文不一致、以这里为准的地方：

**目录（§3）**

- 视图声明（`search/catalog.ts`）的列是按视图列名做键的对象，类型绑定 `db/schema.ts` 里的视图：
  视图多一列、声明少写一列，类型检查不过。声明里没有 `stats`，活的统计归 `discover`（第 3 步）。
  列类型多一种 `text[]`（`skills`）。
- 视图把空串归成空值（`nullif`），目录统一写「空值表示没有记录」。`overseas` 取值是「是」「否」，
  没有记录为空值，不另设第三个取值。
- `scale` 没有 `label` 列（没有读者）。
- `hit` 除了目录里的列，还有外壳排序去重用的 `cond`、`value_idx`、`phrase_id`。它只能经别名 `h`
  读，不能在子查询里另外 `from hit`。
- 记录表落成 `employee_record(emp_id, stream, period_start, period_end, value)`，主键
  （人，流，期始）；`kind` 在 `record_stream(stream, kind, label, period, notes)` 上；不存
  `source`、`synced_at`（没有读者）。评级要求期末，状态的期末可空。
- 契约多三批行：`streams`、`scales`（评级流的档位表）、`records`，都可省略。`level`、`education`
  是保留的流名，`scale` 里这两套由 `levels` 和学历五档合并而来。修订去重按（人，流，期始）留
  登记时刻最晚的一条；分不出最晚的（同一时刻或缺登记时刻）整组拒绝，报告组数。

**执行外壳（§5）**

- 必须的门槛和 URL 上的公司、部门、学校筛选照旧作为按人谓词放进每一条取数语句，没有改成先取
  人集再求交集：语义相同，事实上限 `FACT_MAX` 的触发点也和今天一致。
- 否决的段是子查询（`e.id not in (…)`），不是数组参数。
- 名单要显示的姓名和经历原文在离开只读角色后按 id 读。

**执行隔离（§6）**

- `libpg-query` 18.2.2 在 Bun 和 Node 下都能跑（WASM）。它没有反解析，执行的文本由扫描器的词法单元
  重新拼出：去掉注释，括号必须配平，再整句解析核对。
- 关系名不带 schema（`search_path` 是目录和临时表），带 schema 的写法拒绝。目录 schema 名默认
  `catalog`，可由 `TALENT_CATALOG_SCHEMA` 指定（测试每个文件一套）。
- 不带前缀的列名只在子查询里允许，且最内层只有一个关系有这一列。不允许窗口函数、`lateral`、
  `natural` / `using` 连接。数字参数按 `numeric` 绑定。
- 只读角色由应用在每个进程第一次执行前建好、授权（advisory lock 排队；含默认授权，重建的视图
  也带上），部署不另设一步。应用的数据库用户因此要么能建角色，要么事先建好 `talent_query`
  并把它授予应用用户。
- `SET LOCAL ROLE` 挡的是读写，不挡 `RESET ROLE`：能到数据库的只有白名单里的表达式，
  `set_config` 这类函数不在白名单里，换角色的路由解析层挡住。
- 错误回给模型时不带位置：执行的是重拼的文本，位置对不上模型写的原文。

**旧记录（§7）**

- 编译出的条件 id 是旧条件 `conditionKey` 的短哈希（`c` 加 16 位十六进制），同一条旧条件每次编译
  得到同一个 id；`terms` 的键是 `what`，证据行上的名字是第一个语义词。
- 关键词链存的已经是框里的词能写回、读回的那种条件表（`keywords.ts`），经同一条
  `compileConditions` 编译，不另设 `Keywords → Query` 的入口。

第 3 步落地时：

**查询与记录（§4、§7）**

- 记录里的 `SearchSpec` 是 `{ conditions }`（关键词链与较早的对话记录，读取时编译）或
  `{ query }`（新的对话轮次）两种之一；关键词链继续只存框里写得出的条件表。
- 条件的身份按 id 加内容（`contentKey`：强度、FROM、语义词、`where`、参数、累计时长）认，标签和
  停用不算内容。模型沿用一条时照抄 id；没写 id、内容和上一轮某一条相同的，服务端给它那一条的 id。
  停用只在 id 和内容都没变时从上一轮带过来；`changesOf` 也按 id 加内容比。
- 发给模型的当前条件不带停用（和今天一样），模型照抄 id 就会原样带回。

**查询理解（§8）**

- `discover` 答四种问：总览（各视图行数、记录流覆盖）、有限取值列的取值和人数、
  公司/部门/学校按名字匹配（部门只给人数）、问不了的原因。岗位、经历原文这类列不列取值。
- `probe` 的粒度：每条单独的人数、整份的人数、每条的问题，不给分面分布（§13 第三条）。单条人数和
  执行同一套规则：经历条件只算没被排除否决的段，写了累计时长的按去重后的段累计，排除数的是它否决了
  多少人的段。
- 提交检查不再查「词表外取值」（模型写的是 SQL，取值由 `discover` 查到），换成：这一轮新写或改过的
  正向条件一个人都找不到、新写的语义词一个人都找不到、整份事实超限。用户点名的名字找不到人时，
  原样再提交就通过。
- 沙箱补一条：`emp_id` 只能出现在两列之间的 `=`、`count()` 的参数和 `group by` 里，不能和常量比；
  数据类错误（SQLSTATE 22 类）回给模型时不带取值。
- 查询理解最多 8 步（`AGENT_STEPS`），最后一步只能提交。
- 提示词：一段任职的性质（实习、兼职）按岗位名字面写（`e.title ilike`），不写成语义排除——语义
  排除的门槛更严（`RELEVANCE_MIN_EXCLUDE`），「实习」对「推荐系统实习生」够不上，原型二因此改了
  这条判断。整份搜出多少人、是不是没人不在说明里说，也不替 HR 提议放宽；点名的公司、学校没有人时
  条件照写、说一句。
- 标签与 SQL 的独立比对（§13 第四条）不上线，第 3 步也没有做成单独的模型调用：验收按名单与证据
  打分，标签说的和 SQL 搜的不一致会落在名单上；`EVAL_SHOW_SQL=1` 把每条的 SQL 列在标签旁边给人读。

**验收（§10）**

- `eval:understand` 的 `has` 不再按条件原样比，改成新表里有一条同强度、同 FROM、单独搜出同一群人
  的条件；新增 `includes`、`excludes`、`before`、`evidence` 四项按真实执行的名单和证据打分。
  沿用旧用例的 `base`、`drop` 写的是一行查询语法，编译后按 id 加内容比。
- 原型一、二在合成样例同步出的库上验收；抽取网关未运行，抽取和对齐按「未配置」跳过，自述按整段
  原文检索。`tests/execute.test.ts` 用手写的查询在临时 schema 上覆盖同样的人，日期按数据库的今天
  往回推。

第 4 步落地时：

- chip 上的人数就是 `probe` 的每条人数（`search.ts` 的 `conditionCounts`），和线程里试搜的是同一个数：
  这一条单独在整个人才库里能找到多少人，不随名单上的筛选变；排除写成「排除 N 人」，停用的不写。
  它随 `loadWorkbench` 和名单一起取，只给对话链（关键词链没有 chip）。
- 看目录这一步在线程里的标题写列的中文名（「查看学历」「查找公司」），记录流写流的名字
  （「绩效的档」），不写目录里的英文名。
- 组件多一个 `FilterChipCount`，在开关最右边、箭头前，字色比强度弱一档、数字等宽。
