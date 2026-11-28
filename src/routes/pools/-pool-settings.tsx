import { useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { OrgPicker } from "#/components/org-picker";
import { Button } from "#/components/ui/button";
import { Collapsible, CollapsibleTrigger } from "#/components/ui/collapsible";
import { Input } from "#/components/ui/input";
import { Segmented } from "#/components/ui/segmented";
import { toast } from "#/components/ui/toast";
import type { OrgNode } from "#/lib/org";
import { changePool, poolOrganizations } from "#/server/talent-functions";
import type { PoolSummary } from "#/server/talent-pools";

export function PoolSettings({ selected }: { selected?: PoolSummary }) {
	const [opened, setOpened] = useState(false);
	const [mode, setMode] = useState<"edit" | "new">(selected ? "edit" : "new");
	return (
		<section>
			<CollapsibleTrigger
				open={opened}
				panelId="pool-settings"
				onOpenChange={setOpened}
			>
				管理人才池
			</CollapsibleTrigger>
			<Collapsible id="pool-settings" open={opened}>
				{selected && (
					<Segmented
						aria-label="管理方式"
						value={mode}
						onChange={setMode}
						options={[
							{ value: "edit", label: "调整所选池" },
							{ value: "new", label: "新建人才池" },
						]}
					/>
				)}
				<PoolForm
					key={mode}
					selected={mode === "edit" ? selected : undefined}
				/>
			</Collapsible>
		</section>
	);
}
function PoolForm({ selected }: { selected?: PoolSummary }) {
	const router = useRouter();
	const [visibility, setVisibility] = useState<"public" | "org">(
		selected?.org_path ? "org" : "public",
	);
	const [org, setOrg] = useState(selected?.org_path ?? "");
	const [tree, setTree] = useState<OrgNode[] | null>(null);
	const [saving, setSaving] = useState(false);
	useEffect(() => {
		if (visibility !== "org") return;
		let alive = true;
		poolOrganizations()
			.then((nodes) => {
				if (alive) setTree(nodes);
			})
			.catch((e) => {
				if (alive)
					toast.error(e instanceof Error ? e.message : "组织目录未加载");
			});
		return () => {
			alive = false;
		};
	}, [visibility]);
	return (
		<form
			className="grid gap-3 py-3"
			onSubmit={async (e) => {
				e.preventDefault();
				if (saving || (visibility === "org" && !org)) return;
				const name = String(new FormData(e.currentTarget).get("name"));
				setSaving(true);
				try {
					await changePool({
						data: {
							id: selected?.id,
							name,
							org: visibility === "org" ? org : null,
						},
					});
					await router.invalidate();
					toast.success("人才池已保存");
				} catch (e) {
					toast.error(e instanceof Error ? e.message : "人才池未保存");
				} finally {
					setSaving(false);
				}
			}}
		>
			{selected && (
				<span>
					{selected.creator} · 创建于 {selected.created}
				</span>
			)}
			<label htmlFor="pool-name">
				池名
				<Input
					id="pool-name"
					name="name"
					defaultValue={selected?.name ?? ""}
					required
				/>
			</label>
			<Segmented
				aria-label="可见范围"
				value={visibility}
				onChange={setVisibility}
				options={[
					{ value: "public", label: "所有登录账号" },
					{ value: "org", label: "按部门授权" },
				]}
			/>
			{visibility === "org" && (
				<OrgPicker
					single
					tree={tree}
					value={org ? [org] : []}
					onChange={(paths) => setOrg(paths[0] ?? "")}
				/>
			)}
			<Button
				htmlType="submit"
				loading={saving}
				disabled={visibility === "org" && !org}
			>
				保存人才池
			</Button>
		</form>
	);
}
