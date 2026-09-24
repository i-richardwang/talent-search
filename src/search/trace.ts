/**
 * 查询理解这一轮走过的步骤。模型在交表之前可以拿工具查词、试搜（`server/agent-tools.ts`），
 * 每用一次记一步，落在记录的 `trace` 上，右栏的线程边跑边画（`thread.tsx`）。
 *
 * 这里只有形状，没有逻辑：记录表（`db/schema.ts`）和页面都读它，两边都不能带服务端的东西。
 * 一步只记人看得懂的结论——查了哪个词、库里叫什么、多少人、宽不宽；试了哪张表、多少人。
 * 工具交给模型的分布之类的细节不进来：那是给模型做决定用的，不是给人复盘的。
 */
import type { Condition } from "./condition";

export type WordLookup = {
	/** 模型问的词。 */
	word: string;
	/** 能力词表里的标准写法；词表里没有就是 null。 */
	canonical: string | null;
	/** 写过它（或它的细分、别的写法）的人数。 */
	people: number;
	/** 按意思搜命中的人多到几乎不筛人。 */
	wide: boolean;
};

/** 这一步是什么时候记下的（epoch 毫秒）。步骤只追加不改序，它就是一步的身份。 */
type Stamped = { at: number };

export type TraceStep = Stamped &
	(
		| { tool: "look_up_words"; words: WordLookup[] }
		| {
				tool: "try_conditions";
				conditions: Condition[];
				total: number;
				/** 一个人都没有时的成因（`search/empty.ts` 的 `kind`）。 */
				empty: string | null;
		  }
	);
