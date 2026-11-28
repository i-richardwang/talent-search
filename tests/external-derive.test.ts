import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { answerChat, setup } from "./fixture";

const teardown = await setup({ corpusWriter: true });
after(teardown);
const { readDeriveInputs, receiveDeriveResults } = await import(
	"#/server/derive-api"
);
const { runTask, deriveProgress } = await import("#/server/tasks");
const { pool } = await import("#/db");
const { chatConfigured } = await import("#/server/chat");
const { listAudit } = await import("#/server/audit");
const fixtureModel = process.env.EXTRACT_MODEL;
afterEach(() => {
	delete process.env.DERIVE_MODE;
	delete process.env.DERIVE_TOKEN;
	delete process.env.REVIEW_TOKEN;
	if (fixtureModel) process.env.EXTRACT_MODEL = fixtureModel;
});
const token = "synthetic-derive-token";
const headers = { authorization: `Bearer ${token}` };
type Input = {
	id: number;
	company: string;
	title: string;
	description: string;
};
type Batch = { inputs: Input[]; instructions: string; standard: string };
async function read(kind: string, extra = ""): Promise<Batch> {
	const res = await readDeriveInputs(
		new Request(`http://local/api/derive?kind=${kind}&limit=100${extra}`, {
			headers,
		}),
	);
	assert.equal(res.status, 200);
	return res.json();
}
async function submit(kind: string, standard: string, results: unknown[]) {
	const res = await receiveDeriveResults(
		new Request("http://local/api/derive", {
			method: "POST",
			headers,
			body: JSON.stringify({ kind, standard, results }),
		}),
		async () => {},
	);
	assert.equal(res.status, 200);
	const body = (await res.json()) as { results: { status: string }[] };
	return body.results.map((r) => r.status);
}
async function run(kind: "sync" | "derive") {
	const task = await runTask(kind);
	assert.ok(task);
	assert.equal(task.failure, null);
}
async function facts() {
	return (
		await pool.query(`select e.id,e.seq_inferred_l1,e.seq_inferred_l2,e.unanswered,e.derived_identity, ep.route,p.text,ep.engagement
	from experience e left join experience_phrase ep on ep.experience_id=e.id left join phrase p on p.id=ep.phrase_id
	order by e.id,ep.route,p.text`)
	).rows;
}

