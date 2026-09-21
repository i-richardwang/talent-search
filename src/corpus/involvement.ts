/**
 * 参与方式的几种取值与每种对应的语气。这是「做过的事」唯一的枚举，只写在这里：
 * 抽取的提示词从这里生成给模型、`conform` 用它收窄（`corpus/extract.ts`），
 * 界面按它的顺序分组（`routes/data.$empId.tsx`），库里那一列不设约束。
 *
 * 单独成文件而不是留在 `extract.ts` 里，是因为界面也要读它，而 `extract.ts`
 * 连着 `server/chat.ts`——把它 import 进路由就是把模型客户端拖进浏览器包。
 * 这里没有任何 import，两边都用得起。
 *
 * 顺序原样不动。它会被拼进抽取的提示词，而提示词是重排与抽取缓存键的一部分
 * （`server/chat.ts`）——换一下次序就是全库重抽一遍，为了界面上组的先后付这个
 * 代价不值得。界面因此照这份清单的原序画组。
 */
export const INVOLVEMENT_GUIDE: Record<string, string> = {
	从零搭建: "从无到有做出来的",
	负责建设: "主责、主导、负责的",
	优化改进: "提升、改造、迭代已有东西的",
	参与执行: "参与、协助、配合、支持的",
	带队管理: "带团队、管理人的",
};

export const INVOLVEMENTS = Object.keys(INVOLVEMENT_GUIDE);
