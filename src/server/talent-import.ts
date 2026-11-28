import "@tanstack/react-start/server-only";
import { APICallError } from "ai";
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
import { openResumePdf } from "#/ingestion/pdf";
import {
	adjudicateImport,
	classifyImport,
	type Decision,
	type ImportRow,
} from "#/ingestion/publish";
import type { Resume } from "#/ingestion/resume";
import type { Touch } from "#/ingestion/touch";
import { digest, files } from "#/storage/files";

const taskQuery = `select t.*,f.sha256,to_char(t.created_at at time zone 'UTC','YYYY-MM-DD') as day from resume_import t join resume_file f on f.id=t.file_id`;

export async function uploadResume(
	user: string,
	poolId: string,
	name: string,
	bytes: Uint8Array,
	touch: Touch | null = null,
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
			"insert into resume_import(pool_id,owner_id,file_id,filename,touch) values ($1,$2,$3,$4,$5) returning id",
			[
				poolId,
				user,
				fileId,
				name.slice(0, 255),
				touch?.touched || touch?.notes ? touch : null,
			],
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
type ImportStage =
	| "资料权限"
	| "原件读取"
	| "PDF 解析"
	| "离线模型"
	| "资料发布";
function failureReason(stage: ImportStage, error: unknown) {
	if (stage !== "离线模型") return "处理失败";
	if (!process.env.RESUME_BASE_URL?.trim() || !process.env.RESUME_MODEL?.trim())
		return "端点未配置";
	for (let e = error; e instanceof Error; e = e.cause) {
		if (e.name === "TimeoutError" || e.name === "AbortError")
			return "请求超时或中止";
		if (APICallError.isInstance(e) && Number.isInteger(e.statusCode))
			return `HTTP ${e.statusCode}`;
	}
	return "连接失败或未提交有效结果";
}
async function processClaimed(worker: PoolClient) {
	const { rows } = await worker.query<ImportRow>(`with next as (
		update resume_import set status='processing' where id=(select id from resume_import where status in ('queued','processing') order by created_at,id limit 1) returning *)
		select t.*,f.sha256,to_char(t.created_at at time zone 'UTC','YYYY-MM-DD') as day from next t join resume_file f on f.id=t.file_id`);
	const task = rows[0];
	if (!task) return false;
	let stage: ImportStage = "资料权限";
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
					`select parsed from profile_source where resume_file_id=$1 order by captured_at desc,seq desc limit 1`,
					[task.file_id],
				);
				return rows[0]?.parsed;
			},
		);
		let draft = saved;
		if (!draft) {
			stage = "原件读取";
			const original = await files.get(task.sha256);
			stage = "PDF 解析";
			const pdf = await openResumePdf(original);
			try {
				stage = "离线模型";
				draft = await parseResume(pdf, task.day);
			} finally {
				await pdf.close();
			}
		}
		stage = "资料发布";
		await corpusTransaction(async (c) => {
			const lock = await c.query(
				"select 1 from resume_import where id=$1 and status='processing' for update",
				[task.id],
			);
			if (lock.rowCount) await classifyImport(c, task, draft);
		});
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "55P03") {
			await pool.query(
				"update resume_import set status='queued' where id=$1 and status='processing'",
				[task.id],
			);
			return false;
		}
		// PDF 与端点异常都可能含原件内容，仅记录步骤、系统任务编号和受控原因。
		console.error("简历导入失败", {
			task: task.id,
			stage,
			reason: failureReason(stage, error),
		});
		await pool.query(
			"update resume_import set status='failed',message=$2 where id=$1 and status='processing'",
			[task.id, "解析未完成，可重试或手动核对"],
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
		if (choice === "retry") {
			await authorizedPool(c, user, task.pool_id);
			await c.query(
				"update resume_import set status='queued',message='' where id=$1",
				[id],
			);
			return;
		}
		return adjudicateImport(c, task, choice);
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
		return { draft: t.draft, touch: t.touch, candidates };
	});
	if (review.candidates.length)
		await pool.query(
			"insert into audit_event(user_id,action,person_id) select $1,'view',id from unnest($2::text[]) id",
			[user, review.candidates.map((c) => c.personId)],
		);
	return review;
}