test("外部服务提交结果后由解析任务写入，与内置模型生成相同的经历和检索证据", async () => {
	const model = process.env.EXTRACT_MODEL;
	assert.ok(model);
	delete process.env.EXTRACT_MODEL;
	assert.equal(chatConfigured(), false);
	const url = "http://local/api/derive?kind=extract";
	assert.equal((await readDeriveInputs(new Request(url))).status, 404);
	process.env.DERIVE_MODE = "external";
	process.env.DERIVE_TOKEN = token;
	process.env.REVIEW_TOKEN = token;
	assert.equal(
		(await readDeriveInputs(new Request(url, { headers }))).status,
		404,
	);
	delete process.env.REVIEW_TOKEN;
	assert.equal((await readDeriveInputs(new Request(url))).status, 401);
	assert.equal(
		(await readDeriveInputs(new Request(`${url}&part=2&parts=2`, { headers })))
			.status,
		400,
	);
	await run("sync");
	const tool = "Example Cloud Toolkit";
	await pool.query(
		`update experience set description=$1 where id=(
			select min(id) from experience where kind='external' and not unemployed and description<>'')`,
		[`使用 ${tool} 发布测试服务。`],
	);
	await pool.query("update experience set derived_identity='previous'");
	await run("derive");
	const progress = await deriveProgress();
	assert.ok(
		progress.staging && progress.done > 0 && progress.done < progress.total,
	);
	assert.ok((progress.externalPending ?? 0) > 0);
	const extract = await read("extract");
	const align = await read("align");
	assert.ok(
		extract.inputs.length > 0 && align.inputs.length >= extract.inputs.length,
	);
	assert.ok(
		extract.inputs.every(
			(r) =>
				r.description &&
				Object.keys(r).sort().join() === "company,description,id,title",
		),
	);
	assert.ok(
		(await listAudit("", 1)).rows.some(
			(r) => r.action === "derive-read" && r.personId,
		),
	);
	const parts = [
		...(await read("align", "&part=0&parts=2")).inputs,
		...(await read("align", "&part=1&parts=2")).inputs,
	];
	assert.deepEqual(
		parts.map((r) => r.id).sort(),
		align.inputs.map((r) => r.id).sort(),
	);
	const expected = {
		items: [
			{ text: "合成能力", depth: "主导" },
			{ text: tool, depth: "做过" },
		],
	};
	const first = extract.inputs[0] as Input;
	assert.deepEqual(
		await submit("extract", extract.standard, [
			{
				id: first.id,
				result: { items: [{ text: "bad\u0000text", depth: "做过" }] },
			},
			{ id: first.id, result: { items: [{ text: "\ud800", depth: "做过" }] } },
			{ id: first.id },
			{ id: first.id, result: expected, unable: true },
		]),
		["invalid", "invalid", "invalid", "invalid"],
	);
	const item = { id: first.id, result: expected };
	assert.deepEqual(
		await submit("extract", extract.standard, [
			{ id: first.id, result: {} },
			item,
			item,
			{ ...item, result: { items: [] } },
		]),
		["invalid", "accepted", "accepted", "conflict"],
	);
	await submit(
		"extract",
		extract.standard,
		extract.inputs.map((r) => ({ id: r.id, result: expected })),
	);
	const id = align.inputs[0]?.id;
	assert.deepEqual(
		await submit("align", align.standard, [
			{ id, result: { seq: "不在列表" } },
		]),
		["invalid"],
	);
	assert.deepEqual(
		await submit("align", "0".repeat(64), [{ id, result: { seq: "" } }]),
		["expired"],
	);
	assert.deepEqual(
		await Promise.all([
			submit("align", align.standard, [{ id, result: { seq: "" } }]),
			submit("align", align.standard, [{ id, result: { seq: "" } }]),
		]),
		[["accepted"], ["accepted"]],
	);
	await submit(
		"align",
		align.standard,
		align.inputs.map((r) => ({ id: r.id, result: { seq: "" } })),
	);
	assert.ok((await deriveProgress()).staging);
	await run("derive");
	const complete = await deriveProgress();
	assert.equal(complete.done, complete.total);
	assert.equal(complete.staging, false);
	const external = await facts();
	assert.equal(
		external.filter(
			(row) =>
				row.route === "skill" && row.text === tool && row.engagement === "做过",
		).length,
		1,
	);
	await pool.query("update experience set derived_identity='previous'");
	process.env.EXTRACT_MODEL = model;
	process.env.DERIVE_MODE = "model";
	// 内置模式先沿用外部提交，再用同一组合成经历独立验证 agent 的处理结果。
	await run("derive");
	assert.deepEqual(await facts(), external);
	await pool.query("delete from derive_request");
	await pool.query("update experience set derived_identity='previous'");
	const toolsSeen = new Set<string>();
	const restore = answerChat((system, _prompt, request) => {
		assert.equal(request.tool_choice, "required");
		for (const tool of request.tools as { function: { name: string } }[])
			toolsSeen.add(tool.function.name);
		return system.includes("HR 整理") ? expected : { seq: "" };
	});
	try {
		await run("derive");
	} finally {
		restore();
	}
	assert.deepEqual(await facts(), external);
	assert.deepEqual([...toolsSeen].sort(), ["derive_list", "derive_submit"]);
	// 内置 agent 已提交的答案在外部模式继续有效。
	await pool.query("update experience set derived_identity='previous'");
	process.env.DERIVE_MODE = "external";
	await run("derive");
	assert.equal((await read("extract")).inputs.length, 0);
	assert.deepEqual(await facts(), external);
});

test("序列树变化会拒收旧的对齐结果，抽取标准仍然有效，无法判断也能结束这一轮", async () => {
	process.env.DERIVE_MODE = "external";
	process.env.DERIVE_TOKEN = token;
	await run("sync");
	await pool.query("delete from completion_cache");
	await pool.query("delete from derive_request");
	await pool.query("update experience set derived_identity='previous'");
	await run("derive");
	const old = await read("align");
	const extract = await read("extract");
	const catalog = await pool.connect();
	try {
		await catalog.query("begin");
		await catalog.query(
			"insert into sequence_catalog values ('合成类别','合成新序列')",
		);
		const receipt = submit("align", old.standard, [
			{ id: old.inputs[0]?.id, unable: true },
		]);
		assert.equal(
			await Promise.race([
				receipt,
				new Promise((resolve) => setTimeout(() => resolve("waiting"), 50)),
			]),
			"waiting",
		);
		await catalog.query("commit");
		assert.deepEqual(await receipt, ["expired"]);
	} finally {
		if (catalog.getTransactionStatus() !== "I") await catalog.query("rollback");
		catalog.release();
	}
	await submit(
		"extract",
		extract.standard,
		extract.inputs.map((r) => ({ id: r.id, result: { items: [] } })),
	);
	await run("derive");
	const current = await read("align");
	assert.notEqual(current.standard, old.standard);
	assert.equal((await read("extract")).inputs.length, 0);
	await submit(
		"align",
		current.standard,
		current.inputs.map((r) => ({ id: r.id, unable: true })),
	);
	await run("derive");
	const state = await deriveProgress();
	assert.equal(state.done, state.total);
	assert.ok((await facts()).some((r) => r.unanswered));
});

