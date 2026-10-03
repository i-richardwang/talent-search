import { Alert } from "#/components/ui/alert";

/**
 * 有的经历词，人才库里相近的写法多过一次能比对的条数，只比对了最接近的那些。
 * 只写在其余写法上的人不在名单里，所以名单上方照实说，出路是换更具体的说法。
 */
export function Capped({ words }: { words: readonly string[] }) {
	const quoted = words.map((w) => `「${w}」`).join("");
	return (
		<Alert
			title={`人才库里和${quoted}相近的写法太多，只比对了最接近的一部分，名单可能缺人。换一个更具体的说法可以找全。`}
			type="warning"
		/>
	);
}
