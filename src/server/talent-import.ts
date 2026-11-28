import "@tanstack/react-start/server-only";
import type { PoolClient } from "pg";
import {
	corpusTransaction,
	inTransaction,
	withCorpusWrite,
} from "#/corpus/session";
import { pool } from "#/db";
import { authorizedPool, withReadSnapshot } from "#/db/snapshot";
import { matches } from "#/identity/match";
import { parseResume } from "#/ingestion/parser";
import {
	type Decision,
	type ImportRow,
	resolveImport,
} from "#/ingestion/publish";
import { type Resume, resumeSchema } from "#/ingestion/resume";
import { digest, files } from "#/storage/files";

const taskQuery = `select t.*,f.sha256,to_char(t.created_at at time zone 'UTC','YYYY-MM-DD') as day from resume_import t join resume_file f on f.id=t.file_id`;

export async function uploadResume(
	user: string,
	poolId: string,
	name: string,
	bytes: Uint8Array,
) {
	if (
		!bytes.length ||
		bytes.length > 20 * 1024 * 1024 ||
		new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-"
	)
		throw new Error("请选择 20 MB 以内的 PDF 文件");
	return withCorpusWrite(async (c) => {
		const sha = digest(bytes);
		// 先登记内容键，再写原件。进程中断后没有引用的元数据仍能引导清理。
		const fileId = await inTransaction(c, async () => {
			await authorizedPool(c, user, poolId);
			const file = await c.query<{ id: string }>(
				"insert into resume_file(sha256,size_bytes) values($1,$2) on conflict(sha256) do update set sha256=excluded.sha256 returning id",
				[sha, bytes.length],
			);
			const id = file.rows[0]?.id;
			if (!id) throw new Error("未登记文件");
			return id;
		});
		await files.put(bytes);
		const task = await c.query<{ id: string }>(
			"insert into resume_import(pool_id,owner_id,file_id,filename) values ($1,$2,$3,$4) returning id",
			[poolId, user, fileId, name.slice(0, 255)],
		);
		const id = task.rows[0]?.id;
		if (!id) throw new Error("未创建导入任务");
		return id;
	});
}

export async function processNextResume() {
	const worker = await pool.connect();
	let discard = true;
	try {
		const lock = await worker.query<{ ok: boolean }>(
			"select pg_try_advisory_lock(hashtextextended(current_schema()||':resume-import',0)) as ok",
		);
		if (!lock.rows[0]?.ok) {
			discard = false;
			return false;
		}
		try {
			return await processClaimed(worker);
		} finally {
			await worker.query(
				"select pg_advisory_unlock(hashtextextended(current_schema()||':resume-import',0))",
			);
			discard = false;
		}
	} finally {
		worker.release(discard);
	}
}
async function processClaimed(worker: PoolClient) {
	const { rows } = await worker.query<ImportRow>(`with next as (
		update resume_import set status='processing' where id=(select id from resume_import where status in ('queued','processing') order by created_at,id limit 1) returning *)
		select t.*,f.sha256,to_char(t.created_at at time zone 'UTC','YYYY-MM-DD') as day from next t join resume_file f on f.id=t.file_id`);
	const task = rows[0];
	if (!task) return false;
	try {
		// 同一原件在允许读取的范围里已入过池，复用该文件的资料，不再向模型发送。
		const saved = await withReadSnapshot(
			{ account: task.owner_id },
			async (c) => {
				const entitled = await c.query(
					"select id from resume_import where id=$1 and status='processing'",
					[task.id],
				);
				if (!entitled.rowCount) throw new Error("资料权限已变更");
				const { rows } = await c.query<{ parsed: Resume }>(
					`select parsed from profile_source where resume_file_id=$1 order by captured_at desc,id limit 1`,
					[task.file_id],
				);
				return rows[0]?.parsed;
			},
		);
		const draft =
			saved ?? (await parseResume(await files.get(task.sha256), task.day));
		await corpusTransaction(async (c) => {
			const lock = await c.query(
				"select 1 from resume_import where id=$1 and status='processing' for update",
				[task.id],
			);
			if (lock.rowCount) await resolveImport(c, task, draft);
		});
	} catch (error) {
		if ((error as { code?: string }).code === "55P03") {
			await pool.query(
				"update resume_import set status='queued' where id=$1 and status='processing'",
				[task.id],
			);
			return false;
		}
		// 模型错误可能带原文，只有面向用户的固定内容进入任务。
		await pool.query(
			"update resume_import set status='failed',message=$2 where id=$1 and status='processing'",
			[
				task.id,
				error instanceof Error && error.message.startsWith("扫描件")
					? error.message
					: "解析未完成，可重试或手动核对",
			],
		);
	}
	return true;
}

export async function decideImport(
	user: string,
	id: string,
	choice: Decision | "retry",
) {
	return corpusTransaction(async (c) => {
		const { rows } = await c.query<ImportRow>(
			taskQuery +
				" where t.id=$1 and t.owner_id=$2 and t.status in ('failed','review') for update of t",
			[id, user],
		);
		const task = rows[0];
		if (!task) throw new Error("找不到待处理的简历");
		await authorizedPool(c, user, task.pool_id);
		if (choice === "retry") {
			await c.query(
				"update resume_import set status='queued',message='' where id=$1",
				[id],
			);
			return;
		}
		if (choice.action === "cancel") {
			await c.query(
				"update resume_import set status='cancelled',file_id=null,draft=null,message='' where id=$1",
				[id],
			);
			return;
		}
		return resolveImport(
			c,
			task,
			resumeSchema.parse(choice.draft ?? task.draft),
			choice,
		);
	});
}

export async function reviewImport(user: string, id: string) {
	const review = await withReadSnapshot({ account: user }, async (c) => {
		const { rows } = await c.query<ImportRow>(
			"select *,to_char(created_at at time zone 'UTC','YYYY-MM-DD') as day from resume_import where id=$1 and status in ('review','failed')",
			[id],
		);
		const t = rows[0];
		if (!t) throw new Error("找不到待核对的简历");
		const candidates = t.draft
			? await matches(c, t.draft, t.day, t.file_id)
			: [];
		return { draft: t.draft, candidates };
	});
	if (review.candidates.length)
		await pool.query(
			"insert into audit_event(user_id,action,person_id) select $1,'view',id from unnest($2::text[]) id",
			[user, review.candidates.map((c) => c.personId)],
		);
	return review;
}
