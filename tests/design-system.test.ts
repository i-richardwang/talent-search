/**
 * 设计系统的纯逻辑：令牌表与源文件对得上、修改版的读写与校验、写出的 CSS 与写回源文件、
 * 影响范围与本页颜色、撤销重做、颜色换算、外壳与预览页之间的消息、存储的解码、
 * 目录与地址。不启动浏览器。
 */
import assert from "node:assert/strict";
import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { rulesMarkdown } from "../scripts/design-system/preview/kit/rules";
import { REPO_ROOT } from "../scripts/design-system/server/token-sources";
import {
	catalog,
	isPreviewPageId,
	pageById,
} from "../scripts/design-system/shared/catalog";
import {
	contrastRatio,
	formatColor,
	fromOklch,
	inSrgb,
	parseColor,
	sameColor,
	toOklch,
} from "../scripts/design-system/shared/color";
import {
	isToPreview,
	isToShell,
} from "../scripts/design-system/shared/protocol";
import { resolveRoute } from "../scripts/design-system/shared/routes";
import {
	baseline,
	originalValue,
	pruneDraft,
	tokenValue,
	updateToken,
} from "../scripts/design-system/shared/source";
import { sources } from "../scripts/design-system/shared/source-files";
import {
	applyDraft,
	declaredTokens,
	exportCss,
	previewCss,
	readSource,
	THEME_SOURCE,
	TOKEN_SOURCE_PATTERNS,
} from "../scripts/design-system/shared/tokens/css";
import {
	type Draft,
	draftModel,
	emptyDraft,
	isDraft,
	resetTokens,
} from "../scripts/design-system/shared/tokens/draft";
import {
	editHistory,
	HISTORY_LIMIT,
	type History,
} from "../scripts/design-system/shared/tokens/history";
import {
	COLOR_TOKENS,
	COMPONENT_TIERS,
	EASING_TOKENS,
	EASINGS,
	isColorToken,
	motionTokens,
	NUMERIC_TOKENS,
	numericToken,
	parseNumeric,
	SHADOW_TOKENS,
} from "../scripts/design-system/shared/tokens/registry";
import {
	pageColors,
	pagesOfFile,
	usagesOf,
} from "../scripts/design-system/shell/impact";
import {
	decodeSession,
	MAX_SCHEMES,
} from "../scripts/design-system/shell/storage";
import { previewState } from "./design-system-state";

/** `src/` 下全部 TS、TSX 与 CSS，和外壳的影响范围扫的是同一批。 */
const srcFiles = Object.fromEntries(
	globSync("src/**/*.{ts,tsx,css}", { cwd: REPO_ROOT }).map((file) => [
		file,
		readFileSync(join(REPO_ROOT, file), "utf8"),
	]),
);

