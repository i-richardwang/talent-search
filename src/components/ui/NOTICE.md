# 这一目录是抄来的

`src/components/ui/*.tsx` 与 `src/lib/utils.ts` 逐字取自 coss ui 的组件注册表：

- 来源：<https://github.com/cosscom/coss>，路径 `apps/ui/registry/default/ui/` 与
  `apps/ui/registry/default/lib/utils.ts`
- 唯一的改动是 import 别名：`@/registry/default/lib/utils` → `#/lib/utils`，
  `@/registry/default/ui/*` → `#/components/ui/*`

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
