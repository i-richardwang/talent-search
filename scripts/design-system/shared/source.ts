import { sources } from "./source-files";
import { readSource } from "./tokens/css";
import { draftModel } from "./tokens/draft";

/** 原版：从源文件原文读出的令牌默认值，以及在它上面读写修改版的几个函数。 */
export const baseline = readSource(Object.values(sources));

export const { originalValue, pruneDraft, tokenValue, updateToken } =
	draftModel(baseline);
