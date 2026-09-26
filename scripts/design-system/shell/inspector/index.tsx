import { ArrowDownToLine, PanelRightClose, RotateCcw } from "lucide-react";
import { type Ref, useState } from "react";
import { ActionIcon } from "#/components/ui/action-icon";
import { Button } from "#/components/ui/button";
import { Segmented } from "#/components/ui/segmented";
import { Skeleton } from "#/components/ui/skeleton";
import { Tabs } from "#/components/ui/tabs";
import { Tag } from "#/components/ui/tag";
import type { CatalogPage } from "../../shared/catalog";
import { tokenValue } from "../../shared/source";
import {
	changeCount,
	emptyDraft,
	resetTokens,
} from "../../shared/tokens/draft";
import {
	COMPONENT_TIERS,
	type ComponentSizing,
	componentLabel,
	type MotionScope,
	motionTokens,
	type NumericToken,
	numericTokens,
	SCOPE_LABEL,
	type SizeTier,
	type Theme,
	TIER_LABEL,
} from "../../shared/tokens/registry";
import { TokenChanges } from "../changes/token-changes";
import { pageColors } from "../impact";
import { useSourceFiles } from "../source-files";
import { PageColors, SelectedColor } from "./colors";
import { EasingFields } from "./easing-fields";
import type { Editing } from "./editing";
import { NumericFields } from "./numeric-fields";
import { Section } from "./section";

/** 右栏「文字」一节在字体页以外列出的字号；全部字阶在字体页。 */
const TYPE_KEYS = [
	"--text-xs",
	"--text-sm",
	"--text-base",
	"--text-base--line-height",
	"--text-xl",
];

export const INSPECTOR_ID = "design-system-inspector";

/**
 * 右栏：「设计」一栏按这一页在目录里写的事实列出能调的令牌，「修改」一栏是全部修改；
 * 底下是导出。右上角可以清空全部修改（能撤销），也可以收起右栏。
 */
export function Inspector({
	collapseRef,
	editing,
	onCollapse,
	onExport,
	onSelectColor,
	onSizeTier,
	page,
	selectedColor,
	sizeTier,
	theme,
}: {
	/** 收起按钮，外壳展开右栏后把焦点交给它。 */
	collapseRef: Ref<HTMLButtonElement>;
	editing: Editing;
	onCollapse: () => void;
	onExport: () => void;
	onSelectColor: (token: string) => void;
	onSizeTier: (tier: SizeTier) => void;
	page: CatalogPage;
	selectedColor: string;
	sizeTier: SizeTier;
	theme: Theme;
}) {
	const [tab, setTab] = useState("design");
	// 颜色页上从预览里点选了颜色，右栏回到「设计」，把这个颜色的编辑器露出来。
	const [shownColor, setShownColor] = useState(selectedColor);
	if (selectedColor !== shownColor) {
		setShownColor(selectedColor);
		if (page.colorPicker) setTab("design");
	}
	const count = changeCount(editing.draft);
	return (
		<aside
			aria-label="设计参数"
			className="flex w-72 shrink-0 flex-col border-border-secondary border-l bg-container max-xl:w-64 max-sm:w-full max-sm:border-t max-sm:border-l-0"
			id={INSPECTOR_ID}
		>
			<div className="flex min-h-12 items-center justify-between gap-2 border-border-secondary border-b px-4">
				<Tabs
					activeKey={tab}
					className="w-auto"
					items={[
						{ key: "design", label: "设计" },
						{
							key: "changes",
							label: (
								<span className="flex items-center gap-1.5">
									修改
									{count > 0 && (
										<Tag className="tabular-nums" size="small">
											{count}
										</Tag>
									)}
								</span>
							),
						},
					]}
					onChange={(key) => {
						setTab(key);
						editing.onPreview(null);
					}}
					size="small"
					variant="point"
				/>
				<div className="flex items-center gap-1">
					<ActionIcon
						disabled={count === 0}
						icon={RotateCcw}
						onClick={() => editing.onEdit(emptyDraft())}
						size="small"
						title="全部恢复原版值（可以撤销）"
					/>
					<ActionIcon
						aria-controls={INSPECTOR_ID}
						aria-expanded
						icon={PanelRightClose}
						onClick={onCollapse}
						ref={collapseRef}
						size="small"
						title="收起右侧栏"
					/>
				</div>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				{tab === "changes" ? (
					<div className="px-4">
						<TokenChanges draft={editing.draft} onEdit={editing.onEdit} />
					</div>
				) : page.colorPicker ? (
					<SelectedColor
						editing={editing}
						onSelectColor={onSelectColor}
						selectedColor={selectedColor}
						theme={theme}
					/>
				) : (
					<Design
						editing={editing}
						onSelectColor={onSelectColor}
						onSizeTier={onSizeTier}
						page={page}
						sizeTier={sizeTier}
						theme={theme}
					/>
				)}
			</div>
			<div className="border-border-secondary border-t px-4 py-3">
				<Button block icon={ArrowDownToLine} onClick={onExport}>
					导出 CSS
					{count > 0 && <span className="text-fg-tertiary">{count}</span>}
				</Button>
			</div>
		</aside>
	);
}

