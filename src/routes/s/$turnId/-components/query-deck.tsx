import { AlertCircleIcon, PencilIcon, RotateCwIcon } from "lucide-react";
import { useImperativeHandle, useState } from "react";
import { QueryBar } from "#/components/query-bar";
import { Alert, AlertDescription } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { Separator } from "#/components/ui/separator";
import { cn } from "#/lib/utils";
import { hasMeaning, type QueryInput, type SearchSpec } from "#/search/spec";
import { QueryChips } from "./query-chips";

export type QueryDeckHandle = { edit: () => void };

export function QueryDeck({
	spec,
	onChangeSpec,
	onQuery,
	ref,
	interpreting,
	rawText,
	error,
	onRetry,
}: {
	spec: SearchSpec;
	onChangeSpec: (next: SearchSpec) => void;
	onQuery: (input: QueryInput) => boolean | Promise<boolean>;
	ref: React.Ref<QueryDeckHandle>;
	interpreting: boolean;
	rawText: string | null;
	error: string | null;
	onRetry?: () => void;
}) {
	const settled = hasMeaning(spec) && !interpreting;
	const reading = spec.conditions.length > 0;
	const [editing, setEditing] = useState(false);

	useImperativeHandle(ref, () => ({ edit: () => setEditing(true) }));

	return (
		<header className="sticky top-(--header-height) z-stick min-h-(--deck-height) bg-canvas/80 backdrop-blur-sm before:absolute before:inset-x-0 before:bottom-0 before:h-px before:bg-border/64 lg:h-(--deck-height)">
			{!editing && (
				<div className="app-column flex h-full flex-wrap items-center gap-x-2 gap-y-1.5 py-1.5 lg:flex-nowrap lg:overflow-hidden lg:py-0">
					{rawText && (
						<>
							<h1
								className="min-w-0 truncate font-medium text-sm"
								title={rawText}
							>
								{rawText}
							</h1>
							{interpreting ? (
								<span
									className="shrink-0 text-muted-foreground text-xs"
									role="status"
								>
									正在整理条件…
								</span>
							) : (
								<Button
									aria-label="改写这句话"
									className="shrink-0"
									onClick={() => setEditing(true)}
									size="icon-xs"
									variant="ghost"
								>
									<PencilIcon />
								</Button>
							)}
						</>
					)}
					{rawText && settled && reading && (
						<Separator className="h-4 max-lg:hidden" orientation="vertical" />
					)}

					{settled && (
						<div className="flex shrink-0 items-center gap-1.5 max-lg:flex-wrap">
							<QueryChips
								conditions={spec.conditions}
								onChange={(conditions) => onChangeSpec({ conditions })}
							/>
						</div>
					)}
				</div>
			)}

			{editing ? (
				<DeckSheet className="top-0">
					<QueryBar
						initial={rawText ?? ""}
						onCancel={() => setEditing(false)}
						onQuery={onQuery}
					/>
					{error && <Failure error={error} onRetry={onRetry} />}
				</DeckSheet>
			) : (
				error && (
					<DeckSheet className="top-full">
						<Failure error={error} onRetry={onRetry} />
					</DeckSheet>
				)
			)}
		</header>
	);
}

function DeckSheet({
	className,
	children,
}: {
	className: string;
	children: React.ReactNode;
}) {
	return (
		<div
			className={cn(
				"absolute inset-x-0 bg-canvas pt-2 pb-3",
				"before:absolute before:inset-x-0 before:bottom-0 before:h-px before:bg-border/64",
				className,
			)}
		>
			<div className="app-column">
				<div className="flex max-w-page flex-col gap-2">{children}</div>
			</div>
		</div>
	);
}

function Failure({ error, onRetry }: { error: string; onRetry?: () => void }) {
	return (
		<Alert variant="error">
			<AlertCircleIcon />
			<AlertDescription className="flex items-baseline gap-2">
				<span className="min-w-0 flex-1">{error}</span>
				{onRetry && (
					<Button
						className="shrink-0"
						onClick={onRetry}
						size="xs"
						variant="link"
					>
						<RotateCwIcon />
						重试
					</Button>
				)}
			</AlertDescription>
		</Alert>
	);
}
