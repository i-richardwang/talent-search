"use client";

import { Field } from "@base-ui/react/field";
import { Form as BaseForm } from "@base-ui/react/form";
import {
	createContext,
	type ReactNode,
	use,
	useSyncExternalStore,
} from "react";
import { cn } from "#/lib/utils";

/*
 * 表单：Form 与 Field，样式在 form.css。字段挂在 `Form` 上（`Form.Field`）。
 *
 * - 外层样式用 `className`。
 * - 不传 `layout` 时，窄屏（`max-width: 575.98px` 的 `matchMedia`）上下排，宽屏左右排；
 *   服务端与首帧按宽屏渲染。
 */

type FormLayout = "horizontal" | "vertical";

const MOBILE = "(max-width: 575.98px)";

function subscribeMobile(onChange: () => void) {
	const query = window.matchMedia(MOBILE);
	query.addEventListener("change", onChange);
	return () => query.removeEventListener("change", onChange);
}

/** 窄屏：宽度不超过 575.98px。 */
function useMobile() {
	return useSyncExternalStore(
		subscribeMobile,
		() => window.matchMedia(MOBILE).matches,
		() => false,
	);
}

const FormLayoutContext = createContext<FormLayout>("horizontal");

interface FormProps
	extends Omit<BaseForm.Props, "render" | "className" | "style"> {
	className?: string;
	/** 字段之间的间距。 */
	gap?: number | string;
	layout?: FormLayout;
}

function FormRoot({ className, gap, layout, ...rest }: FormProps) {
	const mobile = useMobile();
	return (
		<FormLayoutContext value={layout || (mobile ? "vertical" : "horizontal")}>
			<BaseForm
				className={cn("ui-form", className)}
				style={{ gap }}
				{...rest}
			/>
		</FormLayoutContext>
	);
}

interface FormFieldProps
	extends Omit<Field.Root.Props, "render" | "children" | "className"> {
	children?: ReactNode;
	className?: string;
	/** label 下方的一行说明。 */
	desc?: ReactNode;
	label?: ReactNode;
}

function FormField({
	children,
	className,
	desc,
	label,
	...rest
}: FormFieldProps) {
	const layout = use(FormLayoutContext);
	return (
		<Field.Root
			className={cn(
				"ui-form-field",
				layout === "vertical"
					? "ui-form-field-vertical"
					: "ui-form-field-horizontal",
				className,
			)}
			{...rest}
		>
			<Field.Label className="ui-form-field-label">
				<span className="ui-form-field-title">{label}</span>
				{desc && <small className="ui-form-field-desc">{desc}</small>}
			</Field.Label>
			<div
				className={cn(
					"ui-form-field-control",
					layout === "vertical" && "ui-form-field-control-vertical",
				)}
			>
				{children}
				<Field.Error className="ui-form-field-error" />
			</div>
		</Field.Root>
	);
}

export const Form = Object.assign(FormRoot, { Field: FormField });
