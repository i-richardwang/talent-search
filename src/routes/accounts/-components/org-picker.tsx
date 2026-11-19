import { ChevronDownIcon, ChevronRightIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Block } from "#/components/ui/block";
import { Checkbox } from "#/components/ui/checkbox";
import { Icon } from "#/components/ui/icon";
import { Input } from "#/components/ui/input";
import { ScrollArea } from "#/components/ui/scroll-area";
import { Skeleton } from "#/components/ui/skeleton";
import { ORG_SEPARATOR, type OrgNode, within } from "#/lib/org";

/** 找组织时最多列几个；再多就该多写几个字。 */
const FOUND_MAX = 50;

/** 选了哪些组织；改了交回整份。 */
type Choice = {
	value: readonly string[];
	onChange: (orgs: string[]) => void;
	disabled?: boolean;
};

/**
 * 选一个账号的数据范围：此刻的组织树，勾上一个组织就连同它下面的各级（下面的各级跟着勾上、
 * 不能单独取消）。上面的框按名字找，找到的列出完整路径。`tree` 为 null 时还在取，树的位置
 * 画占位。底下一行写选了几个组织、一共多少人。
 */
export function OrgPicker({
	tree,
	value,
	onChange,
	disabled = false,
}: Choice & { tree: OrgNode[] | null }) {
	const [q, setQ] = useState("");
	const people = value.reduce(
		(sum, org) => sum + (tree?.find((n) => n.path === org)?.people ?? 0),
		0,
	);
	return (
		<div className="flex flex-col gap-2">
			<Input
				aria-label="搜索组织"
				disabled={disabled || !tree}
				onChange={(event) => setQ(event.target.value)}
				placeholder="搜索组织"
				prefix={<Icon icon={SearchIcon} size={14} />}
				value={q}
			/>
			<Block variant="outlined">
				<ScrollArea className="max-h-64" scrollFade>
					<ul className="flex flex-col py-1">
						{tree ? (
							<OrgRows
								disabled={disabled}
								needle={q.trim().toLowerCase()}
								onChange={onChange}
								tree={tree}
								value={value}
							/>
						) : (
							[0, 1, 2].map((i) => (
								<li className="px-3 py-1.5" key={i}>
									<Skeleton height="1rem" width={`${60 - i * 12}%`} />
								</li>
							))
						)}
					</ul>
				</ScrollArea>
			</Block>
			<p className="text-fg-secondary text-xs">
				{value.length === 0
					? "至少选一个组织；选最上一级就是全部有部门的人"
					: `已选 ${value.length} 个组织，此刻共 ${people} 人`}
			</p>
		</div>
	);
}

const parentOf = (path: string) =>
	path.includes(ORG_SEPARATOR)
		? path.slice(0, path.lastIndexOf(ORG_SEPARATOR))
		: null;

/**
 * 树上的各行。没在找的时候按树排、默认展开最上一级；在找的时候平铺找到的组织，写完整路径。
 */
function OrgRows({
	tree,
	needle,
	value,
	onChange,
	disabled,
}: Choice & { tree: OrgNode[]; needle: string }) {
	const [open, setOpen] = useState<ReadonlySet<string>>(
		() => new Set(tree.filter((n) => n.depth === 0).map((n) => n.path)),
	);
	const hasChildren = new Set(tree.flatMap((n) => parentOf(n.path) ?? []));
	const shown = (n: OrgNode) => {
		for (let p = parentOf(n.path); p !== null; p = parentOf(p))
			if (!open.has(p)) return false;
		return true;
	};
	const found = needle
		? tree.filter((n) => n.name.toLowerCase().includes(needle))
		: null;
	const rows = found ? found.slice(0, FOUND_MAX) : tree.filter(shown);
	// 勾上一个组织，原先勾在它下面的就不用再单独列
	const toggle = (path: string, checked: boolean) =>
		onChange(
			checked
				? [...value.filter((org) => !within(org, path)), path]
				: value.filter((org) => org !== path),
		);

	if (rows.length === 0)
		return (
			<li className="px-3 py-1.5 text-fg-secondary text-sm">
				{found ? "没有这个名字的组织" : "人才库里还没有组织"}
			</li>
		);
	return (
		<>
			{rows.map((n) => {
				const covered = value.some(
					(org) => org !== n.path && within(n.path, org),
				);
				const expandable = !found && hasChildren.has(n.path);
				return (
					<li
						className="flex items-center gap-1 px-2 py-1"
						key={n.path}
						style={
							found
								? undefined
								: {
										paddingInlineStart: `calc(var(--spacing) * (2 + ${n.depth * 5}))`,
									}
						}
					>
						{!found && (
							<span className="flex w-6 shrink-0 justify-center">
								{expandable && (
									<ActionIcon
										icon={open.has(n.path) ? ChevronDownIcon : ChevronRightIcon}
										onClick={() => {
											const next = new Set(open);
											if (!next.delete(n.path)) next.add(n.path);
											setOpen(next);
										}}
										size="small"
										title={open.has(n.path) ? "收起" : "展开"}
									/>
								)}
							</span>
						)}
						<Checkbox
							checked={covered || value.includes(n.path)}
							className="min-w-0 flex-1"
							disabled={disabled || covered}
							onChange={(checked) => toggle(n.path, checked)}
						>
							<span className="flex min-w-0 flex-1 items-baseline gap-2">
								<span className="truncate">
									{found ? n.path.split(ORG_SEPARATOR).join(" / ") : n.name}
								</span>
								<span className="shrink-0 text-fg-secondary text-xs">
									{n.people} 人
								</span>
							</span>
						</Checkbox>
					</li>
				);
			})}
			{found && found.length > FOUND_MAX && (
				<li className="px-3 py-1.5 text-fg-secondary text-xs">
					还有 {found.length - FOUND_MAX} 个，多写几个字再找
				</li>
			)}
		</>
	);
}