/** 「设计」一栏：页名，然后按目录里这一页的事实排出各节。 */
function Design({
	editing,
	onSelectColor,
	onSizeTier,
	page,
	sizeTier,
	theme,
}: {
	editing: Editing;
	onSelectColor: (token: string) => void;
	onSizeTier: (tier: SizeTier) => void;
	page: CatalogPage;
	sizeTier: SizeTier;
	theme: Theme;
}) {
	const files = useSourceFiles();
	const Icon = page.module.icon;
	const radius = numericTokens("radius");
	const type = page.tokenGroups?.includes("type")
		? numericTokens("type")
		: numericTokens("type").filter((token) => TYPE_KEYS.includes(token.key));
	return (
		<>
			<div className="flex flex-col gap-2 border-border-secondary border-b p-4">
				<div className="flex items-center gap-2">
					<Icon className="size-4 text-info" />
					<strong className="font-semibold text-sm">
						{page.name ?? page.title}
					</strong>
				</div>
				{page.name && (
					<span className="pl-6 text-fg-tertiary text-xs">{page.title}</span>
				)}
			</div>
			{page.sizing && (
				<SizingSection
					editing={editing}
					group={page.sizing}
					onSizeTier={onSizeTier}
					sizeTier={sizeTier}
				/>
			)}
			{page.tokenGroups?.includes("layout") && (
				<Section scope="全局" title="版心与栏高">
					<NumericFields editing={editing} tokens={numericTokens("layout")} />
				</Section>
			)}
			{page.motion && <MotionSection editing={editing} scope={page.motion} />}
			<Section scope="全局" title="圆角">
				<NumericFields editing={editing} tokens={radius} />
				<RadiusPreview editing={editing} tokens={radius} />
			</Section>
			<Section scope={`全局 · ${SCOPE_LABEL[theme]}`} title="颜色">
				{files ? (
					<PageColors
						colors={pageColors(page, files)}
						editing={editing}
						onSelectColor={onSelectColor}
						theme={theme}
					/>
				) : (
					<Skeleton.Text rows={4} />
				)}
			</Section>
			<Section scope="全局" title="文字">
				<NumericFields editing={editing} tokens={type} />
			</Section>
		</>
	);
}

/** 组件尺寸：先选调哪一档，下面是这一档的令牌和不分档的令牌。 */
function SizingSection({
	editing,
	group,
	onSizeTier,
	sizeTier,
}: {
	editing: Editing;
	group: ComponentSizing;
	onSizeTier: (tier: SizeTier) => void;
	sizeTier: SizeTier;
}) {
	const tokens = numericTokens(group);
	const keys = tokens.map((token) => token.key);
	return (
		<Section
			actions={
				<ActionIcon
					disabled={!keys.some((key) => key in editing.draft.shared)}
					icon={RotateCcw}
					onClick={() =>
						editing.onEdit(resetTokens(editing.draft, "shared", keys))
					}
					size="small"
					title={`${componentLabel(group)}尺寸全部恢复原版值`}
				/>
			}
			scope="组件"
			title="尺寸"
		>
			<Segmented<SizeTier>
				aria-label="调哪一档尺寸"
				block
				className="mb-3.5"
				onChange={onSizeTier}
				options={COMPONENT_TIERS[group].map((tier) => ({
					label: TIER_LABEL[tier],
					value: tier,
				}))}
				size="small"
				value={sizeTier}
			/>
			<NumericFields
				editing={editing}
				tokens={tokens.filter(
					(token) => !token.size || token.size === sizeTier,
				)}
			/>
		</Section>
	);
}

/** 进出场：这一页演示的弹层读的时长与缓动。 */
function MotionSection({
	editing,
	scope,
}: {
	editing: Editing;
	scope: MotionScope;
}) {
	const { durations, easings } = motionTokens(scope);
	return (
		<Section scope="全局" title="动效">
			<NumericFields editing={editing} tokens={durations} />
			<EasingFields editing={editing} tokens={easings} />
		</Section>
	);
}

/** 每个圆角令牌一个方框，圆角跟着预览中的值变。 */
function RadiusPreview({
	editing,
	tokens,
}: {
	editing: Editing;
	tokens: NumericToken[];
}) {
	return (
		<div aria-hidden="true" className="mt-3.5 flex justify-between px-1">
			{tokens.map((token) => (
				<span
					className="h-6 w-8 border border-fg-tertiary opacity-60"
					key={token.key}
					style={{
						borderRadius: tokenValue(editing.previewDraft, "shared", token.key),
					}}
					title={token.label}
				/>
			))}
		</div>
	);
}
