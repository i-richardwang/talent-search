/** 全选框的半选：选了一部分时画减号，全选时画对勾，都没选时不画图标。半选由复选框组算出，调用处不传。 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Checkbox, CheckboxGroup } from "#/components/ui/checkbox";

const ALL = ["a", "b", "c"];

const render = (value: string[]) =>
	renderToStaticMarkup(
		<CheckboxGroup allValues={ALL} value={value}>
			<Checkbox aria-label="全选" parent />
			{ALL.map((item) => (
				<Checkbox aria-label={item} key={item} value={item} />
			))}
		</CheckboxGroup>,
	);

/** 全选框（第一个方框）那一段：从它的标签到下一个复选框的标签之前。 */
const parentBox = (html: string) => {
	const start = html.indexOf('aria-label="全选"');
	const end = html.indexOf(`aria-label="${ALL[0]}"`);
	assert.ok(start >= 0 && end > start, "找不到全选框");
	return html.slice(start, end);
};

/** 全选框里画的图标。 */
const parentIcons = (html: string) =>
	[...parentBox(html).matchAll(/lucide-(minus|check)\b/g)].map(
		([, name]) => name,
	);

describe("全选框", () => {
	test("选了一部分画减号", () => {
		assert.deepEqual(parentIcons(render(["a"])), ["minus"]);
	});

	test("全选画对勾", () => {
		assert.deepEqual(parentIcons(render(ALL)), ["check"]);
	});

	test("都没选时不画图标", () => {
		assert.deepEqual(parentIcons(render([])), []);
	});
});
