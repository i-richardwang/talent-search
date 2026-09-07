/**
 * 查询理解端点的失败方式：**没配就抛，失败就抛。**
 *
 * 一句话只有模型能读成条件，没有第二种读法能给出同一份结果。它站在结果的
 * 关键路径上（工作台已经打开，名单还等着它回来），所以失败必须作为错误
 * 交给调用方，由界面画成错误与重试——装作能用给出的是一份空名单或反义
 * 名单，而它们在屏幕上和正确的名单长得一模一样。
 */
import assert from "node:assert/strict";
import { test } from "node:test";

// llm.ts 在模块求值时就读环境变量，所以配置必须落在 import 之前。
// 端口 1 上没有人接：这一跳必然失败，而失败正是这里要看的东西。
process.env.LLM_BASE_URL = "http://127.0.0.1:1";
process.env.LLM_MODEL = "fake";
const { understand } = await import("#/server/llm");

const VOCAB = { companyTag: [], level: [], recruitment: [], education: [] };

test("端点连不上时抛给调用方，不返回一份假理解", async () => {
	await assert.rejects(understand("做过算法的人", VOCAB));
});
