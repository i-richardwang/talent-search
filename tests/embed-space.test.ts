/** 查询端在发出真实检索前必须证明自己与语料处在同一个嵌入空间。 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql } from "drizzle-orm";
import { EMBED_DIM } from "#/db/schema";
import { fakeEmbedding, setup } from "./fixture";

const teardown = await setup();
after(teardown);

test("空间校验拒绝错误身份与零向量，修复后可以直接重试", async () => {
	const { db } = await import("#/db");
	await db.execute(
		sql`update embedding_space set space_id = 'different-space'`,
	);
	const { embed } = await import("#/server/embed");
	await assert.rejects(embed(["算法"]), /与语料 .* 不一致/);

	await db.execute(sql`
		update embedding_space set space_id = 'fake-v1',
			canary_embedding = ${`[${new Array(EMBED_DIM).fill(0).join(",")}]`}::halfvec`);
	await assert.rejects(embed(["算法"]), /canary 不一致/);

	const canary = "talent-search embedding canary";
	await db.execute(sql`
		update embedding_space
		set canary_embedding = ${`[${fakeEmbedding(canary).join(",")}]`}::halfvec`);
	assert.equal((await embed(["算法"])).length, 1);

	const changedCanary = "changed canary under the same identity";
	await db.execute(sql`
		update embedding_space set canary_text = ${changedCanary},
			canary_embedding = ${`[${fakeEmbedding(changedCanary).join(",")}]`}::halfvec`);
	await assert.rejects(embed(["渠道运营"]), /身份在进程运行期间发生变化/);
});
