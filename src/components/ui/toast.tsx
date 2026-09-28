"use client";

import { Toast as BaseToast } from "@base-ui/react/toast";
import {
	CircleCheck,
	CircleX,
	type LucideIcon,
	TriangleAlert,
	X,
} from "lucide-react";
import type { ReactNode } from "react";
import { defaultPortalContainer } from "#/components/ui/floating";
import { Icon } from "#/components/ui/icon";
import { cn } from "#/lib/utils";

/*
 * `<Toaster />` 在根上挂一次，别处调 `toast.success(...)` 这一组函数，不需要 React 上下文。
 * Base UI 的 toast 管理器只是一个广播：`<Toaster />` 挂上之后调用才有人接。
 */

type ToastType = "success" | "warning" | "error";

interface ToastAction {
	label: ReactNode;
	onClick?: () => void;
}

interface ToastOptions {
	actions?: ToastAction[];
	/** 只给一句字符串时那句就是正文，用正文色。 */
	description?: ReactNode;
	/** 同一个 id 的通知只有一条，再调是原地更新并重新计时。 */
	id?: string;
	title?: ReactNode;
}

interface ToastData {
	actions?: ToastAction[];
}

type ToastInput = ToastOptions | string;

const DURATION = 5000;
const LIMIT = 5;

const manager = BaseToast.createToastManager<ToastData>();

const ICONS: Record<ToastType, LucideIcon> = {
	error: CircleX,
	success: CircleCheck,
	warning: TriangleAlert,
};

function add(type: ToastType, input: ToastInput) {
	const options: ToastOptions =
		typeof input === "string" ? { description: input } : input;
	manager.add({
		data: { actions: options.actions },
		description: options.description,
		id: options.id,
		title: options.title,
		type,
	});
}

export const toast = {
	error: (input: ToastInput) => add("error", input),
	success: (input: ToastInput) => add("success", input),
	warning: (input: ToastInput) => add("warning", input),
};

function CloseButton() {
	return (
		<BaseToast.Close aria-label="关闭" className="ui-toast-close">
			<X size={14} />
		</BaseToast.Close>
	);
}

function ToastItem({ item }: { item: BaseToast.Root.ToastObject<ToastData> }) {
	const type = item.type as ToastType;
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
						<Icon icon={ICONS[type]} size={18} />
					</span>
					<div className="ui-toast-main">
						{item.title ? (
							<>
								<div className="ui-toast-title-row">
									<BaseToast.Title className="ui-toast-title">
										{item.title}
									</BaseToast.Title>
									<CloseButton />
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
									<CloseButton />
								</div>
							)
						)}
						{actions && actions.length > 0 && (
							<div className="ui-toast-actions">
								{actions.map((action, index) => (
									<BaseToast.Action
										className="ui-toast-action"
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
