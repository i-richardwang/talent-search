import type { LinkComponentProps } from "@cloudflare/kumo";
import { Link as RouterLink } from "@tanstack/react-router";
import { forwardRef } from "react";

/**
 * Kumo 的 Link / LinkButton / Breadcrumbs 只认 `href`，路由交给宿主框架。
 * 这个桥接件把 href 映射到 TanStack Router，让全站链接走客户端导航。
 * 官方推荐用法：<LinkProvider component={AppLink}>。
 */
export const AppLink = forwardRef<HTMLAnchorElement, LinkComponentProps>(
	({ href, ...props }, ref) => (
		<RouterLink ref={ref} to={href as string} {...props} />
	),
);

AppLink.displayName = "AppLink";
