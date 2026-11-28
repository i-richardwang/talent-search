# 已有人才库升级

所有命令都在停写的备份副本上运行。按库中已有的数据结构选择以下步骤，在副本验收后切换连接。

## 已使用 PDF 人才池的数据库补入版本序号

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

## 将已有池成员的接触信息转为逐条记录

已有 `pool_member.touched_at`、`pool_member.notes` 的库，在停用应用和作业的备份副本上先保存非空记录，再执行 `bun run db:push`。同时需要补版本序号时，先执行上一节的 SQL，两节共用一次 push。归档仅部署角色可读。

```sql
begin;
create schema touch_archive;
revoke all on schema touch_archive from public;
create table touch_archive.member_touch as
  select pool_id, person_id, touched_at, coalesce(notes, '') as notes
  from public.pool_member where touched_at is not null or btrim(notes) <> '';
alter table public.pool_member drop column touched_at, drop column notes;
commit;
```

push 提示是否清空 `profile_source` 时选择保留数据（`No, add the constraint without truncating the table`）。创建 `pool_touch` 后执行以下回填。旧版只保存最后一次填写的日期和备注，无法还原撰写人，详情显示「历史记录（作者未登记）」。登记时间取回填时间，接触日期保留原值。

```sql
begin;
insert into public.pool_touch (pool_id, person_id, touched_at, notes)
  select a.pool_id, a.person_id, a.touched_at, a.notes from touch_archive.member_touch a
  where not exists (select from public.pool_touch t where t.pool_id=a.pool_id
                    and t.person_id=a.person_id and t.author_id is null);
select (select count(*) from touch_archive.member_touch) as archived,
       (select count(*) from public.pool_touch where author_id is null) as restored;
commit;
```

两项计数一致后，再用有权限的账号抽查详情并切换应用连接。新装库直接执行 `bun run db:push`。

## 从员工单表版本升级

在独立数据库恢复原库备份，保留原库作为回退点。停用副本上的应用和作业，先将旧 `public` 和 `catalog` 分别重命名为 `employee_archive`、`catalog_archive`，创建新的 `public`。归档 schema 仅部署角色可访问，撤回读者角色及 PUBLIC 的使用权限。让 `DATABASE_URL` 指向副本，依次执行：

```sh
bun run db:push
bun run db:import-employees employee_archive
```

导入只接受空目标，在一个事务内复制账号、搜索链、审计、词表、模型缓存和经历，保留段编号并转换人员键与既有判断的内容键。核对输出的人员、经历、审计条数与旧表一致，使用受限账号核对旧搜索与组织范围后再切换应用连接。迁移和新一轮 HRIS 同步是两个独立步骤。

## 已经使用统一人员编号的库

在停写的副本上运行 `bun run db:push` 建立每人唯一的 HRIS 资料索引，再运行 `bun run db:upgrade-queries`。已有资料沿用原编号。它在一个事务里转换保存的查询条件中的人员关联列，保留条件编号、命名参数和字面值。可以重复运行。员工单表归档导入已包含这一步。

详情链接使用 `person_id`。按工号收藏的链接，仅在当前账号有权查看该雇佣关系时可打开。
