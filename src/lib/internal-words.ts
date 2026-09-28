/**
 * 不该出现在找人界面上的词：代码和模型那一侧的概念，或者聊天这种形式本身的机制。
 * HR 不认得「词表」「条件表」，也不关心 AI 「查词」查了几次。
 *
 * 两处守着它：界面文案的测试（`tests/product-words.test.ts`）扫搜索相关页面的全部
 * 字面文字，`eval:understand` 查模型写给 HR 看的说明。管理页（任务、技能、数据）
 * 的读者是管理员，不在此列。
 */
const INTERNAL_WORDS = [
	"库里",
	"词表",
	"条件表",
	"空表",
	"端点",
	"查询理解",
	"模型",
	"字段",
	"工具",
	"接着说",
	"这一轮",
	"读成",
	"查词",
	"核对",
	"敲",
] as const;

/** 产品用词里含着内部用词的那些：「人才库里」说的是人才库，不是代码那一侧的库。 */
const PRODUCT_WORDS = ["人才库"] as const;

/** 一段文字里出现了哪些不该上屏的词。 */
export function internalWordsIn(text: string): string[] {
	const plain = PRODUCT_WORDS.reduce((t, word) => t.replaceAll(word, ""), text);
	return INTERNAL_WORDS.filter((word) => plain.includes(word));
}
