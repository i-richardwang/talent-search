import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { poll } from "#/routes/s/$turnId/-lib/poll";

function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

test("慢读取不重叠；取消会通知在途读取，收尾后不再排下一轮", async () => {
	const started = deferred<AbortSignal>();
	const finish = deferred<void>();
	let calls = 0;
	const stop = poll(1, async (signal) => {
		calls++;
		started.resolve(signal);
		await finish.promise;
		return true;
	});
	try {
		const signal = await started.promise;
		await delay(20);
		assert.equal(calls, 1);
		stop();
		assert.equal(signal.aborted, true);
		finish.resolve();
		await delay(20);
		assert.equal(calls, 1);
	} finally {
		stop();
		finish.resolve();
	}
});

test("暂时失败后继续读取，读到终态后停止", async () => {
	const settled = deferred<void>();
	let calls = 0;
	const stop = poll(1, async () => {
		calls++;
		if (calls === 1) throw new Error("合成网络故障");
		if (calls === 2) return true;
		settled.resolve();
		return false;
	});
	try {
		await settled.promise;
		await delay(20);
		assert.equal(calls, 3);
	} finally {
		stop();
	}
});

test("首次读取前取消不会发送请求", async () => {
	let calls = 0;
	const stop = poll(1, async () => {
		calls++;
		return true;
	});
	stop();
	await delay(20);
	assert.equal(calls, 0);
});
