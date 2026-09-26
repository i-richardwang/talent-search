/*
 * 预览页的变速：动效页可以把组件的动画放慢到 1/2、1/4 来看。组件的动画有两类：
 * CSS 过渡与 Web Animations 走浏览器的动画时间线，逐个把 playbackRate 设成倍率；
 * motion 逐帧算的动画读 `performance.now()` 与 requestAnimationFrame 给的时间，
 * 这两个换成按倍率走的时钟。这个模块要在任何组件之前加载。
 */

let rate = 1;
const realNow = performance.now.bind(performance);
const realFrame = window.requestAnimationFrame.bind(window);
let realBase = realNow();
let virtualBase = realBase;

const virtualNow = () => virtualBase + (realNow() - realBase) * rate;

performance.now = virtualNow;
window.requestAnimationFrame = (callback) =>
	realFrame(() => callback(virtualNow()));

let watching = false;

/** 倍率不是 1 时每帧给新出现的动画设倍率；回到 1 时把现有的都设回去后停下。 */
function watch() {
	for (const animation of document.getAnimations()) {
		if (animation.playbackRate !== rate) animation.playbackRate = rate;
	}
	if (rate === 1) {
		watching = false;
		return;
	}
	realFrame(watch);
}

export function setPlaybackRate(next: number) {
	virtualBase = virtualNow();
	realBase = realNow();
	rate = next;
	if (!watching) {
		watching = true;
		realFrame(watch);
	}
}
