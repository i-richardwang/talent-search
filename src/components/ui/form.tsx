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
 * 表单与字段（`Form.Field`）。窄屏上下排、宽屏左右排；服务端与首帧按宽屏渲染。
 * 窄屏断点和 form.css 的同一个。
 */

type FormLayout = "horizontal" | "vertical";

const MOBILE = "(width < 36rem)";

function subscribeMobile(onChange: () => void) {
	const query = window.matchMedia(MOBILE);
	query.addEventListener("change", onChange);
	return () => query.removeEventListener("change", onChange);
}

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
}

function FormRoot({ className, ...rest }: FormProps) {
	const mobile = useMobile();
	return (
		<FormLayoutContext value={mobile ? "vertical" : "horizontal"}>
			<BaseForm className={cn("ui-form", className)} {...rest} />
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
