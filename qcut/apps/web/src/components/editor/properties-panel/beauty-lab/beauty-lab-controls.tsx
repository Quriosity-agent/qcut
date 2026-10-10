import { Loader2, ScanFace } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	applyPortraitAdjustments,
	applyWholeFrameBodyAdjustments,
	portraitScopeForDetectedFace,
	projectPortraitAdjustments,
	type PortraitEditScope,
} from "@/lib/portrait/portrait-face-scope";
import type {
	JianyingPortraitAdjustmentSection,
	JianyingPortraitAdjustmentStatus,
	JianyingPortraitDetectedFace,
} from "@/types/electron";
import type { MediaPortraitAdjustments } from "@/types/timeline";
import { BeautyLabPresets } from "./beauty-lab-presets";
import { PortraitAdjustmentSection } from "../portrait/portrait-adjustment-controls";
import { PortraitCollapsibleGroup } from "../portrait-collapsible-group";
import { PortraitMakeupControls } from "../portrait-makeup-controls";

export interface BeautyLabControlsProps {
	status: JianyingPortraitAdjustmentStatus | null;
	adjustments: MediaPortraitAdjustments;
	locale: string;
	disabled: boolean;
	faces: JianyingPortraitDetectedFace[];
	detecting: boolean;
	canDetect?: boolean;
	readOnly?: boolean;
	onChange: (value: MediaPortraitAdjustments) => void;
	onDetect: () => void;
}

const FACE_GROUPS = [
	{ section: "skin", zh: "皮肤管理", en: "Skin management" },
	{ section: "face-shape", zh: "脸型", en: "Face shape" },
	{ section: "features", zh: "五官精修", en: "Feature refinement" },
] as const;
const LAB_TABS = [
	{ value: "face", zh: "美颜", en: "Retouch" },
	{ value: "body", zh: "美体", en: "Body" },
	{ value: "face-presets", zh: "美颜预设", en: "Face presets" },
	{ value: "body-presets", zh: "美体预设", en: "Body presets" },
] as const;

function draftControlReady() {
	return true;
}

function draftInteraction() {}