test("同步删除了提供原文的经历时拒收旧请求，同样的输入仍在库里可以继续", async () => {
	process.env.DERIVE_MODE = "external";
	process.env.DERIVE_TOKEN = token;
	await run("sync");
	await pool.query("delete from completion_cache");
	await pool.query("delete from derive_request");
	await pool.query(
		"update experience set unanswered=false, derived_identity=null",
	);
	await run("derive");
	const group = await read("extract");
	const entry = group.inputs[0] as Input;
	const original = (
		await pool.query("select experience_id from derive_request where id=$1", [
			entry.id,
		])
	).rows[0].experience_id;
	await pool.query(
		`insert into experience (person_id,kind,unemployed,start_date,end_date,title,description,company,months)
		select person_id,kind,false,start_date-1,end_date,title,description,company,months from experience where id=$1`,
		[original],
	);
	await pool.query("delete from experience where id=$1", [original]);
	const item = { id: entry.id, result: { items: [] } };
	assert.deepEqual(await submit("extract", group.standard, [item]), [
		"expired",
	]);
	await run("derive");
	assert.ok((await read("extract")).inputs.some((r) => r.id === entry.id));
	assert.deepEqual(await submit("extract", group.standard, [item]), [
		"accepted",
	]);
	// 只剩已经解析过的同内容经历时，也能保留之前提交的结果。
	const {
		rows: [source],
	} = await pool.query("select experience_id from derive_request where id=$1", [
		entry.id,
	]);
	const { deriveStandard } = await import("#/corpus/derive-standard");
	const { version } = await deriveStandard(pool);
	await pool.query(
		`insert into experience (person_id,kind,unemployed,start_date,end_date,title,description,company,months,derived_identity)
		select person_id,kind,false,start_date-1,end_date,title,description,company,months,$2 from experience where id=$1`,
		[source.experience_id, version],
	);
	await pool.query("delete from experience where id=$1", [
		source.experience_id,
	]);
	await run("derive");
	assert.deepEqual(await submit("extract", group.standard, [item]), [
		"accepted",
	]);
});

test("并发批次以相反顺序提交不同结果，每项只保存第一份", async () => {
	process.env.DERIVE_MODE = "external";
	process.env.DERIVE_TOKEN = token;
	await run("sync");
	await pool.query("delete from completion_cache");
	await pool.query("delete from derive_request");
	await pool.query("update experience set derived_identity=null");
	await run("derive");
	const align = await read("align");
	const remaining = align.inputs.slice(0, 2);
	assert.equal(remaining.length, 2);
	const racing = await Promise.all([
		submit(
			"align",
			align.standard,
			remaining.map(({ id }) => ({ id, result: { seq: "" } })),
		),
		submit(
			"align",
			align.standard,
			remaining.toReversed().map(({ id }) => ({ id, unable: true })),
		),
	]);
	assert.deepEqual(racing.map((statuses) => statuses.join(",")).sort(), [
		"accepted,accepted",
		"conflict,conflict",
	]);
});

test("按标准与模型复用已保存的回答，外部取题跳过已有答案", async () => {
	process.env.DERIVE_MODE = "external";
	process.env.DERIVE_TOKEN = token;
	await run("sync");
	await pool.query("delete from derive_request");
	const source = await pool.query<{
		id: number;
		title: string;
		company: string;
	}>(
		"select id,title,company from experience where kind='external' and not unemployed order by id limit 1",
	);
	const row = source.rows[0];
	assert.ok(row);
	const description = "合成用例积累的指标分析经历。";
	await pool.query(
		"update experience set description=$1, derived_identity=null where id=$2",
		[description, row.id],
	);
	const restore = answerChat((system) =>
		system.includes("HR 整理")
			? {
					items: [{ text: "指标分析", depth: "做过" }],
				}
			: { seq: "" },
	);
	process.env.DERIVE_MODE = "model";
	try {
		await run("derive");
	} finally {
		restore();
	}
	await pool.query("delete from derive_request");
	await pool.query("update experience set derived_identity=null");
	process.env.DERIVE_MODE = "external";
	await run("derive");
	assert.ok(
		!(await read("extract")).inputs.some(
			(input) => input.description === description,
		),
	);
	const saved = await pool.query(
		"select result from derive_request where experience_id=$1 and result is not null",
		[row.id],
	);
	assert.ok(
		saved.rows.some((one) => one.result?.items?.[0]?.text === "指标分析"),
	);
});
