import "@tanstack/react-start/server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { prunePhrases } from "#/corpus/phrases";
import { phrasesOf } from "#/corpus/route-texts";
import { asReader, authorizedPool } from "#/db/snapshot";
import { contactKeys } from "#/identity/contacts";
import { exactMatch, matches } from "#/identity/match";
import { periods, type Resume, resumeSchema, sanitized } from "./resume";
import type { Touch } from "./touch";
import { appendTouch } from "./touch-store";

export type ImportRow = {
	id: string;
	owner_id: string;
	pool_id: string;
	file_id: string;
	sha256: string;
	day: string;
	draft: Resume | null;
	touch: Touch | null;
};

async function saveProfile(c: PoolClient, t: ImportRow, r: Resume, id: string) {
	const created = await c.query<{ id: string }>(
		`insert into profile_source(person_id,source_kind,pool_id,resume_file_id,filename,created_by,captured_at,parsed)
		select $1,'pdf_resume',pool_id,file_id,filename,owner_id,created_at,$3 from resume_import where id=$2 returning id`,
		[id, t.id, r],
	);
	const profile = created.rows[0]?.id;
	if (!profile) throw new Error("未创建资料");
	const latest = await c.query<{ id: string }>(
		"select id from profile_source where person_id=$1 and pool_id=$2 order by captured_at desc,seq desc limit 1",
		[id, t.pool_id],
	);
	if (latest.rows[0]?.id !== profile) return;
	const member = (
		await c.query<{ contacts: Resume["contacts"] }>(
			"select contacts from pool_member where pool_id=$1 and person_id=$2",
			[t.pool_id, id],
		)
	).rows[0];
	const contacts = {
		phone: r.contacts.phone || member?.contacts.phone || "",
		email: r.contacts.email || member?.contacts.email || "",
		wechat: r.contacts.wechat || member?.contacts.wechat || "",
	};
	await c.query(
		`insert into pool_member(pool_id,person_id,added_by,contacts) values($1,$2,$3,$4)
			on conflict(pool_id,person_id) do update set contacts=excluded.contacts`,
		[t.pool_id, id, t.owner_id, contacts],
	);
	await c.query(
		"delete from person_identity where person_id=$1 and origin=$2",
		[id, t.pool_id],
	);
	for (const h of contactKeys(contacts))
		await c.query(
			"insert into person_identity(person_id,kind,value,origin) values($1,$2,$3,$4) on conflict do nothing",
			[id, h.kind, h.value, t.pool_id],
		);
	// 同一池用最新一份简历找人。旧版的原件和归属继续供核对。
	await c.query(
		"delete from profile_experience pe using profile_source s where pe.profile_id=s.id and s.person_id=$1 and s.pool_id=$2",
		[id, t.pool_id],
	);
	for (const e of periods(r, t.day)) {
		const segment = await c.query<{
			id: number;
			derived_identity: string | null;
		}>(
			`insert into experience(person_id,kind,company,title,description,start_date,end_date,months)
			values($1,'external',$2,$3,$4,$5,$6,$7) on conflict(content_key) do update set months=greatest(experience.months,excluded.months) returning id,derived_identity`,
			[id, e.company, e.title, e.description, e.startDate, e.endDate, e.months],
		);
		const row = segment.rows[0];
		if (!row) throw new Error("未保存经历");
		await c.query(
			"insert into profile_experience(profile_id,person_id,experience_id) values($1,$2,$3) on conflict do nothing",
			[profile, id, row.id],
		);
		if (row.derived_identity !== null) continue;
		for (const p of phrasesOf(
			{
				...e,
				kind: "external",
				unemployed: false,
				seqL1: "",
				seqL2: "",
				seqL3: "",
			},
			null,
		)) {
			await c.query(
				"insert into phrase(text) values($1) on conflict(text_key) do nothing",
				[p.text],
			);
			await c.query(
				"insert into experience_phrase(experience_id,route,phrase_id) select $1,$2,id from phrase where text_key=md5($3) on conflict do nothing",
				[row.id, p.route, p.text],
			);
		}
	}
	await c.query(
		"delete from experience e where e.person_id=$1 and not exists(select from profile_experience p where p.experience_id=e.id)",
		[id],
	);
	await prunePhrases(c);
}
export type Decision =
	| { action: "new"; draft?: Resume; touch?: Touch }
	| { action: "link"; personId: string; draft?: Resume; touch?: Touch }
	| { action: "cancel" };

function candidates(c: PoolClient, t: ImportRow, r: Resume) {
	return asReader(c, t.owner_id, () => matches(c, r, t.day, t.file_id));
}

export async function classifyImport(c: PoolClient, t: ImportRow, raw: Resume) {
	const r = sanitized(resumeSchema.parse(raw));
	await authorizedPool(c, t.owner_id, t.pool_id);
	const alternatives = await candidates(c, t, r);
	const exact = await exactMatch(c, alternatives, r, t.day, t.owner_id);
	if (exact) return publish(c, t, r, exact.personId, "duplicate");
	const missing = r.experiences.some(
		(e) => !e.start || !e.end || (!e.title && !e.company),
	);
	if (
		alternatives.length ||
		missing ||
		r.reviewReason ||
		!r.experiences.length
	) {
		await c.query(
			"update resume_import set status='review',draft=$2,message=$3 where id=$1",
			[
				t.id,
				r,
				r.reviewReason ||
					(missing || !r.experiences.length
						? "请核对简历中的经历和日期"
						: "请核对是否为同一人"),
			],
		);
		return false;
	}
	return publish(c, t, r, null, "added");
}

export async function adjudicateImport(
	c: PoolClient,
	t: ImportRow,
	choice: Decision,
) {
	await authorizedPool(c, t.owner_id, t.pool_id);
	if (choice.action === "cancel") {
		await c.query(
			"update resume_import set status='cancelled',file_id=null,draft=null,touch=null,message='' where id=$1",
			[t.id],
		);
		return false;
	}
	const r = sanitized(resumeSchema.parse(choice.draft ?? t.draft));
	const task = { ...t, touch: choice.touch ?? t.touch };
	if (choice.action === "new") return publish(c, task, r, null, "added");
	if (!(await candidates(c, t, r)).some((m) => m.personId === choice.personId))
		throw new Error("找不到可关联的档案，请重新核对");
	return publish(c, task, r, choice.personId, "added");
}

async function publish(
	c: PoolClient,
	t: ImportRow,
	r: Resume,
	existing: string | null,
	status: "added" | "duplicate",
) {
	periods(r, t.day);
	const id = existing ?? randomUUID();
	if (!existing)
		await c.query(
			"insert into person(person_id,name,school,education_level,education_rank) values($1,$2,$3,$4,array_position(array['高中及以下','大专','本科','硕士','博士'],$4))",
			[id, r.name, r.school, r.education],
		);
	const original = await c.query(
		"select 1 from profile_source where person_id=$1 and pool_id=$2 and resume_file_id=$3",
		[id, t.pool_id, t.file_id],
	);
	if (!original.rowCount) {
		await saveProfile(c, t, r, id);
		await c.query(
			"insert into audit_event(user_id,action,person_id) values($1,$2,$3)",
			[t.owner_id, existing ? "talent-link" : "talent-add", id],
		);
	}
	if (t.touch && (t.touch.touched || t.touch.notes))
		await appendTouch(c, t.owner_id, t.pool_id, id, t.touch);
	await c.query(
		"update resume_import set status=$2,draft=null,touch=null,file_id=null,person_id=$3,message='' where id=$1",
		[t.id, status, id],
	);
	return !original.rowCount;
}