export function BeautyLabControls({
	status,
	adjustments,
	locale,
	disabled,
	faces,
	detecting,
	canDetect = true,
	onChange,
	onDetect,
	readOnly = false,
}: BeautyLabControlsProps) {
	const isZh = locale.startsWith("zh");
	const portraitLocale = isZh ? "zh" : "en";
	const [activeTab, setActiveTab] = useState("face");
	const [selectedBindingId, setSelectedBindingId] = useState<string | null>(
		null
	);
	const [openGroups, setOpenGroups] = useState({
		skin: true,
		"face-shape": false,
		features: false,
		makeup: false,
		body: true,
	});
	const rootRef = useRef<HTMLDivElement>(null);
	const selectableFaces = faces.slice(0, 5);
	const selectedFace = selectableFaces.find(
		(face) => face.personBindingId === selectedBindingId
	);
	useEffect(() => {
		if (!selectedFace) setSelectedBindingId(null);
	}, [selectedFace]);
	const scope: PortraitEditScope = selectedFace
		? portraitScopeForDetectedFace({ face: selectedFace, frameNumber: 0 })
		: { mode: "all" };
	const scopedAdjustments = projectPortraitAdjustments({ adjustments, scope });
	const controlsDisabled = disabled || status === null;
	const commitFocusedControl = () => {
		// Radix changes tabs/targets on pointer-down before native input blur.
		const focused = rootRef.current?.ownerDocument.activeElement;
		if (
			focused instanceof HTMLInputElement &&
			rootRef.current?.contains(focused)
		) {
			focused.blur();
		}
	};
	const changeFace = (edited: MediaPortraitAdjustments) => {
		if (controlsDisabled || readOnly) return;
		onChange(applyPortraitAdjustments({ adjustments, scope, edited }));
	};
	const changeBody = (edited: MediaPortraitAdjustments) => {
		if (controlsDisabled || readOnly) return;
		onChange(applyWholeFrameBodyAdjustments({ edited }));
	};
	const sectionProps = ({
		section,
	}: {
		section: JianyingPortraitAdjustmentSection;
	}) => ({
		section,
		controls:
			status?.catalog.filter((control) => control.section === section) ?? [],
		adjustments: section === "body" ? adjustments : scopedAdjustments,
		disabled: controlsDisabled,
		readOnly,
		locale: portraitLocale,
		isControlReady: draftControlReady,
		skinTones: status?.skinTones,
		allowSkinTone: scope.mode === "all",
		onChange: section === "body" ? changeBody : changeFace,
		onInteractionStart: draftInteraction,
		onInteractionEnd: draftInteraction,
	});
	const sectionActive = ({
		section,
	}: {
		section: JianyingPortraitAdjustmentSection;
	}) => {
		const values =
			section === "body" ? adjustments.values : scopedAdjustments.values;
		return (
			status?.catalog.some(
				(control) =>
					control.section === section && (values[control.key] ?? 0) !== 0
			) ?? false
		);
	};
	const detectLabel = detecting
		? isZh
			? "识别中"
			: "Detecting faces"
		: isZh
			? "识别人脸"
			: "Detect faces";

	return (
		<div
			ref={rootRef}
			className="min-w-0 space-y-3 [letter-spacing:0]"
			data-testid="beauty-lab-controls"
		>
			<Tabs
				value={activeTab}
				onValueChange={(value) => {
					commitFocusedControl();
					setActiveTab(value);
				}}
				onKeyDown={(event) => event.stopPropagation()}
			>
				<TabsList
					className="grid h-10 w-full min-w-0 grid-cols-4 gap-0.5 rounded-sm p-0.5"
					aria-label={isZh ? "美颜实验室分组" : "Beauty Lab sections"}
				>
					{LAB_TABS.map((tab) => (
						<TabsTrigger
							key={tab.value}
							type="button"
							value={tab.value}
							className="h-9 min-w-0 whitespace-normal break-words px-1 text-[10px] leading-3"
						>
							{isZh ? tab.zh : tab.en}
						</TabsTrigger>
					))}
				</TabsList>
				{status === null ? (
					<p role="status" className="py-3 text-xs text-muted-foreground">
						{isZh ? "正在加载美颜控件" : "Loading portrait controls"}
					</p>
				) : null}
				{status !== null &&
				(activeTab === "face" || activeTab === "face-presets") ? (
					<div className="mt-3 flex min-w-0 items-center gap-1">
						<Select
							value={
								selectedFace ? `person-${selectedFace.personBindingId}` : "all"
							}
							disabled={disabled || detecting}
							onValueChange={(value) => {
								if (disabled || detecting) return;
								commitFocusedControl();
								const face = selectableFaces.find(
									(candidate) => `person-${candidate.personBindingId}` === value
								);
								if (value === "all" || face)
									setSelectedBindingId(face?.personBindingId ?? null);
							}}
						>
							<SelectTrigger
								className="h-8 min-w-0 flex-1 text-xs"
								aria-label={isZh ? "人脸选择" : "Face target"}
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent className="z-[1100]">
								<SelectItem value="all">
									{isZh ? "全部人脸" : "All faces"}
								</SelectItem>
								{selectableFaces.map((face, index) => (
									<SelectItem
										key={face.personBindingId}
										value={`person-${face.personBindingId}`}
									>
										{`${isZh ? "人脸" : "Face"} ${index + 1}`}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Button
							type="button"
							variant="text"
							size="icon"
							className="size-8 shrink-0"
							aria-label={detectLabel}
							title={detectLabel}
							disabled={controlsDisabled || readOnly || detecting || !canDetect}
							onClick={() => {
								if (!controlsDisabled && !readOnly && !detecting && canDetect)
									onDetect();
							}}
							onKeyDown={(event) => event.stopPropagation()}
						>
							{detecting ? (
								<Loader2 className="size-4 animate-spin" aria-hidden="true">
									<title>{detectLabel}</title>
								</Loader2>
							) : (
								<ScanFace className="size-4" aria-hidden="true">
									<title>{detectLabel}</title>
								</ScanFace>
							)}
						</Button>
					</div>
				) : null}
				<TabsContent value="face" className="mt-3 min-w-0">
					{status !== null ? (
						<div className="border-t border-border/70">
							{FACE_GROUPS.map((group) => (
								<PortraitCollapsibleGroup
									key={group.section}
									active={sectionActive({ section: group.section })}
									label={isZh ? group.zh : group.en}
									open={openGroups[group.section]}
									onOpenChange={(open) => {
										commitFocusedControl();
										setOpenGroups((current) => ({
											...current,
											[group.section]: open,
										}));
									}}
									testId={`beauty-lab-group-${group.section}`}
								>
									<PortraitAdjustmentSection
										key={selectedFace?.personBindingId ?? "all"}
										{...sectionProps({ section: group.section })}
									/>
								</PortraitCollapsibleGroup>
							))}
							<PortraitCollapsibleGroup
								active={Object.keys(scopedAdjustments.makeup ?? {}).length > 0}
								label={isZh ? "美妆" : "Makeup"}
								open={openGroups.makeup}
								onOpenChange={(open) => {
									commitFocusedControl();
									setOpenGroups((current) => ({ ...current, makeup: open }));
								}}
								testId="beauty-lab-group-makeup"
							>
								<PortraitMakeupControls
									key={selectedFace?.personBindingId ?? "all"}
									// ready here means selectable in the draft, not render availability.
									cards={status.makeupCards.map((card) => ({
										...card,
										ready: !disabled && !readOnly,
									}))}
									adjustments={scopedAdjustments}
									disabled={disabled}
									readOnly={readOnly}
									locale={portraitLocale}
									onChange={changeFace}
									onInteractionStart={draftInteraction}
									onInteractionEnd={draftInteraction}
								/>
							</PortraitCollapsibleGroup>
						</div>
					) : null}
				</TabsContent>
				<TabsContent value="body" className="mt-3 min-w-0">
					{status !== null ? (
						<>
							<p className="pb-2 text-[11px] text-muted-foreground">
								{isZh ? "全部人物" : "All people"}
							</p>
							<PortraitCollapsibleGroup
								active={sectionActive({ section: "body" })}
								label={isZh ? "智能美体" : "Smart body"}
								open={openGroups.body}
								onOpenChange={(open) => {
									commitFocusedControl();
									setOpenGroups((current) => ({ ...current, body: open }));
								}}
								testId="beauty-lab-group-body"
							>
								<PortraitAdjustmentSection
									{...sectionProps({ section: "body" })}
								/>
							</PortraitCollapsibleGroup>
						</>
					) : null}
				</TabsContent>
				{(["face", "body"] as const).map((presetScope) => (
					<TabsContent
						key={presetScope}
						value={`${presetScope}-presets`}
						className="mt-3 min-w-0"
					>
						<BeautyLabPresets
							scope={presetScope}
							adjustments={
								presetScope === "face" ? scopedAdjustments : adjustments
							}
							locale={portraitLocale}
							disabled={controlsDisabled || readOnly}
							onChange={presetScope === "face" ? changeFace : changeBody}
						/>
					</TabsContent>
				))}
			</Tabs>
		</div>
	);
}