describe("令牌表与源文件", () => {
	test("深色一侧：颜色令牌都在 .dark 里声明，只有遮罩与选中文字底色两侧共用", () => {
		const declared = declaredTokens([sources[THEME_SOURCE] ?? ""]).dark;
		const shared = COLOR_TOKENS.map(([key]) => key).filter(
			(key) => !(key in declared),
		);
		assert.deepEqual(shared, ["--color-mask", "--color-selection"]);
		for (const [key] of COLOR_TOKENS)
			for (const theme of ["light", "dark"] as const)
				assert.ok(
					parseColor(baseline[theme][key] ?? ""),
					`${theme} ${key} 读不懂`,
				);
	});

	test("浏览器里取源文件的模式与写回源码、测试在磁盘上找的是同一组", () => {
		const text = readFileSync(
			join(REPO_ROOT, "scripts/design-system/shared/source-files.ts"),
			"utf8",
		);
		const globbed = [
			...(
				/import\.meta\.glob<string>\(\s*\[([^\]]*)\]/.exec(text)?.[1] ?? ""
			).matchAll(/"([^"]+)"/g),
		].map(([, pattern]) => (pattern ?? "").replace(/^(\.\.\/)+/, ""));
		assert.deepEqual(globbed, [...TOKEN_SOURCE_PATTERNS]);
	});

	test("数值令牌的原版值写成它的单位，落在能调的范围里", () => {
		for (const token of NUMERIC_TOKENS) {
			const raw = baseline.light[token.key] ?? "";
			const value = parseNumeric(token, raw);
			assert.ok(
				value !== undefined,
				`${token.key} = ${raw} 不是 ${token.unit}`,
			);
			assert.ok(
				value >= token.min && value <= token.max,
				`${token.key} = ${value} 超出范围`,
			);
		}
	});

	test("组件令牌声明在组件自己的 CSS 的 :root 上", () => {
		for (const token of NUMERIC_TOKENS) {
			if (!(token.group in COMPONENT_TIERS)) continue;
			const css = sources[`src/components/ui/${token.group}.css`] ?? "";
			assert.ok(
				token.key in readSource([css]).light,
				`${token.key} 不在 ${token.group}.css 的 :root 上`,
			);
		}
	});

	test("缓动令牌的原版值是可选值之一", () => {
		for (const { key } of EASING_TOKENS)
			assert.ok(
				EASINGS.some(([easing]) => easing === baseline.light[key]),
				`${key} = ${baseline.light[key]} 不在可选值里`,
			);
	});

	test("CSS 里声明的颜色、尺寸与动效令牌都在令牌表里；不在的都由别的令牌算出", () => {
		const declared = readSource(Object.values(sources)).light;
		const editable = /^--(color|radius|text|container|ease|duration)-|-height$/;
		const component = new RegExp(
			`^--(${Object.keys(COMPONENT_TIERS).join("|")})-`,
		);
		const known = new Set([
			...COLOR_TOKENS.map(([key]) => key),
			...NUMERIC_TOKENS.map((token) => token.key),
			...EASING_TOKENS.map((token) => token.key),
		]);
		for (const [key, value] of Object.entries(declared)) {
			if (!editable.test(key) && !component.test(key)) continue;
			assert.ok(
				known.has(key) || value.includes("var("),
				`${key} = ${value} 不在令牌表里`,
			);
		}
	});

	test("投影令牌表与 styles.css 里声明的 --elevation-* 一一对应", () => {
		const css = sources[THEME_SOURCE] ?? "";
		const declared = new Set(
			[...css.matchAll(/^\s*(--elevation-[\w-]+)\s*:/gm)].map(([, key]) => key),
		);
		assert.deepEqual(
			[...declared].sort(),
			SHADOW_TOKENS.map((token) => token.key).sort(),
		);
	});

	test("每个组件令牌都有 var() 读它", () => {
		for (const token of NUMERIC_TOKENS) {
			if (!(token.group in COMPONENT_TIERS)) continue;
			assert.ok(
				Object.values(srcFiles).some((text) =>
					text.includes(`var(${token.key})`),
				),
				`没有地方读 ${token.key}`,
			);
		}
	});

	test("每个组件文件在目录里有一页；对话框与抽屉共用的开合状态不单独成页", () => {
		for (const file of globSync("src/components/ui/*.tsx", {
			cwd: REPO_ROOT,
		})) {
			if (file === "src/components/ui/dialog-presence.tsx") continue;
			assert.ok(pagesOfFile(file).length > 0, `${file} 在目录里没有页`);
		}
	});
});

describe("修改版", () => {
	test("改成和原版一样就从修改版里去掉；颜色按通道比", () => {
		const original = originalValue("light", "--color-primary") ?? "";
		const changed = updateToken(
			emptyDraft(),
			"light",
			"--color-primary",
			"#123456",
		);
		assert.equal(changed.light["--color-primary"], "#123456");
		assert.deepEqual(
			updateToken(changed, "light", "--color-primary", original.toUpperCase()),
			emptyDraft(),
		);
	});

	test("数值按换算后的数比：省掉前导零的 rem、等值的写法都算没改", () => {
		const token = numericToken("--radius-md");
		assert.ok(token);
		const px = parseNumeric(
			token,
			originalValue("shared", "--radius-md") ?? "",
		);
		assert.ok(px !== undefined);
		const bare = `${String(px / 16).replace(/^0/, "")}rem`;
		assert.match(bare, /^\.\d+rem$/);
		assert.deepEqual(
			updateToken(emptyDraft(), "shared", "--radius-md", bare),
			emptyDraft(),
		);
	});

	test("读值时修改版优先，没有就用原版", () => {
		const draft = updateToken(emptyDraft(), "dark", "--color-fg", "#eeeeee");
		assert.equal(tokenValue(draft, "dark", "--color-fg"), "#eeeeee");
		assert.equal(
			tokenValue(draft, "light", "--color-fg"),
			baseline.light["--color-fg"],
		);
	});

	test("恢复原版值：去掉指定的几项，别的留着", () => {
		const draft: Draft = {
			dark: {},
			light: {},
			shared: { "--button-gap": "8px", "--radius-md": "0.5rem" },
		};
		assert.deepEqual(resetTokens(draft, "shared", ["--button-gap"]), {
			dark: {},
			light: {},
			shared: { "--radius-md": "0.5rem" },
		});
	});

	test("校验收下合规的修改版", () => {
		assert.ok(isDraft(emptyDraft()));
		assert.ok(
			isDraft({
				dark: {},
				light: { "--color-primary": "#112233" },
				shared: {
					"--duration-modal-enter": "300ms",
					"--ease-soft": "linear",
					"--radius-md": ".5rem",
				},
			}),
		);
	});

	test("校验拒绝缺一侧、表外的键、写不对的值、单位不对和超出范围", () => {
		const shared = (values: Record<string, string>) => ({
			dark: {},
			light: {},
			shared: values,
		});
		assert.ok(!isDraft({ dark: {}, light: {} }));
		assert.ok(
			!isDraft({ dark: {}, light: { "--color-nope": "#112233" }, shared: {} }),
		);
		assert.ok(
			!isDraft({
				dark: {},
				light: { "--color-primary": "red; }" },
				shared: {},
			}),
		);
		assert.ok(!isDraft(shared({ "--radius-md": "99rem" })));
		assert.ok(!isDraft(shared({ "--radius-md": "8px" })));
		assert.ok(!isDraft(shared({ "--ease-out": "ease" })));
		assert.ok(!isDraft(shared({ "--duration-modal-enter": "0.3s" })));
		assert.ok(!isDraft(shared({ "--duration-modal-exit": "9999ms" })));
	});
});

