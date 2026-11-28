import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

function pdf(text: string | string[], imageOnly = false) {
	const pages = typeof text === "string" ? [text] : text;
	const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`,
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
		...pages.flatMap((value, i) => {
			const stream = imageOnly
				? "q 200 0 0 200 50 50 cm BI /W 1 /H 1 /CS /RGB /BPC 8 /F /AHx ID ff0000> EI Q"
				: `BT /F1 12 Tf 72 720 Td (${value}) Tj ET`;
			return [
				`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
				`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
			];
		}),
	];
	let buffer = "%PDF-1.4\n";
	const offsets = [0];
	for (const [i, o] of objects.entries()) {
		offsets.push(buffer.length);
		buffer += `${i + 1} 0 obj\n${o}\nendobj\n`;
	}
	const xref = buffer.length;
	buffer += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
		.slice(1)
		.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
		.join(
			"",
		)}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
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
test("离线 Agent 自选文字或图像工具，PNG 进入标准 user 消息且各页均需观察", async () => {
	const { openResumePdf } = await import("#/ingestion/pdf");
	const { parseResume } = await import("#/ingestion/parser");
	for (const [imageOnly, imageFirst] of [
		[false, false],
		[true, false],
		[true, true],
	] as const) {
		const document = await openResumePdf(pdf("Synthetic text", imageOnly));
		const trace = answerResume(draft, imageFirst);
		try {
			const out = await parseResume(document, "2025-04-07");
			assert.equal(out.name, draft.name);
			assert.deepEqual(trace.tools, [
				...(imageFirst ? [] : ["read_page_text"]),
				...(imageOnly ? ["view_page_image"] : []),
				"submit_resume",
				"submit_resume",
			]);
			assert.equal(trace.images.length, Number(imageOnly));
			if (imageOnly) {
				const png = trace.images[0] ?? "";
				assert.ok(png.startsWith("data:image/png;base64,"));
				assert.deepEqual(
					Buffer.from(png.split(",")[1] ?? "", "base64"),
					await document.renderPagePng(1),
				);
			}
		} finally {
			await document.close();
		}
	}
	const document = await openResumePdf(
		pdf(["synthetic first", "synthetic second"]),
	);
	const trace = answerResume(draft);
	try {
		assert.equal((await parseResume(document, "2025-04-07")).name, draft.name);
		assert.deepEqual(trace.tools, [
			"read_page_text",
			"submit_resume",
			"read_page_text",
			"submit_resume",
			"submit_resume",
		]);
	} finally {
		await document.close();
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
	await pools.addTouch(OWNER, "external", first.person_id, {
		touched: "2024-04-05",
		notes: "合成接触记录",
	});
	const savedTouch = (await originals.sourcesFor("limited", first.person_id))[0]
		?.touches[0];
	assert.equal(savedTouch?.touched, "2024-04-05");
	assert.ok(savedTouch);
	assert.equal(savedTouch.canEdit, false);
	await assert.rejects(
		pools.changeTouch("limited", "external", savedTouch.id, null),
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
	const scopeRows = async (user: string) =>
		withReadSnapshot("all", async (c) =>
			(
				await c.query("select person_id from scope_member where user_id=$1", [
					user,
				])
			).rows.map((r) => r.person_id),
		);
	assert.ok((await scopeRows(OWNER)).includes("internal-test"));
	assert.ok((await scopeRows(OWNER)).includes(first.person_id));
	await pool.query("update auth_user set banned=true where id=$1", [OWNER]);
	try {
		assert.deepEqual(await scopeRows(OWNER), []);
		assert.equal(
			(await originals.resumeResponse(OWNER, src.id, false)).status,
			404,
		);
	} finally {
		await pool.query("update auth_user set banned=false where id=$1", [OWNER]);
	}
	const reviewOnly = await ingest("Needs manual", {
		...draft,
		name: "合成核对乙",
		reviewReason: "请核对起始年份",
		contacts: { phone: "", email: "", wechat: "" },
		school: "",
	});
	assert.equal(reviewOnly.status, "review");
	const pendingPdf = await originals.pendingResumeResponse(
		OWNER,
		reviewOnly.id,
	);
	assert.equal(pendingPdf.status, 200);
	assert.deepEqual(
		new Uint8Array(await pendingPdf.arrayBuffer()),
		pdf("Needs manual"),
	);
	for (const [key, value] of [
		["Content-Security-Policy", "sandbox"],
		["X-Content-Type-Options", "nosniff"],
		["Cache-Control", "private, no-store"],
	] as const)
		assert.equal(pendingPdf.headers.get(key), value);
	assert.match(pendingPdf.headers.get("Content-Disposition") ?? "", /^inline;/);
	assert.equal(
		(await originals.pendingResumeResponse("limited", reviewOnly.id)).status,
		404,
	);
	await api.decideImport(OWNER, reviewOnly.id, { action: "cancel" });
	assert.equal((await state(reviewOnly.id)).status, "cancelled");
	assert.equal(
		(await originals.pendingResumeResponse(OWNER, reviewOnly.id)).status,
		404,
	);
	const linkAudits = async () =>
		(
			await pool.query(
				"select count(*)::int as n from audit_event where person_id=$1 and action='talent-link'",
				[first.person_id],
			)
		).rows[0].n;
	const beforeDuplicate = await linkAudits();
	const repeated = await ingest("Synthetic resume", draft);
	assert.equal(await linkAudits(), beforeDuplicate);
	assert.equal(repeated.status, "duplicate");
	assert.equal(repeated.person_id, first.person_id);
	assert.equal((await ingest("Different bytes", draft)).status, "duplicate");
	assert.equal(await linkAudits(), beforeDuplicate + 1);
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
		const valid = await readFile(employeesFile, "utf8");
		const linkedRow = `${sample.join(",")},${restricted.person_id}`;
		const conflicting = linkedRow.replace("SYN-JOIN", "SYN-OTHER");
		for (const [input, message] of [
			[`${valid}${conflicting}\n`, /多个工号/],
			[valid.replace(linkedRow, conflicting), /已绑定其他在职工号/],
		] as const) {
			await writeFile(employeesFile, input);
			const result = await runTask("sync", { wait: true, part: "people" });
			assert.match(result?.failure ?? "", message);
			const assignments = await pool.query(
				"select emp_id,person_id from employment where emp_id in ('SYN-JOIN','SYN-OTHER')",
			);
			assert.deepEqual(assignments.rows, [
				{ emp_id: "SYN-JOIN", person_id: restricted.person_id },
			]);
		}
		await writeFile(employeesFile, valid);
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

test("人工选择独立入池优先于编辑后完全相同的姓名、联系信息与经历", async () => {
	await pools.ensureDefaultPool();
	const original: Resume = {
		...draft,
		name: "合成独立裁决",
		contacts: { phone: "", email: "separate@example.invalid", wechat: "" },
		experiences: [
			{
				company: "合成独立公司",
				title: "合成岗位",
				start: "2020",
				end: "2021",
				description: "合成项目经历",
			},
		],
	};
	const first = await ingest("Distinct identity baseline", original);
	assert.equal(first.status, "added");
	const second = await ingest("Different original manually corrected", {
		...original,
		name: "合成待核对",
	});
	assert.equal(second.status, "review");
	await api.decideImport(OWNER, second.id, { action: "new", draft: original });
	const created = await state(second.id);
	assert.equal(created.status, "added");
	assert.notEqual(created.person_id, first.person_id);
	for (const person of [first.person_id, created.person_id]) {
		assert.equal((await originals.sourcesFor(OWNER, person)).length, 1);
		assert.equal(
			(
				await pool.query(
					"select from audit_event where person_id=$1 and action='talent-add'",
					[person],
				)
			).rowCount,
			1,
		);
	}
});

test("同池其他账号可补传但不能移出成员，同一采集时刻按发布次序选版并保留缺失的联系方式", async () => {
	await pools.ensureDefaultPool();
	const author = "version-author",
		reader = "version-reader";
	for (const id of [author, reader])
		await pool.query(
			"insert into auth_user(id,name,email,username) values($1,$1,$2,$1)",
			[id, `${id}@example.invalid`],
		);
	const ongoing = {
		company: "合成长期公司",
		title: "长期主业",
		start: "2017-02",
		end: "至今",
		description: "长期工作",
	};
	const finished = {
		company: "合成短期公司",
		title: "短期兼职",
		start: "2022",
		end: "2023",
		description: "短期工作",
	};
	const original: Resume = {
		...draft,
		name: "合成版本顺序",
		contacts: {
			phone: "15500000055",
			email: "versioned@example.invalid",
			wechat: "sample_version",
		},
		experiences: [ongoing, finished],
	};
	async function version(file: string, r: Resume, actor = author) {
		answerResume(r);
		const task = await api.uploadResume(
			actor,
			"external",
			`${file}.pdf`,
			pdf(file),
		);
		await pool.query(
			"update resume_import set created_at='2025-04-07T00:00:00Z' where id=$1",
			[task],
		);
		await api.processNextResume();
		return state(task);
	}
	// 第一版的 UUID 排在所有 v4 UUID 之前，按 UUID 选版一定会选错。
	await pool.query(
		"alter table profile_source alter column id set default '00000000-0000-0000-0000-000000000000'",
	);
	const first = await version("First version", original).finally(() =>
		pool.query(
			"alter table profile_source alter column id set default gen_random_uuid()::text",
		),
	);
	assert.equal(first.status, "added");
	const updated = {
		...original,
		contacts: { phone: "15500000056", email: "", wechat: "" },
		experiences: [{ ...ongoing, title: "更新后的主业" }, finished],
	};
	const shared = await version("Another account", updated, reader);
	assert.equal(shared.status, "review");
	await api.decideImport(reader, shared.id, {
		action: "link",
		personId: first.person_id,
	});
	assert.equal((await state(shared.id)).status, "added");
	await assert.rejects(
		pools.removeMember(reader, "external", first.person_id),
		/录入者或管理员/,
	);
	let sources = await originals.sourcesFor(reader, first.person_id);
	assert.equal(sources.length, 2);
	assert.deepEqual(sources[0]?.contacts, {
		...original.contacts,
		phone: updated.contacts.phone,
	});
	for (let i = 1; i <= 3; i++) {
		const current = {
			...updated,
			experiences: [{ ...ongoing, title: `新版主业${i}` }, finished],
		};
		const task = await version(`Revision ${i}`, current);
		assert.equal(task.status, "review");
		await api.decideImport(author, task.id, {
			action: "link",
			personId: first.person_id,
		});
		sources = await originals.sourcesFor(reader, first.person_id);
		assert.equal(sources[0]?.filename, `Revision ${i}.pdf`);
		assert.equal(sources.length, i + 2);
		assert.deepEqual(sources[0]?.contacts, {
			...original.contacts,
			phone: updated.contacts.phone,
		});
		const { rows } = await withReadSnapshot({ account: reader }, (c) =>
			c.query(
				"select c.recent_title,c.recent_company,s.filename from person_card c join profile_source s using(person_id) where c.person_id=$1 and exists(select from profile_experience pe where pe.profile_id=s.id)",
				[first.person_id],
			),
		);
		assert.deepEqual(rows, [
			{
				recent_title: `新版主业${i}`,
				recent_company: ongoing.company,
				filename: `Revision ${i}.pdf`,
			},
		]);
	}
	const { contactKeys } = await import("#/identity/contacts");
	const refreshed = await pool.query(
		"select kind,value from person_identity where person_id=$1 order by kind",
		[first.person_id],
	);
	assert.deepEqual(
		refreshed.rows,
		contactKeys({ ...original.contacts, phone: updated.contacts.phone }).sort(
			(a, b) => a.kind.localeCompare(b.kind),
		),
	);
});

test("asReader 在应用异常和 SQL 异常后恢复写入角色，并保留原始异常", async () => {
	const { asReader } = await import("#/db/snapshot");
	const client = await pool.connect();
	try {
		await client.query("begin");
		const role = async () =>
			(await client.query("select current_user as role")).rows[0].role;
		const writer = await role();
		await client.query(
			"select set_config('talent.scope','outer-test-scope',true)",
		);
		const scope = async () =>
			(await client.query("select current_setting('talent.scope') as scope"))
				.rows[0].scope;
		await asReader(client, OWNER, async () => {
			assert.equal(await scope(), OWNER);
			await asReader(client, "nested-test-account", async () =>
				assert.equal(await scope(), "nested-test-account"),
			);
			assert.equal(await role(), "talent_reader");
			assert.equal(await scope(), OWNER);
		});
		assert.equal(await role(), writer);
		assert.equal(await scope(), "outer-test-scope");

		await assert.rejects(
			asReader(client, OWNER, async () => {
				assert.equal(await role(), "talent_reader");
				throw new Error("synthetic failure");
			}),
			/synthetic failure/,
		);
		assert.equal(await role(), writer);
		await assert.rejects(
			asReader(client, OWNER, () => client.query("select 1/0")),
			{ code: "22012" },
		);
		assert.equal(await role(), writer);
	} finally {
		await client.query("rollback");
		client.release();
	}
});

test("解析失败按阶段记录脱敏原因，上传者可预览失败原件，队列未启动也能唤醒", async () => {
	await pools.ensureDefaultPool();
	const { wakeIngestionJob } = await import("#/server/jobs");
	await wakeIngestionJob("derive");
	const logs: unknown[][] = [];
	const originalError = console.error,
		model = process.env.RESUME_MODEL,
		endpoint = process.env.RESUME_BASE_URL;
	assert.ok(model && endpoint);
	console.error = (...args) => {
		logs.push(args);
	};
	delete process.env.RESUME_MODEL;
	try {
		const failed = await ingest("synthetic-private@example.invalid", draft);
		assert.equal(failed.status, "failed");
		assert.equal(failed.message, "解析未完成，可重试或手动核对");
		assert.equal(
			(await originals.pendingResumeResponse(OWNER, failed.id)).status,
			200,
		);
		assert.equal(
			(await originals.pendingResumeResponse("not-the-owner", failed.id))
				.status,
			404,
		);
		assert.ok(logs.some((log) => JSON.stringify(log).includes("端点未配置")));
		process.env.RESUME_MODEL = model;
		process.env.RESUME_BASE_URL = `${endpoint}/synthetic-private`;
		const rejected = await ingest("Private endpoint error", draft);
		assert.equal(rejected.status, "failed");
		assert.ok(logs.some((log) => JSON.stringify(log).includes("HTTP 404")));
		const damaged = await api.uploadResume(
			OWNER,
			"external",
			"合成.pdf",
			new TextEncoder().encode("%PDF-broken"),
		);
		await api.processNextResume();
		assert.equal((await state(damaged)).status, "failed");
		assert.ok(logs.some((log) => JSON.stringify(log).includes("PDF 解析")));
		assert.doesNotMatch(
			JSON.stringify(logs),
			/synthetic-private|example\.invalid|合成\.pdf|15500000001/,
		);
	} finally {
		console.error = originalError;
		process.env.RESUME_MODEL = model;
		process.env.RESUME_BASE_URL = endpoint;
	}
});

test("上传和核对中的接触记录随入池发布，多人共享名单与详情并按作者修改", async () => {
	const author = "touch-author",
		peer = "touch-peer",
		admin = "touch-admin",
		org = "合成接触业务组",
		poolId = "touch-pool";
	for (const id of [author, peer, admin]) {
		await pool.query(
			"insert into auth_user(id,name,email,username,role) values($1,$1,$2,$1,$3)",
			[id, `${id}@example.invalid`, id === admin ? "admin" : "user"],
		);
		await pool.query(
			"insert into account_scope(user_id,org_path) values($1,$2)",
			[id, org],
		);
	}
	await pool.query(
		"insert into talent_pool(id,name,visibility,org_path) values($1,'合成协作池','org',$2)",
		[poolId, org],
	);
	const job = {
		company: "合成海桥实业",
		title: "合成设备工程师",
		start: "2021-03",
		end: "至今",
		description: "设计合成测试设备",
	};
	const resume: Resume = {
		...draft,
		name: "合成接触样本",
		contacts: { email: "touch-test@example.invalid", phone: "", wechat: "" },
		experiences: [job],
	};
	const firstTouch = { touched: "2024-03-06", notes: "初次沟通" };
	answerResume(resume);
	const task = await api.uploadResume(
		author,
		poolId,
		"初版.pdf",
		pdf("touch initial"),
		firstTouch,
	);
	await api.processNextResume();
	const published = await state(task);
	assert.equal(published.status, "added");
	assert.equal(published.touch, null);
	const person = published.person_id as string;
	const originalTouch = { touched: "2024-03-07", notes: "尚待核对" };
	answerResume({
		...resume,
		experiences: [{ ...job, description: "改进合成测试设备" }],
	});
	const revision = await api.uploadResume(
		peer,
		poolId,
		"新版.pdf",
		pdf("touch revision"),
		originalTouch,
	);
	await api.processNextResume();
	assert.deepEqual(
		(await api.reviewImport(peer, revision)).touch,
		originalTouch,
	);
	await assert.rejects(api.reviewImport(author, revision));
	const revised = { touched: "2024-04-05", notes: "二次沟通" };
	await api.decideImport(peer, revision, {
		action: "link",
		personId: person,
		touch: revised,
	});
	assert.equal((await state(revision)).touch, null);
	const sources = await originals.sourcesFor(author, person);
	assert.equal(sources.length, 2);
	assert.deepEqual(
		sources.map((s) => s.latest),
		[true, false],
	);
	assert.deepEqual(sources[1]?.touches, []);
	const history = sources[0]?.touches;
	assert.ok(history);
	assert.deepEqual(
		history.map(({ author, touched, notes, canEdit }) => ({
			author,
			touched,
			notes,
			canEdit,
		})),
		[
			{ author: peer, ...revised, canEdit: false },
			{ author, ...firstTouch, canEdit: true },
		],
	);
	const second = history[0];
	assert.ok(second);
	await assert.rejects(pools.changeTouch(author, poolId, second.id, null));
	await pools.changeTouch(peer, poolId, second.id, {
		...revised,
		notes: "确认后续意向",
	});
	await pools.addTouch(peer, poolId, person, {
		touched: "2024-05-02",
		notes: "",
	});
	// 同一原件可随任务登记一次新的联系，同池资料及其导入审计不重复。
	const repeat = await api.uploadResume(
		peer,
		poolId,
		"同一版.pdf",
		pdf("touch revision"),
		{ touched: null, notes: "约定稍后联系" },
	);
	await api.processNextResume();
	assert.equal((await state(repeat)).status, "duplicate");
	await assert.rejects(
		api.decideImport(peer, repeat, { action: "link", personId: person }),
	);
	const details = await originals.sourcesFor(peer, person);
	assert.equal(details.length, 2);
	assert.equal(details[0]?.touches.length, 4);
	const board = await pools.importBoard(peer, {
		pool: poolId,
		tab: "members",
		page: 5,
	});
	assert.equal(board.list.tab, "members");
	assert.deepEqual(board.list.table.rows, [
		{
			personId: person,
			name: resume.name,
			company: job.company,
			title: job.title,
			touched: "2024-05-02",
			notes: "约定稍后联系",
		},
	]);
	assert.equal(board.list.table.page, 1);
	const inbox = await pools.importBoard(peer, {
		pool: poolId,
		tab: "imports",
		page: 1,
	});
	assert.equal(inbox.list.tab, "imports");
	assert.equal(inbox.list.table.total, 2);
	await assert.rejects(pools.removeMember(peer, poolId, person));
	await pools.changeTouch(admin, poolId, second.id, null);
	const { listEmployees, employeeDetail, employeeData } = await import(
		"#/server/data"
	);
	const scope = { account: peer };
	const table = await listEmployees(scope, "海桥", 1);
	assert.equal(table.total, 1);
	assert.equal(table.rows[0]?.personId, person);
	const workbench = await employeeDetail(scope, person),
		drawer = await employeeData(scope, person);
	assert.ok(workbench && drawer);
	assert.deepEqual(drawer.employee.pools, ["合成协作池"]);
	assert.deepEqual(workbench.employee.pools, drawer.employee.pools);
	const { createElement } = await import("react");
	const { visibleText } = await import("./render");
	const { routed } = await import("./routed");
	const { EmployeeTable } = await import(
		"#/routes/data/-components/employee-table"
	);
	const { Person } = await import("#/routes/s/$turnId/-components/person");
	const tableHtml = await routed(
		() =>
			createElement(EmployeeTable, {
				list: table,
				q: "海桥",
				selected: undefined,
			}),
		{ path: "/data" },
	);
	assert.ok(visibleText(tableHtml).includes(`${job.company} · ${job.title}`));
	const page = await routed(
		() => createElement(Person, { ...workbench, evidence: [] }),
		{ path: "/s/$turnId/p/$personId", url: "/s/test/p/sample" },
	);
	const header = visibleText(page);
	for (const label of [
		"最近公司",
		job.company,
		"最近岗位",
		job.title,
		"所属人才池",
		"合成协作池",
		"学历",
		resume.school,
	])
		assert.ok(header.includes(label), label);
	assert.doesNotMatch(header, /招聘渠道|入职时间/);
	await pool.query("delete from account_scope where user_id=$1", [peer]);
	assert.deepEqual(await originals.sourcesFor(peer, person), []);
	assert.equal((await listEmployees(scope, "海桥", 1)).total, 0);
	assert.ok(
		!(
			await pools.importBoard(peer, { pool: poolId, tab: "members", page: 1 })
		).pools.some((p) => p.id === poolId),
	);
	await assert.rejects(pools.addTouch(peer, poolId, person, firstTouch));
	const peerEntry = details[0]?.touches.find(
		(t) => t.author === peer && t.notes === "约定稍后联系",
	);
	assert.ok(peerEntry);
	await assert.rejects(pools.changeTouch(peer, poolId, peerEntry.id, null));
	await pools.removeMember(author, poolId, person);
	assert.equal(
		(await pool.query("select from pool_touch where pool_id=$1", [poolId]))
			.rowCount,
		0,
	);
});
