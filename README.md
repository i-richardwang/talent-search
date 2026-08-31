# talent-search · 人才搜索

面向 HR 与业务负责人的人才搜索工具。它从组织内任职和入职前工作经历中寻找候选人，并把每项匹配还原到可核对的经历证据。

- 产品目标与范围：[docs/PROJECT.md](docs/PROJECT.md)
- 数据、检索和界面设计：[docs/PLAN.md](docs/PLAN.md)
- 工程约束：[AGENTS.md](AGENTS.md)

## 本地运行

需要 Node.js 22、uv 和 Postgres 17。数据库必须启用 `pg_trgm`。

```bash
docker run -d --name talent-pg \
  -e POSTGRES_USER=talent -e POSTGRES_PASSWORD=talent -e POSTGRES_DB=talent \
  -p 55433:5432 postgres:17-alpine
docker exec talent-pg psql -U talent -d talent \
  -c "create extension if not exists pg_trgm"

cp .env.example .env.local
# 用上面这条 docker 命令的话不用改；连别的库就改 DATABASE_URL

npm install
uv sync
npm run db:push
uv run python etl/run.py   # 不配数据源时导入仓库自带的合成样例
npm run dev
```

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
| `DATABASE_URL` | 是 | Postgres 连接串 |
| `TALENT_SOURCE` | 否 | 数据源适配器名，默认 `csv_dir` |
| `TALENT_CSV_DIR` | 否 | `csv_dir` 的源目录，默认读仓库自带的合成样例 |
| `LLM_BASE_URL` | 否 | OpenAI 兼容端点；未配置时使用本地规则解析 |
| `LLM_MODEL` | 否 | 查询理解模型名 |
| `LLM_API_KEY` | 否 | 端点需要鉴权时填写 |
| `LLM_STRUCTURED_OUTPUTS` | 否 | 端点不支持 JSON Schema 时设为 `false` |
| `LLM_TIMEOUT_MS` / `LLM_MAX_OUTPUT_TOKENS` | 否 | 端点属性，默认 60000 / 8000 |

查询理解只发送用户输入和库内已有的公司档取值，不发送姓名、工号或个人经历。模型不可用时，检索自动使用确定性的本地解析。

## 常用命令

```bash
npm run dev          # 开发服务器
npm run query -- "算法、产品、后端都做过的"
npm run db:push      # 从 src/db/schema.ts 同步表结构
npm run verify       # 格式、类型、ETL、SQL/组件测试和生产构建
```

`npm test` 使用临时 schema 运行真实 SQL 集成测试，需要 `.env.local` 中有可连接的 `DATABASE_URL`。

## 数据边界

真实员工数据不进入版本库。ETL 从配置的数据源读取，完成校验、切段与描述对齐后，只写入 Postgres。仓库里的样例和测试夹具全部是合成数据。

表结构的唯一事实源是 `src/db/schema.ts`。Python 不建表，也不生成迁移；完整导入由 `etl/run.py` 统一执行。

字段去向与数据模型见 [docs/PLAN.md](docs/PLAN.md#2-数据流)。

## 代码结构

```text
etl/contract.py              源契约：适配器要交出的三张表
etl/pipeline.py              通用切段、校验与派生
etl/sources/                 数据源适配器（默认不进版本库）
etl/load.py                  批量写库
src/db/                      Drizzle 表结构与数据库连接
src/search/                  查询解析、匹配、排名、分面与结果契约
src/server/                  服务端函数、查询记录与唯一的模型适配层
src/routes/                  零态与搜索工作台
src/routes/-components/      两屏共用的界面组件
src/routes/-lib/             视图状态、筛选表、键盘流等非组件模块
src/components/              跨路由 React 组件
src/lib/                     跨层纯函数
tests/                       单元、渲染、边界与真 SQL 集成测试
```

核心边界：

- **数据源与管线之间只有一份契约。** 适配器交出三张摊平的表，管线负责所有人都逃不掉的
  那几条不变量。接第二个数据源时不会长出第二套「什么算一段经历」。见 `etl/contract.py`。
- **查询是一条记录，视图是几个 URL 参数。** 一次「我要找什么人」落成 `search_turn`
  的一行（原话、理解结果、降级标记、父记录），地址是 `/s/:turnId`；筛选与翻页
  留在 query string 里。前者值得留存、可重新理解、可分享出去必然复现，
  后者一次性。见 `src/server/turn.ts` 与 `src/routes/-lib/view-params.ts`。
- 页面经 `src/server/functions.ts` 与 `src/server/turn.ts` 访问数据库；
- `src/search/search.ts` 只产出命中事实，`src/search/rank.ts` 负责判定、打分、排序与分面；
- 页面可读取的结果形状位于 `src/search/result.ts`，不会把数据库依赖打进客户端；
- Kumo 是唯一的界面组件库，组件属性以本地 CLI 文档为准。

## 查询行为

- 必须词采用 AND；加分词只抬升排名；排除词剔除整个人；停用词保留配置但不参与当前检索。
- 中文匹配使用转义后的 `ILIKE`。整词无结果时可退到语料中真实存在的最长子串，并在对应条件上提示。
- 分面、总人数和排名消费同一份命中事实，计数单位统一为人。
- 分页通过扩大 `limit` 重新取得前 N 名，不使用 offset；界面会明确说明已显示数量、总数与上限。

## 许可证

[MIT](LICENSE)
