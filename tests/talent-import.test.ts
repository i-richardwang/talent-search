import assert from "node:assert/strict";
import { chmod, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { Resume } from "#/ingestion/resume";
import { answerResume, ORG, OWNER, openSearch, seed, setup } from "./fixture";

const stop = await setup({ corpusWriter: true });
const dir = await mkdtemp(join(tmpdir(), "talent-pdf-"));
process.env.TALENT_FILES_DIR = dir;
after(async () => {
	await stop();
	await rm(dir, { recursive: true, force: true });
});
const { pool } = await import("#/db");
const { search } = await import("#/search/search");
const { withReadSnapshot } = await import("#/db/snapshot");
const api = await import("#/server/talent-import");
const pools = await import("#/server/talent-pools");
const originals = await import("#/server/resume-files");
const { runTask } = await import("#/server/tasks");
const { files } = await import("#/storage/files");

function pdf(text: string) {
	const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
	];
	let buffer = "%PDF-1.4\n";
	const offsets = [0];
	for (const [i, o] of objects.entries()) {
		offsets.push(buffer.length);
		buffer += `${i + 1} 0 obj\n${o}\nendobj\n`;
	}
	const xref = buffer.length;
	buffer += `xref\n0 6\n0000000000 65535 f \n${offsets
		.slice(1)
		.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
		.join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return new TextEncoder().encode(buffer);
}
const draft: Resume = {
	name: "合成简历甲",
	school: "合成学校",
	education: "本科",
	contacts: {
		email: "test@example.invalid",
		phone: "15500000001",
		wechat: "wx_sample_01",
	},
	experiences: [
		{
			company: "合成云服务",
			title: "平台工程师",
			start: "2020-03",
			end: "至今",
			description:
				"建设星图平台。微信号：wx_sample_01；电话 15500000001；test@example.invalid",
		},
	],
};
const state = async (id: string) =>
	(await pool.query("select * from resume_import where id=$1", [id])).rows[0];
async function ingest(
	token: string,
	data: Resume,
	target = "external",
	actor = OWNER,
) {
	answerResume(data);
	const id = await api.uploadResume(actor, target, "合成.pdf", pdf(token));
	await api.processNextResume();
	return state(id);
}
test("没有文字层的页由本地 OCR 收到 PNG，未配置时提示人工核对", async () => {
	const { pdfPages } = await import("#/ingestion/pdf");
	delete process.env.RESUME_OCR_BIN;
	await assert.rejects(pdfPages(pdf("")), /扫描件/);
	const binary = join(dir, "synthetic-ocr");
	await writeFile(
		binary,
		`#!/usr/bin/env bun
const chunks=[]; for await(const chunk of Bun.stdin.stream())chunks.push(chunk);
if(Buffer.concat(chunks).subarray(1,4).toString()!=="PNG")process.exit(2);
process.stdout.write("Synthetic scanned page");
`,
	);
	await chmod(binary, 0o700);
	process.env.RESUME_OCR_BIN = binary;
	try {
		assert.deepEqual(await pdfPages(pdf("")), ["Synthetic scanned page"]);
	} finally {
		delete process.env.RESUME_OCR_BIN;
	}
});
test("日期保留原始粒度、未知日期和未来起始日需核对", async () => {
	const { periods, sanitized } = await import("#/ingestion/resume");
	const [job] = draft.experiences;
	assert.ok(job);
	const result = periods(
		{ ...draft, experiences: [{ ...job, start: "2023", end: "2024-02" }] },
		"2024-03-12",
	)[0];
	assert.deepEqual(
		[result?.start, result?.startDate, result?.endDate],
		["2023", "2023-01-01", "2024-02-29"],
	);
	for (const [start, end] of [
		["2025", "至今"],
		["2024-02-30", "至今"],
		["2024-02", "2022"],
		["", "至今"],
	] as const)
		assert.throws(() =>
			periods(
				{ ...draft, experiences: [{ ...job, start, end }] },
				"2024-03-12",
			),
		);
	const clean = sanitized({
		...draft,
		experiences: [
			{
				...job,
				title: "工程师 15500000001",
				description:
					"研发平台。WeChat: hidden_handle；contact@example.invalid；+1 (415) 555-0123",
			},
		],
	}).experiences[0];
	assert.ok(clean);
	assert.match(clean.description, /研发平台/);
	assert.doesNotMatch(
		clean.title + clean.description,
		/15500000001|hidden_handle|@|555/,
	);
});
test("离线工具回执纠错、立即检索、重复版本、资料权限、同步及原件清理", async () => {
	await pools.ensureDefaultPool();
	await pool.query(
		"insert into auth_user(id,name,email,username) values ('limited','合成','limited@example.invalid','limited')",
	);
	await pool.query("insert into account_scope values('limited',$1)", [
		`${ORG}>甲`,
	]);
	await pool.query(
		"insert into talent_pool(id,name,visibility,org_path) values('nested','合成受限池','org',$1)",
		[`${ORG}>乙>一组`],
	);
	await seed([
		{
			personId: "internal-test",
			name: "内部合成人",
			org: `${ORG}>乙`,
			school: "合成学校",
			education: "本科",
			curLevel: "P9",
			segments: [
				{ title: "HR 机密岗位", months: 10 },
				{ title: "合成第二岗位", months: 12 },
			],
		},
	]);
	const first = await ingest("Synthetic resume", draft);
	assert.equal(first.status, "added", first.message);
	assert.ok(first.person_id);
	const sources = await originals.sourcesFor("limited", first.person_id);
	assert.equal(sources.length, 1);
	const src = sources[0];
	assert.ok(src);
	const bytes = await originals.resumeResponse("limited", src.id, true);
	assert.equal(bytes.status, 200);
	assert.deepEqual(
		new Uint8Array(await bytes.arrayBuffer()),
		pdf("Synthetic resume"),
	);
	const hit = await search(
		{ conditions: [{ about: "experience", mode: "must", what: ["星图平台"] }] },
		null,
		{ talentType: ["外部候选人"], pool: ["外部人才池"] },
	);
	assert.equal(hit.total, 1);
	assert.equal(hit.results[0]?.employee.personId, first.person_id);
	const { probe } = await import("#/search/execute");
	const root = await openSearch();
	const query = {
		conditions: [
			{
				id: "both",
				label: "岗位经历",
				from: "experience",
				mode: "must",
				where: "true",
				seek: { criterion: "岗位经历", patterns: [] },
			},
		],
	} satisfies import("#/search/query").Query;
	const mixed = await probe(query, root);
	const firstTwo = mixed.unconfirmed.slice(0, 2).map((c) => c.experienceId);
	const types = await withReadSnapshot({ account: OWNER }, (c) =>
		c.query(
			"select distinct c.talent_type from experience e join person_card c using(person_id) where e.id=any($1)",
			[firstTwo],
		),
	);
	assert.equal(types.rowCount, 2);
	const { criterionKey } = await import("#/search/verdict");
	await pool.query(
		"insert into experience_verdict(root_turn_id,criterion_key,content,fits) select $1,$2,content_key||coalesce(derived_identity,''),true from experience where id=$3",
		[root, criterionKey("岗位经历"), firstTwo[0]],
	);
	const remaining = await probe(query, root);
	assert.equal(remaining.unconfirmed[0]?.experienceId, firstTwo[1]);
	await pools.updateContactNote(
		OWNER,
		"external",
		first.person_id,
		"2024-04-05",
		"合成接触记录",
	);
	assert.equal(
		(await originals.sourcesFor("limited", first.person_id))[0]?.touched,
		"2024-04-05",
	);
	await assert.rejects(
		pools.updateContactNote("limited", "external", first.person_id, null, ""),
	);
	const jobs = await pool.query(
		"select description,end_date from experience where person_id=$1",
		[first.person_id],
	);
	assert.equal(jobs.rows[0].end_date, null);
	assert.doesNotMatch(
		jobs.rows[0].description,
		/15500000001|wx_sample|example/,
	);
	assert.equal(
		(await originals.resumeResponse("limited", src.id, false)).status,
		200,
	);
	const reviewOnly = await ingest("Needs manual", {
		...draft,
		name: "合成核对乙",
		reviewReason: "请核对起始年份",
		contacts: { phone: "", email: "", wechat: "" },
		school: "",
	});
	assert.equal(reviewOnly.status, "review");
	await api.decideImport(OWNER, reviewOnly.id, { action: "cancel" });
	assert.equal((await state(reviewOnly.id)).status, "cancelled");
	const repeated = await ingest("Synthetic resume", draft);
	assert.equal(repeated.status, "duplicate");
	assert.equal(repeated.person_id, first.person_id);
	assert.equal((await ingest("Different bytes", draft)).status, "duplicate");
	const job = draft.experiences[0];
	assert.ok(job);
	const other = await ingest("Same contact", {
		...draft,
		name: "合成人更名",
		experiences: [{ ...job, description: "另一项工作" }],
	});
	assert.equal(other.status, "review");
	assert.ok(
		(await api.reviewImport(OWNER, other.id)).candidates.some(
			(c) => c.personId === first.person_id,
		),
	);
	await api.decideImport(OWNER, other.id, { action: "new" });
	assert.notEqual((await state(other.id)).person_id, first.person_id);
	const matched = await ingest("Internal collision", {
		...draft,
		name: "内部合成人",
		contacts: { phone: "", email: "", wechat: "" },
	});
	assert.equal(matched.status, "review");
	await api.decideImport(OWNER, matched.id, {
		action: "link",
		personId: "internal-test",
	});
	const scoped = await withReadSnapshot({ account: "limited" }, async (c) => ({
		card: (
			await c.query("select * from person_card where person_id='internal-test'")
		).rows[0],
		titles: (
			await c.query(
				"select title from experience where person_id='internal-test'",
			)
		).rows,
	}));
	assert.equal(scoped.card.emp_id, null);
	assert.equal(scoped.card.talent_type, "外部候选人");
	assert.ok(scoped.titles.every((r) => r.title !== "HR 机密岗位"));
	const restricted = await ingest(
		"Private",
		{
			...draft,
			name: "受限人",
			contacts: { email: "", phone: "", wechat: "" },
		},
		"nested",
	);
	assert.equal(restricted.status, "added");
	const [privateFile] = await originals.sourcesFor(OWNER, restricted.person_id);
	assert.ok(privateFile);
	assert.equal(
		(await originals.resumeResponse("limited", privateFile.id, false)).status,
		404,
	);
	const { allVisible } = await import("#/server/data");
	const visibleStamp = await withReadSnapshot(
		{ account: OWNER },
		async (c) =>
			(
				await c.query(
					"select access_key from person_card where person_id='internal-test'",
				)
			).rows[0].access_key,
	);
	assert.equal(
		await allVisible({ account: OWNER }, ["internal-test"], [visibleStamp]),
		true,
	);
	assert.equal(
		await allVisible({ account: "limited" }, ["internal-test"], [visibleStamp]),
		false,
	);
	await assert.rejects(
		api.uploadResume("limited", "nested", "合成.pdf", pdf("Unauthorized")),
	);
	const blocked = await ingest(
		"No restricted match",
		{
			...draft,
			name: "受限人",
			contacts: { phone: "", email: "", wechat: "" },
			reviewReason: "核对岗位",
		},
		"external",
		"limited",
	);
	assert.equal(blocked.status, "review");
	assert.ok(
		!(await api.reviewImport("limited", blocked.id)).candidates.some(
			(c) => c.personId === restricted.person_id,
		),
	);
	await assert.rejects(
		api.decideImport("limited", blocked.id, {
			action: "link",
			personId: restricted.person_id,
		}),
	);
	await api.decideImport("limited", blocked.id, { action: "cancel" });
	const sync = await runTask("sync", { wait: true });
	assert.equal(sync?.failure, null);
	assert.equal(
		(await originals.sourcesFor("limited", first.person_id)).length,
		2,
	);
	assert.equal(
		(await originals.sourcesFor("limited", "internal-test")).length,
		1,
	);
	await pool.query("update auth_user set role='admin' where id=$1", [OWNER]);
	await pools.setTalentPool(OWNER, {
		id: "nested",
		name: "合成受限池",
		org: null,
	});
	assert.equal(
		(await originals.resumeResponse("limited", privateFile.id, false)).status,
		200,
	);
	const org = (
		await pool.query(
			"select cur_dept_path from employment where cur_dept_path<>'' limit 1",
		)
	).rows[0]?.cur_dept_path;
	assert.ok(org);
	await pool.query(
		"insert into account_scope(user_id,org_path) values($1,$2) on conflict do nothing",
		[OWNER, org],
	);
	await pools.setTalentPool(OWNER, { id: "nested", name: "合成受限池", org });
	await assert.rejects(
		pools.setTalentPool("limited", {
			id: "nested",
			name: "越权调整",
			org: null,
		}),
	);
	const freshCsv = join(dir, "synthetic-csv");
	await cp("src/corpus/sources/sample", freshCsv, { recursive: true });
	const employeesFile = join(freshCsv, "employees.csv");
	const [headers, ...records] = (await readFile(employeesFile, "utf8"))
		.trimEnd()
		.split("\n");
	assert.ok(headers && records[0]);
	const sample = records[0].split(",");
	sample[0] = "SYN-JOIN";
	await writeFile(
		employeesFile,
		`${[
			`${headers},linked_person_id`,
			...records.map((row) => `${row},`),
			`${sample.join(",")},${restricted.person_id}`,
		].join("\n")}\n`,
	);
	const current = process.env.TALENT_CSV_DIR;
	process.env.TALENT_CSV_DIR = freshCsv;
	try {
		assert.equal(
			(await runTask("sync", { wait: true, part: "people" }))?.failure,
			null,
		);
		assert.equal(
			(
				await pool.query(
					"select person_id from employment where emp_id='SYN-JOIN'",
				)
			).rows[0].person_id,
			restricted.person_id,
		);
		assert.equal(
			(await originals.sourcesFor(OWNER, restricted.person_id)).length,
			1,
		);
	} finally {
		process.env.TALENT_CSV_DIR = current ?? "";
	}

	const knowledgeDir = join(dir, "synthetic-knowledge");
	await cp(freshCsv, knowledgeDir, { recursive: true });
	await rm(join(knowledgeDir, "employees.csv"));
	process.env.TALENT_CSV_DIR = knowledgeDir;
	try {
		assert.equal(
			(await runTask("sync", { wait: true, part: "knowledge" }))?.failure,
			null,
		);
		assert.equal(
			(await pool.query("select from employment where emp_id='SYN-JOIN'"))
				.rowCount,
			1,
		);
	} finally {
		process.env.TALENT_CSV_DIR = current ?? "";
	}
	const cross = await ingest("Synthetic resume", draft, "nested");
	assert.equal(cross.status, "duplicate");
	assert.equal(cross.person_id, first.person_id);
	const blob = (
		await pool.query(
			"select sha256 from resume_file f join profile_source s on s.resume_file_id=f.id where s.id=$1",
			[src.id],
		)
	).rows[0].sha256;
	await pools.removeMember(OWNER, "external", first.person_id);
	assert.equal(
		(await originals.resumeResponse(OWNER, src.id, false)).status,
		404,
	);
	assert.deepEqual(
		new Uint8Array(await files.get(blob)),
		pdf("Synthetic resume"),
	);
	await pools.removeMember(OWNER, "nested", first.person_id);
	await assert.rejects(files.get(blob));
	const audit = await pool.query(
		"select action from audit_event where person_id=$1",
		[first.person_id],
	);
	for (const a of [
		"talent-add",
		"talent-link",
		"resume-preview",
		"resume-download",
		"talent-remove",
	])
		assert.ok(audit.rows.some((r) => r.action === a));
});
