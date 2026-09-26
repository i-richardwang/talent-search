/*
 * 外壳自己的几个尺寸：组件的档与令牌里都没有对应的值，集中写在这里。
 * Tailwind 类名写全，扫描得到。
 */

/** 整个外壳的最小高度；再矮时外壳整体滚动，不再压扁中间的预览。 */
export const SHELL_MIN_HEIGHT = "min-h-135";

/** 手机宽度下外壳改成上下排，中间的预览给一屏以上的高度。 */
export const NARROW_MAIN_MIN_HEIGHT = "max-sm:min-h-185";

/** 目录的宽度：左栏与窄屏收进的抽屉同宽。 */
export const NAV_WIDTH = "14rem";

/** 导出对话框的宽度（42rem）；放得下一行完整的 CSS 声明。 */
export const EXPORT_DIALOG_WIDTH = "max-w-2xl";
