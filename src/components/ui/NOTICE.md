# 这一目录是抄来的

`src/components/ui/*.tsx` 与 `src/lib/utils.ts` 逐字取自 coss ui 的组件注册表：

- 来源：<https://github.com/cosscom/coss>，路径 `apps/ui/registry/default/ui/` 与
  `apps/ui/registry/default/lib/utils.ts`
- 改动只有两处，都记在这里：

  1. import 别名：`@/registry/default/lib/utils` → `#/lib/utils`，
     `@/registry/default/ui/*` → `#/components/ui/*`
  2. `popover.tsx` 与 `tooltip.tsx` 各多转发一个定位器属性 `positionMethod`

第 2 条的理由：上游这两个包装件把它要用的定位器属性一个个列出来转发
（`side` / `align` / `sideOffset` / `alignOffset` / `anchor`），`positionMethod`
不在其中——coss 文档站自己的顶栏挂的是 Drawer 和居中的 Dialog，没有锚在吸顶元素
上的浮层，用不到它。本项目的「最近搜索」正是那种：锚点在吸顶的顶栏里，视口里不动
而文档里一直动，浮层按默认的文档坐标（`absolute`）定位就得每滚一帧重算一次位置，
配上定位器自带的 `transition-[top,left,…]` 会在滚动时上下游。`positionMethod="fixed"`
是 Base UI 给这种情形的正解，转发一个属性比在别处绕开它便宜得多。

升级这两个文件时把这一个属性重新加回去即可，位置和其余五个并列。

**必须从 `apps/ui/` 抄，不能从 `packages/ui/` 抄。** 两处的文件几乎一字不差，
只有 import 别名不同，但许可证是两码事：coss 仓库的 `LICENSING.md` 把默认许可证
定为 AGPL-3.0，只把 `apps/origin/` 和 `apps/ui/` 两个目录排除出去。本项目是 MIT，
抄错目录就等于把整个仓库拖进 AGPL，而且从代码上完全看不出来。

升级或补新组件时走同一条路：从 `apps/ui/registry/default/` 取文件，改两处别名，
不要用 `npx shadcn@latest add @coss/<component>` 直接落盘——CLI 会顺手改
`components.json`、往 `globals.css` 里塞令牌、按它自己的别名布局写文件，
而这个项目的令牌层是手写的（见 `src/styles.css`），别名也是 `#/*` 而不是 `@/*`。

组件不依赖 Next.js（那部分只在 coss 的 `packages/ui/src/shared/` 和 `fonts/` 里），
所以在 Vite + TanStack Start 下直接可用。运行时依赖是 `@base-ui/react`、
`class-variance-authority`、`clsx`、`tailwind-merge` 和 `lucide-react`。

除上面记下的那一个属性之外，抄进来的文件**一个字都不改**，包括 lint 意见不同的那几处：
`InputGroup` 用 `<div role="group">`（`useSemanticElements` 想要 `<fieldset>`，
但那是表单分组，不是控件分组），`InputGroupAddon` 在 `<div>` 上挂 `onMouseDown`
把焦点还给输入框（`noStaticElementInteractions` 只看元素不看用途）。
这两条在 `biome.json` 里对本目录关掉——改代码去迎合 lint 会让下一次升级
产生冲突，而冲突点恰恰是这些无关紧要的地方。
