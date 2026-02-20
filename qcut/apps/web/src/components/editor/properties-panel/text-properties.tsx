import { Textarea } from "@/components/ui/textarea";
import { FontPicker } from "@/components/ui/font-picker";
import { FontFamily } from "@/constants/font-constants";
import { TextElement } from "@/types/timeline";
import { useTimelineStore } from "@/stores/timeline-store";
import { useEditorStore } from "@/stores/editor-store";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import {
	PropertyItem,
	PropertyItemLabel,
	PropertyItemValue,
	PropertyGroup,
} from "./property-item";

export function TextProperties({
	element,
	trackId,
}: {
	element: TextElement;
	trackId: string;
}) {
	const { updateTextElement } = useTimelineStore();
	const { canvasSize } = useEditorStore();

	// Local state for input values to allow temporary empty/invalid states
	const [fontSizeInput, setFontSizeInput] = useState(
		element.fontSize.toString()
	);
	const [opacityInput, setOpacityInput] = useState(
		Math.round(element.opacity * 100).toString()
	);
	const [xInput, setXInput] = useState((element.x || 0).toString());
	const [yInput, setYInput] = useState((element.y || 0).toString());
	const [rotationInput, setRotationInput] = useState(
		(element.rotation || 0).toString()
	);

	// Sync inputs when element changes externally (e.g., by dragging or other external updates)
	useEffect(() => {
		setFontSizeInput(element.fontSize.toString());
		setOpacityInput(Math.round(element.opacity * 100).toString());
		setXInput((element.x ?? 0).toString());
		setYInput((element.y ?? 0).toString());
		setRotationInput((element.rotation ?? 0).toString());
	}, [
		element.fontSize,
		element.opacity,
		element.x,
		element.y,
		element.rotation,
	]);

	// Generic handler for slider changes to reduce code duplication
	const handleSliderChange = (prop: "x" | "y" | "rotation", value: number) => {
		const setter = {
			x: setXInput,
			y: setYInput,
			rotation: setRotationInput,
		}[prop];
		updateTextElement(trackId, element.id, { [prop]: value });
		setter(value.toString());
	};

	// Generic validation function that handles both integers and floats
	const parseAndValidateValue = (
		value: string,
		min: number,
		max: number,
		fallback: number,
		isInteger = false
	): number => {
		const parsed = isInteger ? parseInt(value, 10) : parseFloat(value);
		if (isNaN(parsed)) return fallback;
		return Math.max(min, Math.min(max, parsed));
	};

	const handleFontSizeChange = (value: string) => {
		setFontSizeInput(value);

		if (value.trim() !== "") {
			const fontSize = parseAndValidateValue(
				value,
				8,
				300,
				element.fontSize,
				true
			);
			updateTextElement(trackId, element.id, { fontSize });
		}
	};

	const handleFontSizeBlur = () => {
		const fontSize = parseAndValidateValue(
			fontSizeInput,
			8,
			300,
			element.fontSize,
			true
		);
		setFontSizeInput(fontSize.toString());
		updateTextElement(trackId, element.id, { fontSize });
	};

	const handleOpacityChange = (value: string) => {
		setOpacityInput(value);

		if (value.trim() !== "") {
			const opacityPercent = parseAndValidateValue(
				value,
				0,
				100,
				Math.round(element.opacity * 100),
				true
			);
			updateTextElement(trackId, element.id, { opacity: opacityPercent / 100 });
		}
	};

	const handleOpacityBlur = () => {
		const opacityPercent = parseAndValidateValue(
			opacityInput,
			0,
			100,
			Math.round(element.opacity * 100),
			true
		);
		setOpacityInput(opacityPercent.toString());
		updateTextElement(trackId, element.id, { opacity: opacityPercent / 100 });
	};

	// Generic handlers for position and rotation properties
	type PositionProp = "x" | "y" | "rotation";

	const getPropertyConfig = (prop: PositionProp) => {
		const configs = {
			x: {
				input: xInput,
				setter: setXInput,
				min: -canvasSize.width / 2,
				max: canvasSize.width / 2,
				fallback: element.x || 0,
			},
			y: {
				input: yInput,
				setter: setYInput,
				min: -canvasSize.height / 2,
				max: canvasSize.height / 2,
				fallback: element.y || 0,
			},
			rotation: {
				input: rotationInput,
				setter: setRotationInput,
				min: -180,
				max: 180,
				fallback: element.rotation || 0,
			},
		};
		return configs[prop];
	};

	const handlePropertyChange = (prop: PositionProp, value: string) => {
		const config = getPropertyConfig(prop);
		config.setter(value);

		if (value.trim() !== "") {
			const validatedValue = parseAndValidateValue(
				value,
				config.min,
				config.max,
				config.fallback,
				false
			);
			updateTextElement(trackId, element.id, { [prop]: validatedValue });
		}
	};

	const handlePropertyBlur = (prop: PositionProp) => {
		const config = getPropertyConfig(prop);
		const validatedValue = parseAndValidateValue(
			config.input,
			config.min,
			config.max,
			config.fallback,
			false
		);
		config.setter(validatedValue.toString());
		updateTextElement(trackId, element.id, { [prop]: validatedValue });
	};

	// Create specific handlers using the generic functions
	const handleXChange = (value: string) => handlePropertyChange("x", value);
	const handleXBlur = () => handlePropertyBlur("x");
	const handleYChange = (value: string) => handlePropertyChange("y", value);
	const handleYBlur = () => handlePropertyBlur("y");
	const handleRotationChange = (value: string) =>
		handlePropertyChange("rotation", value);
	const handleRotationBlur = () => handlePropertyBlur("rotation");

	return (
		<div className="space-y-6 p-5">
			<Textarea
				placeholder="Name"
				defaultValue={element.content}
				className="min-h-18 resize-none bg-background/50"
				onChange={(e) =>
					updateTextElement(trackId, element.id, { content: e.target.value })
				}
			/>

			<PropertyGroup title="Font" defaultExpanded={true}>
				<PropertyItem direction="row">
					<PropertyItemLabel>Font</PropertyItemLabel>
					<PropertyItemValue>
						<FontPicker
							aria-label="Font family"
							defaultValue={element.fontFamily}
							onValueChange={(value: FontFamily) =>
								updateTextElement(trackId, element.id, { fontFamily: value })
							}
						/>
					</PropertyItemValue>
				</PropertyItem>
				<PropertyItem direction="column">
					<PropertyItem direction="row">
						<PropertyItemLabel>Style</PropertyItemLabel>
						<PropertyItemValue>
							<div className="flex items-center gap-2">
								<Button
									type="button"
									aria-pressed={element.fontWeight === "bold"}
									variant={
										element.fontWeight === "bold" ? "default" : "outline"
									}
									size="sm"
									onClick={() =>
										updateTextElement(trackId, element.id, {
											fontWeight:
												element.fontWeight === "bold" ? "normal" : "bold",
										})
									}
									className="h-8 px-3 font-bold"
								>
									B
								</Button>
								<Button
									type="button"
									aria-pressed={element.fontStyle === "italic"}
									variant={
										element.fontStyle === "italic" ? "default" : "outline"
									}
									size="sm"
									onClick={() =>
										updateTextElement(trackId, element.id, {
											fontStyle:
												element.fontStyle === "italic" ? "normal" : "italic",
										})
									}
									className="h-8 px-3 italic"
								>
									I
								</Button>
								<Button
									type="button"
									aria-pressed={element.textDecoration === "underline"}
									variant={
										element.textDecoration === "underline"
											? "default"
											: "outline"
									}
									size="sm"
									onClick={() =>
										updateTextElement(trackId, element.id, {
											textDecoration:
												element.textDecoration === "underline"
													? "none"
													: "underline",
										})
									}
									className="h-8 px-3 underline"
								>
									U
								</Button>
								<Button
									type="button"
									aria-pressed={element.textDecoration === "line-through"}
									variant={
										element.textDecoration === "line-through"
											? "default"
											: "outline"
									}
									size="sm"
									onClick={() =>
										updateTextElement(trackId, element.id, {
											textDecoration:
												element.textDecoration === "line-through"
													? "none"
													: "line-through",
										})
									}
									className="h-8 px-3 line-through"
								>
									S
								</Button>
							</div>
						</PropertyItemValue>
					</PropertyItem>
					<PropertyItemLabel>Font size</PropertyItemLabel>
					<PropertyItemValue>
						<div className="flex items-center gap-2">
							<Slider
								aria-label="Font size"
								value={[element.fontSize]}
								min={8}
								max={300}
								step={1}
								onValueChange={([value]) => {
									updateTextElement(trackId, element.id, { fontSize: value });
									setFontSizeInput(value.toString());
								}}
								className="w-full"
							/>
							<Input
								type="number"
								aria-label="Font size (number)"
								value={fontSizeInput}
								min={8}
								max={300}
								onChange={(e) => handleFontSizeChange(e.target.value)}
								onBlur={handleFontSizeBlur}
								className="w-12 !text-xs h-7 rounded-sm text-center
                 [appearance:textfield]
                 [&::-webkit-outer-spin-button]:appearance-none
                 [&::-webkit-inner-spin-button]:appearance-none"
							/>
						</div>
					</PropertyItemValue>
				</PropertyItem>
			</PropertyGroup>

			<PropertyGroup title="Appearance" defaultExpanded={true}>
				<PropertyItem direction="row">
					<PropertyItemLabel>Color</PropertyItemLabel>
					<PropertyItemValue>
						<Input
							type="color"
							aria-label="Text color"
							value={element.color || "#ffffff"}
							onChange={(e) => {
								const color = e.target.value;
								updateTextElement(trackId, element.id, { color });
							}}
							className="w-full cursor-pointer rounded-full"
						/>
					</PropertyItemValue>
				</PropertyItem>
				<PropertyItem direction="row">
					<PropertyItemLabel>Background</PropertyItemLabel>
					<PropertyItemValue>
						<Input
							type="color"
							aria-label="Background color"
							value={
								element.backgroundColor === "transparent"
									? "#000000"
									: element.backgroundColor || "#000000"
							}
							onChange={(e) => {
								const backgroundColor = e.target.value;
								updateTextElement(trackId, element.id, { backgroundColor });
							}}
							className="w-full cursor-pointer rounded-full"
						/>
					</PropertyItemValue>
				</PropertyItem>
				<PropertyItem direction="column">
					<PropertyItemLabel>Opacity</PropertyItemLabel>
					<PropertyItemValue>
						<div className="flex items-center gap-2">
							<Slider
								aria-label="Opacity"
								value={[element.opacity * 100]}
								min={0}
								max={100}
								step={1}
								onValueChange={([value]) => {
									updateTextElement(trackId, element.id, {
										opacity: value / 100,
									});
									setOpacityInput(value.toString());
								}}
								className="w-full"
							/>
							<Input
								type="number"
								aria-label="Opacity percent"
								value={opacityInput}
								min={0}
								max={100}
								onChange={(e) => handleOpacityChange(e.target.value)}
								onBlur={handleOpacityBlur}
								className="w-12 !text-xs h-7 rounded-sm text-center
                 [appearance:textfield]
                 [&::-webkit-outer-spin-button]:appearance-none
                 [&::-webkit-inner-spin-button]:appearance-none"
							/>
						</div>
					</PropertyItemValue>
				</PropertyItem>
			</PropertyGroup>

			<PropertyGroup title="Position" defaultExpanded={true}>
				<PropertyItem direction="column">
					<PropertyItemLabel>X Position</PropertyItemLabel>
					<PropertyItemValue>
						<div className="flex items-center gap-2">
							<Slider
								aria-label="X Position"
								value={[element.x || 0]}
								min={-canvasSize.width / 2}
								max={canvasSize.width / 2}
								step={1}
								onValueChange={([value]) => handleSliderChange("x", value)}
								className="w-full"
							/>
							<Input
								type="number"
								aria-label="X Position (number)"
								value={xInput}
								onChange={(e) => handleXChange(e.target.value)}
								onBlur={handleXBlur}
								className="w-12 !text-xs h-7 rounded-sm text-center
                 [appearance:textfield]
                 [&::-webkit-outer-spin-button]:appearance-none
                 [&::-webkit-inner-spin-button]:appearance-none"
							/>
						</div>
					</PropertyItemValue>
				</PropertyItem>
				<PropertyItem direction="column">
					<PropertyItemLabel>Y Position</PropertyItemLabel>
					<PropertyItemValue>
						<div className="flex items-center gap-2">
							<Slider
								aria-label="Y Position"
								value={[element.y || 0]}
								min={-canvasSize.height / 2}
								max={canvasSize.height / 2}
								step={1}
								onValueChange={([value]) => handleSliderChange("y", value)}
								className="w-full"
							/>
							<Input
								type="number"
								aria-label="Y Position (number)"
								value={yInput}
								onChange={(e) => handleYChange(e.target.value)}
								onBlur={handleYBlur}
								className="w-12 !text-xs h-7 rounded-sm text-center
                 [appearance:textfield]
                 [&::-webkit-outer-spin-button]:appearance-none
                 [&::-webkit-inner-spin-button]:appearance-none"
							/>
						</div>
					</PropertyItemValue>
				</PropertyItem>
			</PropertyGroup>

			<PropertyGroup title="Transform" defaultExpanded={true}>
				<PropertyItem direction="column">
					<PropertyItemLabel>Rotation</PropertyItemLabel>
					<PropertyItemValue>
						<div className="flex items-center gap-2">
							<Slider
								aria-label="Rotation"
								value={[element.rotation || 0]}
								min={-180}
								max={180}
								step={1}
								onValueChange={([value]) =>
									handleSliderChange("rotation", value)
								}
								className="w-full"
							/>
							<Input
								type="number"
								aria-label="Rotation (degrees)"
								value={rotationInput}
								onChange={(e) => handleRotationChange(e.target.value)}
								onBlur={handleRotationBlur}
								className="w-12 !text-xs h-7 rounded-sm text-center
                 [appearance:textfield]
                 [&::-webkit-outer-spin-button]:appearance-none
                 [&::-webkit-inner-spin-button]:appearance-none"
							/>
							<span className="text-xs text-muted-foreground">°</span>
						</div>
					</PropertyItemValue>
				</PropertyItem>
			</PropertyGroup>
		</div>
	);
}
