/**
 * 查询理解端点的失败方式：**永远不抛，只返回 null。**
 *
 * 它没了可以退回规则解析，所以调用方只有一条降级路径；而它站在结果的关键
 * 路径上（工作台已经打开，名单还等着它回来），一次抛出会让界面把一次服务
 * 故障报成「没有这样的人」——那两句话在屏幕上长得一模一样。
 *
 * 嵌入和重排正相反：没了检索什么都做不了，所以它们没配就抛（见 `embed.ts`）。
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";

// llm.ts 在模块求值时就读环境变量，所以配置必须落在 import 之前。
// 端口 1 上没有人接：这一跳必然失败，而失败正是这里要看的东西。
process.env.LLM_BASE_URL = "http://127.0.0.1:1";
process.env.LLM_MODEL = "fake";
const { understand } = await import("#/server/llm");

// 降级要说出来（`console.warn`），但这条测试要看的不是那句话
const warn = console.warn;
console.warn = () => {};
after(() => {
	console.warn = warn;
});

test("端点连不上时返回 null，不把异常抛给调用方", async () => {
	const vocab = {
		companyTag: [],
		level: [],
		recruitment: [],
		education: [],
	};
	assert.equal(await understand("做过算法的人", vocab), null);
});
