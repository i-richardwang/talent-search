/**
 * 页框：两根通高的发丝线，标出页宽列的左右边界；顶栏那根横线横穿过去，
 * 交点上各钉一枚小方块。底色仍是干净的画布色，把屏幕划成一张有边界的纸的是
 * 这几根**线**——coss 文档站那套底面就是这么画的。
 *
 * 两层分开，因为它们跟着的东西不一样：竖线是 `absolute`，随内容一起滚，
 * 所以它通到文档底部而不是只有一屏高；小方块是 `fixed`，永远钉在顶栏那根
 * 横线上，滚动时不动——它标的是「顶栏与页框相交的那个点」，那个点不会滚走。
 *
 * `z-frame` 压过顶栏（`z-stick`）：竖线要连着穿过顶栏，被截断的话画出来的
 * 不是一个框，是上下两截对不齐的线。
 *
 * 视口比页宽列窄时（手机、窄窗口），线落在屏幕外——`app-column` 此时就是整屏，
 * 而 `-left-3` 把线推到了屏幕左边之外。这是对的：没有余量的时候框不出东西来，
 * 硬画只会变成两条贴着内容的杂线。外壳根节点的 `overflow-clip` 顺手把这一截
 * 溢出剪掉，否则手机上会多出一条横向滚动。
 */
export function PageFrame() {
	return (
		<>
			<div
				aria-hidden="true"
				className="app-column pointer-events-none absolute inset-0 z-frame before:absolute before:inset-y-0 before:-left-3 before:w-px before:bg-border/64 after:absolute after:inset-y-0 after:-right-3 after:w-px after:bg-border/64"
			/>
			{/*
			 * 小方块的位置是算出来的，别改成手调的整数：`--header-height` 减 4.5px
			 * 让 8px 见方的块正好骑在那根横线上，`-11.5px` 加 `-ml-1` 让它正好骑在
			 * 竖线上（竖线中心在 -11.5px）。顶栏改高，方块自己跟着走。
			 */}
			<div
				aria-hidden="true"
				className="app-column pointer-events-none fixed inset-0 z-frame before:absolute before:top-[calc(var(--header-height)-4.5px)] before:-left-[11.5px] before:-ml-1 before:size-2 before:rounded-[2px] before:border before:border-border before:bg-popover before:bg-clip-padding before:shadow-xs/5 after:absolute after:top-[calc(var(--header-height)-4.5px)] after:-right-[11.5px] after:-mr-1 after:size-2 after:rounded-[2px] after:border after:border-border after:bg-popover after:bg-clip-padding after:shadow-xs/5 dark:before:bg-clip-border dark:after:bg-clip-border"
			/>
		</>
	);
}