describe("写出的 CSS", () => {
	const draft: Draft = {
		dark: { "--color-fg": "#eeeeee" },
		light: { "--color-primary": "#112233" },
		shared: {
			"--button-gap": "8px",
			"--duration-modal-enter": "300ms",
			"--input-height-small": "26px",
			"--radius-md": "0.625rem",
		},
	};

	test("预览里两种外观的颜色各自限定，共用值写在 :root", () => {
		const css = previewCss(draft);
		assert.match(
			css,
			/^:root \{\n\t--button-gap: 8px;\n\t--duration-modal-enter: 300ms;\n\t--input-height-small: 26px;\n\t--radius-md: 0\.625rem;\n\}/,
		);
		assert.match(
			css,
			/:root:not\(\.dark\) \{\n\t--color-primary: #112233;\n\}/,
		);
		assert.match(css, /:root\.dark \{\n\t--color-fg: #eeeeee;\n\}/);
	});

	test("导出按声明令牌的文件分段，组件尺寸进各自的 CSS", () => {
		const css = exportCss(draft, sources);
		assert.match(
			css,
			/合进 src\/styles\.css 的 `@theme static`[^\n]*\n@theme static \{\n\t--color-primary: #112233;\n\t--duration-modal-enter: 300ms;\n\t--radius-md: 0\.625rem;\n\}/,
		);
		assert.match(
			css,
			/合进 src\/styles\.css 的 `\.dark`[^\n]*\n\.dark \{\n\t--color-fg: #eeeeee;\n\}/,
		);
		assert.match(
			css,
			/合进 src\/components\/ui\/button\.css 的 `:root`[^\n]*\n:root \{\n\t--button-gap: 8px;\n\}/,
		);
		assert.match(
			css,
			/合进 src\/components\/ui\/input\.css 的 `:root`[^\n]*\n:root \{\n\t--input-height-small: 26px;\n\}/,
		);
	});

	test("没有修改时导出一句「与原版一致」", () => {
		assert.equal(exportCss(emptyDraft(), sources), "/* 与原版一致 */\n");
	});
});

describe("写回源文件", () => {
	test("已有的声明原地换值，别的字一个不动", () => {
		const draft: Draft = {
			dark: { "--color-fg": "#eeeeee" },
			light: { "--color-primary": "#112233" },
			shared: {
				"--duration-drawer-exit": "180ms",
				"--input-height-small": "26px",
				"--radius-md": "0.625rem",
			},
		};
		const written = applyDraft(draft, sources);
		assert.deepEqual(Object.keys(written).sort(), [
			"src/components/ui/input.css",
			"src/styles.css",
		]);
		const after = readSource(Object.values({ ...sources, ...written }));
		assert.equal(after.light["--color-primary"], "#112233");
		assert.equal(after.dark["--color-fg"], "#eeeeee");
		assert.equal(after.light["--radius-md"], "0.625rem");
		assert.equal(after.light["--duration-drawer-exit"], "180ms");
		assert.equal(after.light["--input-height-small"], "26px");
		const original = sources["src/components/ui/input.css"] ?? "";
		assert.equal(
			written["src/components/ui/input.css"],
			original.replace(
				"--input-height-small: 24px;",
				"--input-height-small: 26px;",
			),
		);
	});

	test("深色一侧还没写的颜色补在 .dark 块末尾；注释里的同名声明不算", () => {
		const css =
			"@theme static {\n\t/* --a: #000; */\n\t--a: #111111;\n}\n\n.dark {\n\t--b: #222222;\n}\n";
		const written = applyDraft(
			{ dark: { "--a": "#333333" }, light: { "--a": "#444444" }, shared: {} },
			{ "src/styles.css": css },
		);
		assert.equal(
			written["src/styles.css"],
			"@theme static {\n\t/* --a: #000; */\n\t--a: #444444;\n}\n\n.dark {\n\t--b: #222222;\n\t--a: #333333;\n}\n",
		);
	});

	test("写回之后，修改版里和新原版相同的项都去掉", () => {
		const draft: Draft = {
			dark: {},
			light: { "--color-primary": "#112233" },
			shared: { "--button-gap": "8px" },
		};
		const after = readSource(
			Object.values({ ...sources, ...applyDraft(draft, sources) }),
		);
		assert.deepEqual(draftModel(after).pruneDraft(draft), emptyDraft());
		assert.deepEqual(pruneDraft(draft), draft);
	});

	test("深色一侧只覆盖 .dark 里写了的，其余沿用浅色", () => {
		const source = readSource([
			":root { --a: 1px; --b: #fff; }\n.dark { --b: #000; }\n.other { --a: 9px; }",
		]);
		assert.deepEqual(source.light, { "--a": "1px", "--b": "#fff" });
		assert.deepEqual(source.dark, { "--a": "1px", "--b": "#000" });
	});

	test("注释里的花括号和声明不算", () => {
		const source = readSource([":root { /* --a: 2px; { } */ --a: 1px; }"]);
		assert.deepEqual(source.light, { "--a": "1px" });
	});
});

describe("影响范围", () => {
	const files = {
		"a.css":
			".x { color: var(--color-fg); background: var(--color-fg-secondary); }",
		"b.tsx":
			'cn("text-fg hover:bg-fg/50 text-fg-secondary", "rounded-md rounded-t-md")',
		"c.css": ":root { --color-fg: #000; --radius-md: 8px; }",
		"d.tsx": 'cn("max-w-(--container-page) w-page text-sm")',
		"e.tsx": 'durationOf("--duration-modal-enter")',
	};

	test("变量引用和生成的工具类都算，长一截的同前缀名字不算，声明本身不算", () => {
		assert.deepEqual(usagesOf("--color-fg", files), [
			{ count: 1, file: "a.css" },
			{ count: 2, file: "b.tsx" },
		]);
		assert.deepEqual(usagesOf("--radius-md", files), [
			{ count: 2, file: "b.tsx" },
		]);
	});

	test("时长令牌按脚本里读它的字符串找", () => {
		assert.deepEqual(usagesOf("--duration-modal-enter", files), [
			{ count: 1, file: "e.tsx" },
		]);
	});

	test("版心令牌按 w-* 和 (--x) 两种写法找；行高跟着字号的工具类走", () => {
		assert.deepEqual(usagesOf("--container-page", files), [
			{ count: 2, file: "d.tsx" },
		]);
		assert.deepEqual(usagesOf("--text-sm--line-height", files), [
			{ count: 1, file: "d.tsx" },
		]);
	});

	test("组件文件对到组件页，路由下的业务组件对到业务组件页", () => {
		assert.deepEqual(
			pagesOfFile("src/components/ui/button.css").map((page) => page.id),
			["components/button"],
		);
		assert.deepEqual(
			pagesOfFile("src/routes/s/$turnId/-components/thread.tsx").map(
				(page) => page.id,
			),
			["product/thread"],
		);
	});

	test("本页颜色：有源文件的页读源文件里的颜色，没有的读目录里写的", () => {
		const button = pageById("components/button");
		const motion = pageById("foundations/motion");
		assert.ok(button && motion);
		const colors = pageColors(button, srcFiles);
		assert.ok(colors.includes("--color-primary"));
		assert.ok(colors.every((key) => isColorToken(key)));
		assert.deepEqual(pageColors(motion, srcFiles), motion.colors);
	});
});

describe("撤销与重做", () => {
	const at = (gap: number): Draft => ({
		dark: {},
		light: {},
		shared: { "--button-gap": `${gap}px` },
	});

	test("撤销回到上一步，重做回来；新的修改清掉可重做的", () => {
		let state: History = { future: [], past: [], present: emptyDraft() };
		state = editHistory(state, { draft: at(1), type: "edit" });
		state = editHistory(state, { draft: at(2), type: "edit" });
		state = editHistory(state, { type: "undo" });
		assert.deepEqual(state.present, at(1));
		state = editHistory(state, { type: "redo" });
		assert.deepEqual(state.present, at(2));
		state = editHistory(state, { type: "undo" });
		state = editHistory(state, { draft: at(3), type: "edit" });
		assert.deepEqual(state.future, []);
	});

	test("记的步数有上限，和现在一样的修改不记", () => {
		let state: History = { future: [], past: [], present: emptyDraft() };
		for (let gap = 1; gap <= HISTORY_LIMIT + 20; gap++)
			state = editHistory(state, { draft: at(gap % 17), type: "edit" });
		assert.equal(state.past.length, HISTORY_LIMIT);
		assert.equal(
			editHistory(state, { draft: state.present, type: "edit" }),
			state,
		);
	});
});

describe("颜色", () => {
	test("四种写法解析成同一组通道，没算出来的 color-mix 读不懂", () => {
		assert.deepEqual(parseColor("#ff8000"), { a: 1, b: 0, g: 128, r: 255 });
		assert.deepEqual(parseColor("rgba(255, 128, 0, 0.5)"), {
			a: 0.5,
			b: 0,
			g: 128,
			r: 255,
		});
		assert.deepEqual(parseColor("rgb(255 128 0 / 50%)"), {
			a: 0.5,
			b: 0,
			g: 128,
			r: 255,
		});
		assert.deepEqual(parseColor("color(srgb 1 0.5 0 / 0.5)"), {
			a: 0.5,
			b: 0,
			g: 127.5,
			r: 255,
		});
		assert.equal(parseColor("color-mix(in srgb, red, blue)"), undefined);
	});

	test("不透明写 hex，半透明写 rgba；不同写法的同一个颜色算相同", () => {
		assert.equal(formatColor({ a: 1, b: 0, g: 128, r: 255 }), "#ff8000");
		assert.equal(
			formatColor({ a: 0.25, b: 0, g: 128, r: 255 }),
			"rgba(255, 128, 0, 0.25)",
		);
		assert.ok(sameColor("#FF8000", "rgb(255, 128, 0)"));
	});

	test("OKLCH 来回换一次颜色不变", () => {
		for (const hex of ["#222222", "#1677ff", "#ec5e41", "#52c41a", "#faad14"]) {
			const color = parseColor(hex);
			assert.ok(color);
			assert.equal(formatColor(fromOklch(toOklch(color), 1)), hex);
		}
	});

	test("OKLCH 超出 sRGB 时看得出来，换回去的通道截到边界", () => {
		const primary = parseColor("#1677ff");
		assert.ok(primary);
		assert.ok(inSrgb(toOklch(primary)));
		assert.ok(inSrgb({ c: 0, h: 0, l: 1 }));
		const vivid = { c: 0.4, h: 145, l: 0.7 };
		assert.ok(!inSrgb(vivid));
		const clipped = fromOklch(vivid, 1);
		for (const channel of [clipped.r, clipped.g, clipped.b])
			assert.ok(channel >= 0 && channel <= 255);
	});

	test("对比度：黑白 21:1，半透明文字先叠到底上再量，底不是不透明时量不了", () => {
		const white = { a: 1, b: 255, g: 255, r: 255 };
		const black = { a: 1, b: 0, g: 0, r: 0 };
		assert.equal(contrastRatio(black, [white])?.toFixed(2), "21.00");
		const half = contrastRatio({ ...black, a: 0.5 }, [white]) ?? 0;
		assert.ok(half > 3 && half < 5);
		assert.equal(contrastRatio(black, [{ ...white, a: 0.5 }]), undefined);
	});
});

describe("外壳与预览页之间的消息", () => {
	const state = previewState("components/button");

	test("形状对的状态才收：页在目录里的预览页、速度可选、选中的是颜色、修改版合规", () => {
		assert.ok(isToPreview({ state, type: "design-system:state" }));
		const bad = (patch: Record<string, unknown>) =>
			isToPreview({
				state: { ...state, ...patch },
				type: "design-system:state",
			});
		assert.ok(!bad({ page: "components/nope" }));
		assert.ok(!bad({ page: "changes/review" }));
		assert.ok(!bad({ speed: 2 }));
		assert.ok(!bad({ selectedColor: "--radius-md" }));
		assert.ok(!bad({ draft: { light: {} } }));
	});

	test("动效命令只认打开、关闭、重播", () => {
		assert.ok(isToPreview({ action: "replay", type: "design-system:motion" }));
		assert.ok(!isToPreview({ action: "spin", type: "design-system:motion" }));
	});

	test("预览页发来的：准备好了，或者选中了一个颜色令牌", () => {
		assert.ok(isToShell({ type: "design-system:ready" }));
		assert.ok(
			isToShell({ token: "--color-fg", type: "design-system:select-color" }),
		);
		assert.ok(
			!isToShell({ token: "--radius-md", type: "design-system:select-color" }),
		);
	});
});

describe("存储", () => {
	test("读不懂的内容退回空的一份", () => {
		assert.deepEqual(decodeSession("{"), { draft: emptyDraft(), schemes: [] });
		assert.deepEqual(decodeSession(null), { draft: emptyDraft(), schemes: [] });
	});

	test("方案逐个校验，不合形状的丢掉，最多留上限个", () => {
		const scheme = (index: number) => ({
			draft: emptyDraft(),
			id: `s${index}`,
			name: `方案 ${index}`,
			savedAt: "2026-09-26T00:00:00.000Z",
		});
		const raw = JSON.stringify({
			draft: emptyDraft(),
			schemes: [
				{ ...scheme(0), name: "" },
				...Array.from({ length: MAX_SCHEMES + 5 }, (_, index) =>
					scheme(index + 1),
				),
			],
		});
		const session = decodeSession(raw);
		assert.equal(session.schemes.length, MAX_SCHEMES);
		assert.equal(session.schemes[0]?.id, "s1");
	});
});

describe("目录与地址", () => {
	test("页的身份是 模块/页，和地址一致", () => {
		for (const module of catalog)
			for (const page of module.pages) {
				assert.equal(page.id, `${module.id}/${page.slug}`);
				const route = resolveRoute(`#/${page.id}`);
				assert.ok(route.kind === "page" && route.page === page);
			}
	});

	test("总览、模块页、找不到的页；修改管理的页不画在预览页里", () => {
		assert.equal(resolveRoute("").kind, "overview");
		assert.equal(resolveRoute("#/").kind, "overview");
		assert.equal(resolveRoute("#/components").kind, "module");
		assert.equal(resolveRoute("#/components/nope").kind, "notFound");
		assert.ok(isPreviewPageId("components/button"));
		assert.ok(!isPreviewPageId("changes/review"));
	});

	test("对话框页只放对话框的动效，动效页放全部", () => {
		const modal = motionTokens("modal");
		assert.deepEqual(
			modal.durations.map((token) => token.key),
			[
				"--duration-modal-enter",
				"--duration-modal-exit",
				"--duration-backdrop",
			],
		);
		assert.deepEqual(
			modal.easings.map((token) => token.key),
			["--ease-soft", "--ease-accelerate"],
		);
		assert.equal(motionTokens("all").easings.length, EASING_TOKENS.length);
	});
});

describe("使用规则的 Markdown", () => {
	test("标题、源文件、写法、要点依次排开", () => {
		const markdown = rulesMarkdown({
			name: "Button",
			rules: {
				notes: ["一次动作用 Button", "只有图标用 ActionIcon"],
				usage: '<Button type="primary">新建搜索</Button>',
			},
			source: ["src/components/ui/button.tsx"],
			title: "按钮",
		});
		assert.equal(
			markdown,
			[
				"# 按钮 Button",
				"",
				"源文件：`src/components/ui/button.tsx`",
				"",
				"## 写法",
				"",
				"```tsx",
				'<Button type="primary">新建搜索</Button>',
				"```",
				"",
				"## 要点",
				"",
				"- 一次动作用 Button",
				"- 只有图标用 ActionIcon",
				"",
			].join("\n"),
		);
	});

	test("写法里有三个反引号时栅栏加长；几个源文件用顿号隔开", () => {
		const markdown = rulesMarkdown({
			rules: { notes: [], usage: "const s = ```;" },
			source: ["a.tsx", "b.tsx"],
			title: "示例",
		});
		assert.ok(markdown.startsWith("# 示例\n\n源文件：`a.tsx`、`b.tsx`\n"));
		assert.ok(markdown.includes("\n````tsx\nconst s = ```;\n````\n"));
	});
});
