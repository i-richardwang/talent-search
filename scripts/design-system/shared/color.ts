/**
 * 颜色的解析、写法与换算。`styles.css` 里的颜色有三种写法：`#rrggbb`、
 * `rgba(r, g, b, a)` 与 `rgb(r g b / a)`；浏览器算出来的 `color-mix()` 是
 * `color(srgb r g b / a)`。编辑后的颜色写成 `#rrggbb`（不透明）或
 * `rgba(r, g, b, a)`（半透明），和文件里的写法一致。
 */

/** 0–255 的三个通道与 0–1 的透明度。 */
export interface Rgba {
	r: number;
	g: number;
	b: number;
	a: number;
}

const HEX = /^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i;
const SRGB =
	/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+))?\)$/i;
const RGB =
	/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?))?\s*\)$/i;

/** 解析一种上面列出的写法；别的写法（未计算的 `color-mix()` 等）返回 undefined。 */
export function parseColor(value: string): Rgba | undefined {
	const text = value.trim();
	const hex = HEX.exec(text)?.[1];
	if (hex) {
		const full =
			hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
		const channel = (index: number) =>
			Number.parseInt(full.slice(index * 2, index * 2 + 2), 16);
		return {
			r: channel(0),
			g: channel(1),
			b: channel(2),
			a: full.length === 8 ? round(channel(3) / 255, 3) : 1,
		};
	}
	const srgb = SRGB.exec(text);
	if (srgb)
		return {
			r: Number(srgb[1]) * 255,
			g: Number(srgb[2]) * 255,
			b: Number(srgb[3]) * 255,
			a: srgb[4] === undefined ? 1 : Number(srgb[4]),
		};
	const rgb = RGB.exec(text);
	if (!rgb) return undefined;
	const alpha = rgb[4] === undefined ? 1 : Number(rgb[4]) / (rgb[5] ? 100 : 1);
	return {
		r: Number(rgb[1]),
		g: Number(rgb[2]),
		b: Number(rgb[3]),
		a: alpha,
	};
}

const round = (value: number, digits: number) => Number(value.toFixed(digits));

const byte = (value: number) =>
	Math.round(Math.max(0, Math.min(255, value)))
		.toString(16)
		.padStart(2, "0");

/** `#RRGGBB`，不含透明度。 */
export const toHex = ({ r, g, b }: Rgba) =>
	`#${byte(r)}${byte(g)}${byte(b)}`.toUpperCase();

/** 写回 CSS：不透明写 `#rrggbb`，半透明写 `rgba(r, g, b, a)`。 */
export function formatColor(color: Rgba): string {
	if (color.a >= 1) return toHex(color).toLowerCase();
	const channel = (value: number) => Math.round(value);
	return `rgba(${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)}, ${round(color.a, 3)})`;
}

/** 两个写法是不是同一个颜色：通道取整后相等、透明度差不到千分之一。 */
export function sameColor(a: string, b: string): boolean {
	const x = parseColor(a);
	const y = parseColor(b);
	if (!x || !y) return a.trim() === b.trim();
	return (
		Math.round(x.r) === Math.round(y.r) &&
		Math.round(x.g) === Math.round(y.g) &&
		Math.round(x.b) === Math.round(y.b) &&
		Math.abs(x.a - y.a) < 0.001
	);
}

/** 把半透明的颜色叠到不透明的底上，得到看到的颜色。 */
function composite(top: Rgba, under: Rgba): Rgba {
	return {
		r: top.r * top.a + under.r * (1 - top.a),
		g: top.g * top.a + under.g * (1 - top.a),
		b: top.b * top.a + under.b * (1 - top.a),
		a: 1,
	};
}

const linear = (channel: number) => {
	const value = channel / 255;
	return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

const luminance = ({ r, g, b }: Rgba) =>
	0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);

/**
 * WCAG 2.1 对比度。`layers` 从最外层不透明的底到最里层，依次叠起来当作底色；
 * 文字色也叠在这个底上再量。最外层不是不透明的颜色时返回 undefined。
 */
export function contrastRatio(
	foreground: Rgba,
	layers: Rgba[],
): number | undefined {
	const [outer, ...inner] = layers;
	if (!outer || outer.a < 1) return undefined;
	const background = inner.reduce(
		(under, layer) => composite(layer, under),
		outer,
	);
	const text = composite(foreground, background);
	const [light, dark] = [luminance(text), luminance(background)].sort(
		(x, y) => y - x,
	) as [number, number];
	return (light + 0.05) / (dark + 0.05);
}

/** OKLCH：明度 0–1、彩度 0–0.4、色相 0–360。换算不取整，显示时再取。 */
export interface Oklch {
	l: number;
	c: number;
	h: number;
}

const toLinear = (channel: number) => linear(channel);
const fromLinear = (value: number) =>
	255 *
	(value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055);

export function toOklch({ r, g, b }: Rgba): Oklch {
	const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
	const l = Math.cbrt(
		0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb,
	);
	const m = Math.cbrt(
		0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb,
	);
	const s = Math.cbrt(
		0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb,
	);
	const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
	const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
	const chroma = Math.hypot(a, bb);
	const hue =
		chroma < 1e-4 ? 0 : ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
	return { c: chroma, h: hue, l: lightness };
}

/** OKLCH 换成线性 sRGB 的三个通道，不截断；超出 sRGB 时有通道落在 0–1 之外。 */
function oklchToLinear({ l, c, h }: Oklch): [number, number, number] {
	const a = c * Math.cos((h * Math.PI) / 180);
	const b = c * Math.sin((h * Math.PI) / 180);
	const lp = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
	const mp = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
	const sp = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
	return [
		4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp,
		-1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp,
		-0.0041960863 * lp - 0.7034186147 * mp + 1.707614701 * sp,
	];
}

/** 这个 OKLCH 颜色在不在 sRGB 里；差不到半个色阶（1/510）的算在里面。 */
export const inSrgb = (color: Oklch) =>
	oklchToLinear(color).every(
		(value) => fromLinear(value) >= -0.5 && fromLinear(value) <= 255.5,
	);

/** OKLCH 换回 sRGB；超出 sRGB 的通道截到边界。 */
export function fromOklch(color: Oklch, alpha: number): Rgba {
	const channel = (value: number) =>
		Math.max(0, Math.min(255, fromLinear(value)));
	const [r, g, b] = oklchToLinear(color).map(channel) as [
		number,
		number,
		number,
	];
	return { r, g, b, a: alpha };
}
