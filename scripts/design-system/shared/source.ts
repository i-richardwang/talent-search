import { sources } from "./source-files";
import { readSource } from "./tokens/css";
import { draftModel } from "./tokens/draft";

/** 源文件里的令牌值（修改前），以及在它上面读写修改的几个函数。 */
export const baseline = readSource(Object.values(sources));

export const { originalValue, pruneDraft, tokenValue, updateToken } =
	draftModel(baseline);
