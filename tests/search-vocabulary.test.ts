/**
 * 检索只用词表的同义这一层：捞到一项的任一种写法，整项的写法都算捞到。宽细关系不带出也不
 * 挡掉命中：细的词、宽的词算不算，看它自己被没被捞到。写了判据的条件也一样先按字面和同义
 * 捞，哪一段算数再看存下的结论。词和关系都是合成的。
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { SearchSpec } from "#/search/spec";
import { claim } from "./conditions";
import { conclude, judged, openSearch, seed, setup } from "./fixture";

const teardown = await setup();
after(teardown);
const { search: find } = await import("#/search/search");
/** 本文件的查询都在同一次找人任务里：结论记在它名下，也只认它名下的。 */
const SEARCH = await openSearch();
const search = (spec: SearchSpec) => find(spec, SEARCH);

before(async () => {
	const { db } = await import("#/db");
	const { term } = await import("#/db/schema");
	const person = (empId: string, skill: string) => ({
		empId,
		name: `合成${empId}`,
		segments: [
			{ kind: "external" as const, months: 24, extracted: { skills: [skill] } },
		],
	});
	await seed([
		person("V1", "后端开发"),
		person("V2", "服务端研发"),
		person("V3", "爪哇编程"),
		person("V4", "运营"),
		person("V5", "抖音运营"),
	]);
	const reviewedAt = new Date();
	await db.insert(term).values([
		{ word: "后端开发", canonical: "后端开发", reviewedAt },
		{ word: "服务端研发", canonical: "后端开发", reviewedAt },
		{ word: "运营", canonical: "运营", reviewedAt },
	]);
	await db.insert(term).values([
		{ word: "爪哇编程", canonical: "爪哇编程", parent: "后端开发", reviewedAt },
		{ word: "抖音运营", canonical: "抖音运营", parent: "运营", reviewedAt },
	]);
});

const ids = (outcome: { results: { employee: { empId: string } }[] }) =>
	outcome.results.map((r) => r.employee.empId).sort();

test("捞到一项的一种写法，整项的写法都算；属于它的细词不跟着带", async () => {
	assert.deepEqual(ids(await search({ conditions: [claim("服务端")] })), [
		"V1",
		"V2",
	]);
	assert.deepEqual(ids(await search({ conditions: [claim("后端开发")] })), [
		"V1",
		"V2",
	]);
	assert.deepEqual(ids(await search({ conditions: [claim("爪哇")] })), ["V3"]);
});

test("写了判据的条件同样带出整项的写法：同义写法上的经历也是要看的候选，各听各的结论", async () => {
	const criterion = "本人做后端开发";
	const backend = {
		query: { conditions: [judged("后端", ["服务端"], criterion)] },
	};
	const standing = async () => {
		const outcome = await search(backend);
		if (outcome.order !== "evidence") throw new Error("该是按证据排的名单");
		return { people: ids(outcome), incomplete: outcome.incomplete };
	};
	// 正则只对得上「服务端研发」，同一项的「后端开发」跟着捞到；都还没确认，谁也不上名单
	assert.deepEqual(await standing(), {
		people: [],
		incomplete: { above: null },
	});
	await conclude(SEARCH, criterion, true, ["V1"]);
	assert.deepEqual(await standing(), {
		people: ["V1"],
		incomplete: { above: null },
	});
	await conclude(SEARCH, criterion, false, ["V2"]);
	assert.deepEqual(await standing(), { people: ["V1"], incomplete: undefined });
});

test("细词和它的上级都被捞到时都算命中", async () => {
	assert.deepEqual(ids(await search({ conditions: [claim("运营")] })), [
		"V4",
		"V5",
	]);
	const criterion = "本人做运营，哪一种都算";
	await conclude(SEARCH, criterion, true, ["V4", "V5"]);
	const outcome = await search({
		query: { conditions: [judged("运营", ["运营$"], criterion)] },
	});
	assert.deepEqual(
		ids(outcome),
		["V4", "V5"],
		"上级照它自己的结论算，不因为有更细的命中被挡掉",
	);
});
