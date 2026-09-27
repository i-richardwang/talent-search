"use client";

import { Toast as BaseToast } from "@base-ui/react/toast";
import {
	CircleCheck,
	CircleX,
	Info,
	LoaderCircle,
	type LucideIcon,
	TriangleAlert,
	X,
} from "lucide-react";
import type { ReactNode } from "react";
import { defaultPortalContainer } from "#/components/ui/floating";
import { Icon } from "#/components/ui/icon";
import { cn } from "#/lib/utils";

/*
 * 通知，样式在 toast.css。`<Toaster />` 在根上挂一次，别处调 `toast.success(...)` 这一组函数，
 * 不需要 React 上下文，事件处理与异步回调里都能调。
 *
 * - 右下角、宽 360px，最多同时 5 条；叠起来时后面的缩小并露出 12px 的边，指针移上去展开。
 * - 默认 5 秒后自己关；`loading` 不自己关，等调用处 `close()` 或换成结果。
 * - 往下或往右滑动关掉。
 * - 只给一句字符串时那句是正文、深色；给了 `title` 时标题深色、`description` 灰色在下。
 * - 同一个 `id` 再调一次是原地更新那一条并重新计时，不再叠一条。
 *
 * Base UI 的 toast 管理器只是一个广播：`<Toaster />` 挂上之后调用才有人接。
 */

export type ToastType =
	| "default"
	| "success"
	| "info"
	| "warning"
	| "error"
	| "loading";

export interface ToastAction {
	label: ReactNode;
	onClick?: () => void;
	/** `primary` 是主色实底；`text` 是主色文字，没有底。 */
	variant?: "primary" | "text";
}

export interface ToastOptions {
	/** 标题下面一行按钮，右对齐。 */
	actions?: ToastAction[];
	/** 不给关闭钮。 */
	closable?: boolean;
	description?: ReactNode;
	/** 多少毫秒后自己关，0 是不自己关。 */
	duration?: number;
	/** 同一个 id 的通知只有一条，再调是原地更新。 */
	id?: string;
	title?: ReactNode;
}

interface ToastData {
	actions?: ToastAction[];
	closable: boolean;
}

export interface ToastInstance {
	close: () => void;
	id: string;
	update: (options: Pick<ToastOptions, "title" | "description">) => void;
}

type ToastInput = ToastOptions | string;

const DURATION = 5000;
const LIMIT = 5;

const manager = BaseToast.createToastManager<ToastData>();

const ICONS: Record<ToastType, LucideIcon> = {
	default: Info,
	error: CircleX,
	info: Info,
	loading: LoaderCircle,
	success: CircleCheck,
	warning: TriangleAlert,
};

function add(type: ToastType, input: ToastInput): ToastInstance {
	const options: ToastOptions =
		typeof input === "string" ? { description: input } : input;
	const id = manager.add({
		data: {
			actions: options.actions,
			closable: options.closable ?? true,
		},
		description: options.description,
		id: options.id,
		timeout: options.duration ?? (type === "loading" ? 0 : DURATION),
		title: options.title,
		type,
	});
	return {
		close: () => manager.close(id),
		id,
		update: (next) => manager.update(id, next),
	};
}

interface PromiseMessages<T> {
	error: ToastInput | ((error: unknown) => ToastInput);
	loading: ToastInput;
	success: ToastInput | ((value: T) => ToastInput);
}

/** 等待时挂一条 loading，完了换成成功或失败的那一条；原样交回 promise 的结果。 */
async function promise<T>(
	pending: Promise<T>,
	messages: PromiseMessages<T>,
): Promise<T> {
	const loading = add(
		"loading",
		typeof messages.loading === "string"
			? { closable: false, description: messages.loading }
			: { closable: false, ...messages.loading },
	);
	try {
		const value = await pending;
		loading.close();
		add(
			"success",
			typeof messages.success === "function"
				? messages.success(value)
				: messages.success,
		);
		return value;
	} catch (error) {
		loading.close();
		add(
			"error",
			typeof messages.error === "function"
				? messages.error(error)
				: messages.error,
		);
		throw error;
	}
}

export const toast = Object.assign(
	(input: ToastInput) => add("default", input),
	{
		/** 不给 id 时关掉所有通知。 */
		dismiss: (id?: string) => manager.close(id),
		error: (input: ToastInput) => add("error", input),
		info: (input: ToastInput) => add("info", input),
		loading: (input: ToastInput) => add("loading", input),
		promise,
		success: (input: ToastInput) => add("success", input),
		warning: (input: ToastInput) => add("warning", input),
	},
);

function CloseButton() {
	return (
		<BaseToast.Close aria-label="关闭" className="ui-toast-close">
			<X size={14} />
		</BaseToast.Close>
	);
}

function ToastItem({ item }: { item: BaseToast.Root.ToastObject<ToastData> }) {
	const type = (item.type ?? "default") as ToastType;
	const closable = item.data?.closable ?? true;
	const actions = item.data?.actions;
	return (
		<BaseToast.Root
			className="ui-toast"
			data-type={type}
			swipeDirection={["down", "right"]}
			toast={item}
		>
			<BaseToast.Content className="ui-toast-content">
				<div className="ui-toast-body">
					<span className="ui-toast-icon">
						<Icon icon={ICONS[type]} size={18} spin={type === "loading"} />
					</span>
					<div className="ui-toast-main">
						{item.title ? (
							<>
								<div className="ui-toast-title-row">
									<BaseToast.Title className="ui-toast-title">
										{item.title}
									</BaseToast.Title>
									{closable && <CloseButton />}
								</div>
								{item.description && (
									<BaseToast.Description className="ui-toast-description">
										{item.description}
									</BaseToast.Description>
								)}
							</>
						) : (
							item.description && (
								<div className="ui-toast-title-row">
									<BaseToast.Description
										className={cn(
											"ui-toast-description",
											"ui-toast-description-standalone",
										)}
									>
										{item.description}
									</BaseToast.Description>
									{closable && <CloseButton />}
								</div>
							)
						)}
						{actions && actions.length > 0 && (
							<div className="ui-toast-actions">
								{actions.map((action, index) => (
									<BaseToast.Action
										className={cn(
											"ui-toast-action",
											`ui-toast-action-${action.variant ?? "primary"}`,
										)}
										// biome-ignore lint/suspicious/noArrayIndexKey: 按钮的先后就是身份
										key={index}
										onClick={action.onClick}
									>
										{action.label}
									</BaseToast.Action>
								))}
							</div>
						)}
					</div>
				</div>
			</BaseToast.Content>
		</BaseToast.Root>
	);
}

function ToastList() {
	const { toasts } = BaseToast.useToastManager<ToastData>();
	return toasts.map((item) => <ToastItem item={item} key={item.id} />);
}

/** 通知的落点，整个应用挂一次。 */
export function Toaster() {
	return (
		<BaseToast.Provider limit={LIMIT} timeout={DURATION} toastManager={manager}>
			<BaseToast.Portal container={defaultPortalContainer()}>
				<BaseToast.Viewport className="ui-toast-viewport">
					<ToastList />
				</BaseToast.Viewport>
			</BaseToast.Portal>
		</BaseToast.Provider>
	);
}
