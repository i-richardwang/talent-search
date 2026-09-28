import type { ComponentType } from "react";
import type { PreviewPageId } from "../../shared/catalog";
import { AccordionPage } from "./components/accordion";
import { ActionIconPage } from "./components/action-icon";
import { AlertPage } from "./components/alert";
import { AppLayoutPage } from "./components/app-layout";
import { AutoCompletePage } from "./components/auto-complete";
import { AvatarPage } from "./components/avatar";
import { BlockPage } from "./components/block";
import { ButtonPage } from "./components/button";
import { ChatInputPage } from "./components/chat-input";
import { CheckboxPage } from "./components/checkbox";
import { ChoiceMenuPage } from "./components/choice-menu";
import { CodeBlockPage } from "./components/code-block";
import { CollapsePage } from "./components/collapse";
import { CollapsiblePage } from "./components/collapsible";
import { ContextMenuPage } from "./components/context-menu";
import { CopyButtonPage } from "./components/copy-button";
import { DescriptionsPage } from "./components/descriptions";
import { DividerPage } from "./components/divider";
import { DraggablePanelPage } from "./components/draggable-panel";
import { DrawerPage } from "./components/drawer";
import { DropdownMenuPage } from "./components/dropdown-menu";
import { EmptyPage } from "./components/empty";
import { FilterButtonPage } from "./components/filter-button";
import { FilterChipPage } from "./components/filter-chip";
import { FlexPage } from "./components/flex";
import { FormPage } from "./components/form";
import { GalleryPage } from "./components/gallery";
import { GroupBlockPage } from "./components/group-block";
import { HotkeyPage } from "./components/hotkey";
import { IconPage } from "./components/icon";
import { InputPage } from "./components/input";
import { ListPage } from "./components/list";
import { ModalPage } from "./components/modal";
import { NavItemPage } from "./components/nav-item";
import { NeuralLoadingPage } from "./components/neural-loading";
import { PopoverPage } from "./components/popover";
import { ProgressTagPage } from "./components/progress-tag";
import { RadioPage } from "./components/radio";
import { ScrollAreaPage } from "./components/scroll-area";
import { SearchBarPage } from "./components/search-bar";
import { SegmentedPage } from "./components/segmented";
import { SkeletonPage } from "./components/skeleton";
import { SuggestionChipsPage } from "./components/suggestion-chips";
import { TablePage } from "./components/table";
import { TabsPage } from "./components/tabs";
import { TagPage } from "./components/tag";
import { TextPage } from "./components/text";
import { TextLinkPage } from "./components/text-link";
import { ToastPage } from "./components/toast";
import { ToolbarPage } from "./components/toolbar";
import { TooltipPage } from "./components/tooltip";
import { ColorsPage } from "./foundations/colors";
import { IconsPage } from "./foundations/icons";
import { MotionPage } from "./foundations/motion";
import { RadiusPage } from "./foundations/radius";
import { ShadowsPage } from "./foundations/shadows";
import { SpacingPage } from "./foundations/spacing";
import { TypographyPage } from "./foundations/typography";
import { AdminLayoutPage } from "./layouts/admin";
import { DetailPage } from "./layouts/detail";
import { HomePage } from "./layouts/home";
import { WorkspacePage } from "./layouts/workspace";
import { ConditionsPage } from "./patterns/conditions";
import { PickingPage } from "./patterns/picking";
import { QueryInputPage } from "./patterns/query-input";
import { ReadingPage } from "./patterns/reading";
import { StatesPage } from "./patterns/states";
import { CareerBarPage } from "./product/career-bar";
import { EvidencePage } from "./product/evidence";
import { ResultListPage } from "./product/result-list";
import { StatusBadgePage } from "./product/status-badge";
import { ThreadPage } from "./product/thread";
import { TimelinePage } from "./product/timeline";

/** 预览页里每一页画什么。键是目录里的页，少一页或多一页都过不了类型检查。 */
export const PAGES: Record<PreviewPageId, ComponentType> = {
	"foundations/colors": ColorsPage,
	"foundations/typography": TypographyPage,
	"foundations/spacing": SpacingPage,
	"foundations/radius": RadiusPage,
	"foundations/shadows": ShadowsPage,
	"foundations/icons": IconsPage,
	"foundations/motion": MotionPage,
	"components/gallery": GalleryPage,
	"components/button": ButtonPage,
	"components/action-icon": ActionIconPage,
	"components/icon": IconPage,
	"components/text": TextPage,
	"components/tag": TagPage,
	"components/hotkey": HotkeyPage,
	"components/input": InputPage,
	"components/search-bar": SearchBarPage,
	"components/choice-menu": ChoiceMenuPage,
	"components/auto-complete": AutoCompletePage,
	"components/chat-input": ChatInputPage,
	"components/checkbox": CheckboxPage,
	"components/radio": RadioPage,
	"components/segmented": SegmentedPage,
	"components/tabs": TabsPage,
	"components/form": FormPage,
	"components/table": TablePage,
	"components/block": BlockPage,
	"components/flex": FlexPage,
	"components/app-layout": AppLayoutPage,
	"components/draggable-panel": DraggablePanelPage,
	"components/nav-item": NavItemPage,
	"components/divider": DividerPage,
	"components/text-link": TextLinkPage,
	"components/descriptions": DescriptionsPage,
	"components/list": ListPage,
	"components/group-block": GroupBlockPage,
	"components/avatar": AvatarPage,
	"components/scroll-area": ScrollAreaPage,
	"components/toolbar": ToolbarPage,
	"components/collapsible": CollapsiblePage,
	"components/accordion": AccordionPage,
	"components/collapse": CollapsePage,
	"components/empty": EmptyPage,
	"components/skeleton": SkeletonPage,
	"components/neural-loading": NeuralLoadingPage,
	"components/alert": AlertPage,
	"components/code-block": CodeBlockPage,
	"components/copy-button": CopyButtonPage,
	"components/filter-chip": FilterChipPage,
	"components/filter-button": FilterButtonPage,
	"components/progress-tag": ProgressTagPage,
	"components/suggestion-chips": SuggestionChipsPage,
	"components/tooltip": TooltipPage,
	"components/popover": PopoverPage,
	"components/toast": ToastPage,
	"components/dropdown-menu": DropdownMenuPage,
	"components/context-menu": ContextMenuPage,
	"components/modal": ModalPage,
	"components/drawer": DrawerPage,
	"patterns/query-input": QueryInputPage,
	"patterns/conditions": ConditionsPage,
	"patterns/picking": PickingPage,
	"patterns/reading": ReadingPage,
	"patterns/states": StatesPage,
	"product/evidence": EvidencePage,
	"product/career-bar": CareerBarPage,
	"product/timeline": TimelinePage,
	"product/result-list": ResultListPage,
	"product/thread": ThreadPage,
	"product/status-badge": StatusBadgePage,
	"layouts/home": HomePage,
	"layouts/workspace": WorkspacePage,
	"layouts/detail": DetailPage,
	"layouts/admin": AdminLayoutPage,
};
