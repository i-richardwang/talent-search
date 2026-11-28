import "@tanstack/react-start/server-only";
import type { PoolClient } from "pg";
import { asReader } from "#/db/snapshot";
import type { Resume } from "#/ingestion/resume";
import { periods } from "#/ingestion/resume";
import { contactKeys } from "./contacts";

export type Match = {
	personId: string;
	name: string;
	school: string;
	education: string;
	sameFile: boolean;
	sameIdentity: boolean;
	jobs: { company: string; title: string; start: string; end: string | null }[];
};
type Job = {
	company: string;
	title: string;
	start: string;
	end: string | null;
};
// 所有输入行均由当前账号的读者角色读取。文件哈希只在可见资料内参与判断。
export async function matches(
	client: PoolClient,
	draft: Resume,
	asOf: string,
	fileId: string,
): Promise<Match[]> {
	const work = periods(
		{
			...draft,
			experiences: draft.experiences.filter((e) => e.start && e.end),
		},
		asOf,
	);
	const hashes = contactKeys(draft.contacts);
	const { rows } = await client.query<{
		id: string;
		name: string;
		school: string;
		education: string;
		same_file: boolean;
		hr_contacts: string[];
		strong: boolean;
		jobs: Job[];
		contacts: Resume["contacts"][];
	}>(
		`select c.person_id as id,c.name,c.school,c.education_level as education,
		exists(select from profile_source s where s.person_id=c.person_id and s.resume_file_id=$2) as same_file,
		exists(select from person_identity i where i.person_id=c.person_id and (i.kind||':'||i.value)=any($3::text[])) as strong,
		array(select i.kind||':'||i.value from person_identity i where i.person_id=c.person_id and i.origin='hris' and i.kind in ('phone','email') order by i.kind) as hr_contacts,
		coalesce((select jsonb_agg(m.contacts) from pool_member m where m.person_id=c.person_id),'[]') as contacts,
		coalesce((select jsonb_agg(jsonb_build_object('company',e.company,'title',e.title,
			'start',e.start_date,'end',e.end_date)) from experience e where e.person_id=c.person_id and not e.unemployed),'[]') as jobs
		from person_card c where c.name=$1 or exists(select from profile_source s where s.person_id=c.person_id and s.resume_file_id=$2)
		or exists(select from person_identity i where i.person_id=c.person_id and (i.kind||':'||i.value)=any($3::text[]))`,
		[draft.name, fileId, hashes.map((h) => `${h.kind}:${h.value}`)],
	);
	const out: Match[] = [];
	for (const r of rows) {
		const sameSchool =
			!!draft.school &&
			!!draft.education &&
			r.school === draft.school &&
			r.education === draft.education;
		const overlaps = work.some((e) =>
			r.jobs.some(
				(j) =>
					!!e.company &&
					e.company === j.company &&
					e.startDate <= (j.end ?? asOf) &&
					j.start <= (e.endDate ?? asOf),
			),
		);
		const fromHR = hashes.map((h) => `${h.kind}:${h.value}`).sort();
		const contactsMatch =
			r.contacts.some(
				(c) =>
					JSON.stringify(contactKeys(c)) === JSON.stringify(hashes) &&
					c.wechat.trim() === draft.contacts.wechat.trim(),
			) ||
			(!r.contacts.length &&
				!draft.contacts.wechat &&
				JSON.stringify(fromHR) === JSON.stringify(r.hr_contacts));
		const sameIdentity =
			contactsMatch &&
			r.name === draft.name &&
			r.school === draft.school &&
			r.education === draft.education &&
			work.length > 0 &&
			work.length === draft.experiences.length;
		if (
			r.same_file ||
			r.strong ||
			(r.name === draft.name && (sameSchool || overlaps))
		)
			out.push({
				personId: r.id,
				sameFile: r.same_file,
				name: r.name,
				school: r.school,
				education: r.education,
				sameIdentity,
				jobs: r.jobs.map(({ company, title, start, end }) => ({
					company,
					title,
					start,
					end,
				})),
			});
	}
	return out;
}

/** 完整性按数据库生成的内容键集合验证。候选人的经历始终在提交人的资料范围内读取。 */
export async function exactMatch(
	c: PoolClient,
	alternatives: Match[],
	r: Resume,
	day: string,
	user: string,
) {
	const identical = alternatives.filter((m) => m.sameFile);
	const compare = alternatives.filter((m) => m.sameIdentity && !m.sameFile);
	if (compare.length) {
		await c.query(
			"create temp table proposed_work(like experience including generated including defaults) on commit drop",
		);
		await c.query("alter table proposed_work drop column id");
		const work = periods(r, day);
		await c.query(
			`insert into proposed_work(person_id,kind,company,title,description,start_date,end_date,months)
			select id,'external',w.company,w.title,w.description,w."startDate",w."endDate",w.months
			from unnest($1::text[]) id cross join jsonb_to_recordset($2) w(company text,title text,description text,"startDate" date,"endDate" date,months int)`,
			[compare.map((m) => m.personId), JSON.stringify(work)],
		);
		const proposed = await c.query<{ person_id: string; keys: string[] }>(
			"select person_id,array_agg(distinct content_key order by content_key) as keys from proposed_work group by person_id",
		);
		for (const candidate of compare) {
			const visible = await asReader(c, user, () =>
				c.query<{ content_key: string }>(
					"select content_key from experience where person_id=$1 and not unemployed order by content_key",
					[candidate.personId],
				),
			);
			const keys = proposed.rows.find(
				(p) => p.person_id === candidate.personId,
			)?.keys;
			if (
				keys &&
				JSON.stringify(keys) ===
					JSON.stringify(visible.rows.map((v) => v.content_key))
			)
				identical.push(candidate);
		}
	}
	return identical.length === 1 ? identical[0] : undefined;
}
