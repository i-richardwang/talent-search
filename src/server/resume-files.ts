import "@tanstack/react-start/server-only";
import { corpusTransaction } from "#/corpus/session";
import { pool } from "#/db";
import { withReadSnapshot } from "#/db/snapshot";
import type { Resume } from "#/ingestion/resume";
import { files } from "#/storage/files";

// 所有创建和清理共用写者锁。失败时元数据留存，下次继续清理。
export async function collectFiles() {
	await corpusTransaction(async (c) => {
		const { rows } = await c.query<{
			id: string;
			sha256: string;
		}>(`select id,sha256 from resume_file f where not exists(select from profile_source s where s.resume_file_id=f.id)
			and not exists(select from resume_import t where t.file_id=f.id) order by f.created_at,f.id limit 256`);
		for (const f of rows) {
			await files.delete(f.sha256);
			await c.query("delete from resume_file where id=$1", [f.id]);
		}
	});
}

export async function sourcesFor(user: string, personId: string) {
	const sources = await withReadSnapshot(
		{ account: user },
		async (c) =>
			(
				await c.query<{
					id: string;
					filename: string;
					uploader: string;
					pool_id: string;
					pool: string;
					day: string;
					contacts: Resume["contacts"];
					notes: string;
					periods: {
						company: string;
						title: string;
						start: string;
						end: string;
					}[];
					touched: string | null;
					can_remove: boolean;
				}>(
					`select s.id,s.filename,coalesce(u.name,'') as uploader,s.pool_id,p.name as pool,to_char(s.captured_at,'YYYY-MM-DD') as day,(select coalesce(jsonb_agg(jsonb_build_object('company',e->>'company','title',e->>'title','start',e->>'start','end',e->>'end')),'[]') from jsonb_array_elements(s.parsed->'experiences') e) as periods,m.contacts,m.notes,m.touched_at::text as touched,
		(m.added_by=$2 or exists(select from auth_user where id=$2 and role='admin')) as can_remove
		from profile_source s left join auth_user u on u.id=s.created_by join talent_pool p on p.id=s.pool_id join pool_member m using(pool_id,person_id)
		where s.person_id=$1 order by s.captured_at desc,s.seq desc`,
					[personId, user],
				)
			).rows,
	);
	return sources;
}

type Original = { sha256: string; size_bytes: number; filename: string };
export async function pendingResumeResponse(user: string, task: string) {
	const record = await withReadSnapshot(
		{ account: user },
		async (c) =>
			(
				await c.query<Original>(
					`select f.sha256,f.size_bytes,t.filename from resume_import t join resume_file f on f.id=t.file_id
		where t.id=$1 and t.status in ('review','failed')`,
					[task],
				)
			).rows[0],
	);
	return record
		? pdfResponse(record, false)
		: new Response(null, { status: 404 });
}
export async function resumeResponse(
	user: string,
	source: string,
	download: boolean,
) {
	const record = await withReadSnapshot(
		{ account: user },
		async (c) =>
			(
				await c.query<Original & { person_id: string }>(
					`select f.sha256,f.size_bytes,s.person_id,s.filename from profile_source s join resume_file f on s.resume_file_id=f.id where s.id=$1`,
					[source],
				)
			).rows[0],
	);
	if (!record) return new Response(null, { status: 404 });
	const response = await pdfResponse(record, download);
	await pool.query(
		"insert into audit_event(user_id,action,person_id) values($1,$2,$3)",
		[user, download ? "resume-download" : "resume-preview", record.person_id],
	);
	return response;
}
async function pdfResponse(record: Original, download: boolean) {
	const bytes = await files.get(record.sha256);
	if (bytes.byteLength !== record.size_bytes)
		throw new Error("原件长度与登记值不符");
	return new Response(new Uint8Array(bytes), {
		headers: {
			"Content-Type": "application/pdf",
			"Content-Length": String(bytes.byteLength),
			"Cache-Control": "private, no-store",
			"X-Content-Type-Options": "nosniff",
			"Content-Security-Policy": "sandbox",
			"Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(record.filename).replace(/'/g, "%27")}`,
		},
	});
}
