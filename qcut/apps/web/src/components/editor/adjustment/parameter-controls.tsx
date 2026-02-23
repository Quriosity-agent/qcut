"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useAdjustmentStore } from "@/stores/ai/adjustment-store";
import { getImageEditModels } from "@/lib/ai-clients/image-edit-client";
import { getModelCapabilities } from "@/lib/ai-models/model-utils";
import { MultiImageUpload } from "./multi-image-upload";
import { RotateCcw } from "lucide-react";

export function ParameterControls() {
	const {
		selectedModel,
		parameters,
		prompt,
		multipleImages,
		updateParameter,
		resetParameters,
		setPrompt,
		setMultipleImages,
	} = useAdjustmentStore();

	const models = getImageEditModels();
	const currentModel = models.find((m) => m.id === selectedModel);

	if (!currentModel) return null;

	const modelParams = currentModel.parameters;

	return (
		<Card>
			<CardContent className="p-4 space-y-4">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<div className="w-2 h-2 bg-primary rounded-full" />
						<Label className="text-sm font-semibold">Parameters</Label>
					</div>
					<Button
						variant="outline"
						size="sm"
						onClick={resetParameters}
						className="h-6 px-2"
					>
						<RotateCcw className="size-3" />
					</Button>
				</div>

				{/* Prompt Input */}
				<div className="space-y-2">
					<Label className="text-xs">Edit Prompt</Label>
					<Textarea
						value={prompt}
						onChange={(e) => setPrompt(e.target.value)}
						placeholder="Describe the changes you want to make to the image..."
						className="text-xs min-h-[60px] resize-none"
					/>
					<p className="text-xs text-muted-foreground">
						Describe what you want to change or add to the image
					</p>
				</div>

				{/* Guidance Scale */}
				{modelParams.guidanceScale && (
					<div className="space-y-2">
						<div className="flex justify-between">
							<Label className="text-xs">Guidance Scale</Label>
							<span className="text-xs text-muted-foreground">
								{parameters.guidanceScale}
							</span>
						</div>
						<Slider
							value={[parameters.guidanceScale]}
							onValueChange={([value]) =>
								updateParameter("guidanceScale", value)
							}
							min={modelParams.guidanceScale.min}
							max={modelParams.guidanceScale.max}
							step={modelParams.guidanceScale.step}
							className="w-full"
						/>
						<p className="text-xs text-muted-foreground">
							Controls how closely the edit follows your prompt
						</p>
					</div>
				)}

				{/* Steps (for FLUX models) */}
				{modelParams.steps && (
					<div className="space-y-2">
						<div className="flex justify-between">
							<Label className="text-xs">Inference Steps</Label>
							<span className="text-xs text-muted-foreground">
								{parameters.steps}
							</span>
						</div>
						<Slider
							value={[parameters.steps]}
							onValueChange={([value]) => updateParameter("steps", value)}
							min={modelParams.steps.min}
							max={modelParams.steps.max}
							step={modelParams.steps.step}
							className="w-full"
						/>
						<p className="text-xs text-muted-foreground">
							More steps = higher quality, slower processing
						</p>
					</div>
				)}

				{/* Safety Tolerance (for FLUX models) */}
				{modelParams.safetyTolerance && (
					<div className="space-y-2">
						<div className="flex justify-between">
							<Label className="text-xs">Safety Tolerance</Label>
							<span className="text-xs text-muted-foreground">
								{parameters.safetyTolerance}
							</span>
						</div>
						<Slider
							value={[parameters.safetyTolerance]}
							onValueChange={([value]) =>
								updateParameter("safetyTolerance", value)
							}
							min={modelParams.safetyTolerance.min}
							max={modelParams.safetyTolerance.max}
							step={modelParams.safetyTolerance.step}
							className="w-full"
						/>
						<p className="text-xs text-muted-foreground">
							Content safety filtering level
						</p>
					</div>
				)}

				{/* Number of Images (for FLUX models) */}
				{modelParams.numImages && (
					<div className="space-y-2">
						<div className="flex justify-between">
							<Label className="text-xs">Number of Images</Label>
							<span className="text-xs text-muted-foreground">
								{parameters.numImages}
							</span>
						</div>
						<Slider
							value={[parameters.numImages]}
							onValueChange={([value]) => updateParameter("numImages", value)}
							min={modelParams.numImages.min}
							max={modelParams.numImages.max}
							step={modelParams.numImages.step}
							className="w-full"
						/>
						<p className="text-xs text-muted-foreground">
							Generate multiple variations
						</p>
					</div>
				)}

				{/* Seed */}
				{modelParams.seed && (
					<div className="space-y-2">
						<Label className="text-xs">Seed (Optional)</Label>
						<Input
							type="number"
							value={parameters.seed || ""}
							onChange={(e) =>
								updateParameter(
									"seed",
									e.target.value ? parseInt(e.target.value, 10) : undefined
								)
							}
							placeholder="Random"
							className="h-8 text-xs"
						/>
						<p className="text-xs text-muted-foreground">
							Use same seed for reproducible results
						</p>
					</div>
				)}

				{/* SeedDream V4 Specific Controls */}
				{selectedModel === "seeddream-v4" && (
					<>
						{/* Multi-Image Upload */}
						<MultiImageUpload
							images={multipleImages}
							maxImages={6}
							onImagesChange={setMultipleImages}
							label="Input Images (SeedDream V4)"
						/>

						{/* Image Size Selector */}
						<div className="space-y-2">
							<Label className="text-xs">Image Size</Label>
							<Select
								value={parameters.imageSize || "square_hd"}
								onValueChange={(size) => updateParameter("imageSize", size)}
							>
								<SelectTrigger className="h-8 text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="square_hd">
										Square HD (1536×1536)
									</SelectItem>
									<SelectItem value="square">Square (1024×1024)</SelectItem>
									<SelectItem value="portrait_3_4">Portrait 3:4</SelectItem>
									<SelectItem value="portrait_9_16">Portrait 9:16</SelectItem>
									<SelectItem value="landscape_4_3">Landscape 4:3</SelectItem>
									<SelectItem value="landscape_16_9">Landscape 16:9</SelectItem>
								</SelectContent>
							</Select>
							<p className="text-xs text-muted-foreground">
								Output image resolution and aspect ratio
							</p>
						</div>

						{/* Max Images */}
						<div className="space-y-2">
							<div className="flex justify-between">
								<Label className="text-xs">Max Input Images</Label>
								<span className="text-xs text-muted-foreground">
									{parameters.maxImages || 1}
								</span>
							</div>
							<Slider
								value={[parameters.maxImages || 1]}
								onValueChange={([value]) => updateParameter("maxImages", value)}
								min={1}
								max={6}
								step={1}
								className="w-full"
							/>
							<p className="text-xs text-muted-foreground">
								Maximum number of input images to process (1-6)
							</p>
						</div>

						{/* Safety Checker Switch */}
						<div className="flex items-center justify-between">
							<Label className="text-xs">Safety Checker</Label>
							<Switch
								checked={parameters.enableSafetyChecker !== false}
								onCheckedChange={(checked) =>
									updateParameter("enableSafetyChecker", checked)
								}
							/>
						</div>
						<p className="text-xs text-muted-foreground">
							Enable content safety filtering
						</p>

						{/* Sync Mode Switch */}
						<div className="flex items-center justify-between">
							<Label className="text-xs">Sync Mode</Label>
							<Switch
								checked={parameters.syncMode || false}
								onCheckedChange={(checked) =>
									updateParameter("syncMode", checked)
								}
							/>
						</div>
						<p className="text-xs text-muted-foreground">
							Use synchronous processing mode
						</p>
					</>
				)}

				{/* Nano Banana Specific Controls */}
				{selectedModel === "nano-banana" && (
					<>
						{/* Multi-Image Upload */}
						<MultiImageUpload
							images={multipleImages}
							maxImages={10}
							onImagesChange={setMultipleImages}
							label="Input Images (Nano Banana)"
						/>

						{/* Output Format Selector */}
						<div className="space-y-2">
							<Label className="text-xs">Output Format</Label>
							<Select
								value={parameters.outputFormat || "png"}
								onValueChange={(format) =>
									updateParameter("outputFormat", format)
								}
							>
								<SelectTrigger className="h-8 text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="png">PNG (Higher Quality)</SelectItem>
									<SelectItem value="jpeg">JPEG (Smaller Size)</SelectItem>
								</SelectContent>
							</Select>
							<p className="text-xs text-muted-foreground">
								Choose output image format
							</p>
						</div>

						{/* Sync Mode Switch */}
						<div className="flex items-center justify-between">
							<Label className="text-xs">Sync Mode</Label>
							<Switch
								checked={parameters.syncMode || false}
								onCheckedChange={(checked) =>
									updateParameter("syncMode", checked)
								}
							/>
						</div>
						<p className="text-xs text-muted-foreground">
							Return images as data URIs immediately
						</p>

						{/* Pricing Display */}
						<div className="space-y-1">
							<div className="text-xs text-muted-foreground">
								Cost: $0.039 per image
							</div>
							<div className="text-xs text-muted-foreground">
								Total: ${(0.039 * (parameters.numImages || 1)).toFixed(3)}
							</div>
						</div>
					</>
				)}

				{/* Gemini 3 Pro Edit Specific Controls */}
				{selectedModel === "gemini-3-pro-edit" && (
					<>
						{/* Multi-Image Upload */}
						<MultiImageUpload
							images={multipleImages}
							maxImages={4}
							onImagesChange={setMultipleImages}
							label="Input Images (Gemini 3 Pro)"
						/>

						{/* Resolution Selector */}
						<div className="space-y-2">
							<Label className="text-xs">Resolution</Label>
							<Select
								value={parameters.resolution || "1K"}
								onValueChange={(resolution) =>
									updateParameter("resolution", resolution)
								}
							>
								<SelectTrigger className="h-8 text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="1K">1K (1024px)</SelectItem>
									<SelectItem value="2K">2K (2048px)</SelectItem>
									<SelectItem value="4K">4K (4096px)</SelectItem>
								</SelectContent>
							</Select>
							<p className="text-xs text-muted-foreground">
								Output image resolution
							</p>
						</div>

						{/* Aspect Ratio Selector */}
						<div className="space-y-2">
							<Label className="text-xs">Aspect Ratio</Label>
							<Select
								value={parameters.aspectRatio || "auto"}
								onValueChange={(ratio) => updateParameter("aspectRatio", ratio)}
							>
								<SelectTrigger className="h-8 text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="auto">Auto (Match Input)</SelectItem>
									<SelectItem value="1:1">1:1 (Square)</SelectItem>
									<SelectItem value="4:3">4:3 (Standard)</SelectItem>
									<SelectItem value="3:4">3:4 (Portrait)</SelectItem>
									<SelectItem value="16:9">16:9 (Widescreen)</SelectItem>
									<SelectItem value="9:16">9:16 (Vertical)</SelectItem>
									<SelectItem value="21:9">21:9 (Ultrawide)</SelectItem>
									<SelectItem value="3:2">3:2 (Classic Photo)</SelectItem>
									<SelectItem value="2:3">2:3 (Portrait Photo)</SelectItem>
									<SelectItem value="5:4">5:4</SelectItem>
									<SelectItem value="4:5">4:5</SelectItem>
								</SelectContent>
							</Select>
							<p className="text-xs text-muted-foreground">
								Output aspect ratio
							</p>
						</div>

						{/* Output Format Selector */}
						<div className="space-y-2">
							<Label className="text-xs">Output Format</Label>
							<Select
								value={parameters.outputFormat || "png"}
								onValueChange={(format) =>
									updateParameter("outputFormat", format)
								}
							>
								<SelectTrigger className="h-8 text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="png">PNG (Higher Quality)</SelectItem>
									<SelectItem value="jpeg">JPEG (Smaller Size)</SelectItem>
									<SelectItem value="webp">WebP (Best Compression)</SelectItem>
								</SelectContent>
							</Select>
							<p className="text-xs text-muted-foreground">
								Choose output image format
							</p>
						</div>

						{/* Sync Mode Switch */}
						<div className="flex items-center justify-between">
							<Label className="text-xs">Sync Mode</Label>
							<Switch
								checked={parameters.syncMode || false}
								onCheckedChange={(checked) =>
									updateParameter("syncMode", checked)
								}
							/>
						</div>
						<p className="text-xs text-muted-foreground">
							Use synchronous processing mode
						</p>

						{/* Pricing Display */}
						<div className="space-y-1">
							<div className="text-xs text-muted-foreground">
								Cost: ~$0.15 per image
							</div>
						</div>
					</>
				)}

				{/* SeedDream V4.5 Specific Controls */}
				{selectedModel === "seeddream-v4-5-edit" && (
					<>
						{/* Multi-Image Upload */}
						<MultiImageUpload
							images={multipleImages}
							maxImages={10}
							onImagesChange={setMultipleImages}
							label="Input Images (SeedDream V4.5)"
						/>

						{/* Image Size Selector */}
						<div className="space-y-2">
							<Label className="text-xs">Image Size</Label>
							<Select
								value={parameters.imageSize || "auto_2K"}
								onValueChange={(size) => updateParameter("imageSize", size)}
							>
								<SelectTrigger className="h-8 text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="auto_2K">Auto 2K (Recommended)</SelectItem>
									<SelectItem value="auto_4K">
										Auto 4K (High Quality)
									</SelectItem>
									<SelectItem value="square_hd">
										Square HD (1536×1536)
									</SelectItem>
									<SelectItem value="square">Square (1024×1024)</SelectItem>
									<SelectItem value="portrait_4_3">Portrait 4:3</SelectItem>
									<SelectItem value="portrait_16_9">Portrait 16:9</SelectItem>
									<SelectItem value="landscape_4_3">Landscape 4:3</SelectItem>
									<SelectItem value="landscape_16_9">Landscape 16:9</SelectItem>
								</SelectContent>
							</Select>
							<p className="text-xs text-muted-foreground">
								Output image resolution and aspect ratio
							</p>
						</div>

						{/* Max Images */}
						<div className="space-y-2">
							<div className="flex justify-between">
								<Label className="text-xs">Max Input Images</Label>
								<span className="text-xs text-muted-foreground">
									{parameters.maxImages || 1}
								</span>
							</div>
							<Slider
								value={[parameters.maxImages || 1]}
								onValueChange={([value]) => updateParameter("maxImages", value)}
								min={1}
								max={10}
								step={1}
								className="w-full"
							/>
							<p className="text-xs text-muted-foreground">
								Maximum number of input images to process (1-10)
							</p>
						</div>

						{/* Safety Checker Switch */}
						<div className="flex items-center justify-between">
							<Label className="text-xs">Safety Checker</Label>
							<Switch
								checked={parameters.enableSafetyChecker !== false}
								onCheckedChange={(checked) =>
									updateParameter("enableSafetyChecker", checked)
								}
							/>
						</div>
						<p className="text-xs text-muted-foreground">
							Enable content safety filtering
						</p>

						{/* Sync Mode Switch */}
						<div className="flex items-center justify-between">
							<Label className="text-xs">Sync Mode</Label>
							<Switch
								checked={parameters.syncMode || false}
								onCheckedChange={(checked) =>
									updateParameter("syncMode", checked)
								}
							/>
						</div>
						<p className="text-xs text-muted-foreground">
							Use synchronous processing mode
						</p>

						{/* Pricing Display */}
						<div className="space-y-1">
							<div className="text-xs text-muted-foreground">
								Cost: $0.04-0.08 per image
							</div>
						</div>
					</>
				)}

				{/* GPT Image 1.5 Edit Specific Controls */}
				{selectedModel === "gpt-image-1-5-edit" && (
					<>
						{/* Multi-Image Upload */}
						<MultiImageUpload
							images={multipleImages}
							maxImages={4}
							onImagesChange={setMultipleImages}
							label="Input Images (GPT Image 1.5)"
						/>

						{/* Image Size Selector */}
						<div className="space-y-2">
							<Label className="text-xs">Image Size</Label>
							<Select
								value={parameters.imageSize || "auto"}
								onValueChange={(size) => updateParameter("imageSize", size)}
							>
								<SelectTrigger className="h-8 text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="auto">Auto (Match Input)</SelectItem>
									<SelectItem value="1024x1024">1024×1024 (Square)</SelectItem>
									<SelectItem value="1536x1024">
										1536×1024 (Landscape 3:2)
									</SelectItem>
									<SelectItem value="1024x1536">
										1024×1536 (Portrait 2:3)
									</SelectItem>
								</SelectContent>
							</Select>
							<p className="text-xs text-muted-foreground">
								Output image resolution
							</p>
						</div>

						{/* Background Selector */}
						<div className="space-y-2">
							<Label className="text-xs">Background</Label>
							<Select
								value={parameters.background || "auto"}
								onValueChange={(bg) => updateParameter("background", bg)}
							>
								<SelectTrigger className="h-8 text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="auto">Auto</SelectItem>
									<SelectItem value="transparent">
										Transparent (for compositing)
									</SelectItem>
									<SelectItem value="opaque">Opaque</SelectItem>
								</SelectContent>
							</Select>
							<p className="text-xs text-muted-foreground">
								Background type for output image
							</p>
						</div>

						{/* Quality Selector */}
						<div className="space-y-2">
							<Label className="text-xs">Quality</Label>
							<Select
								value={parameters.quality || "high"}
								onValueChange={(q) => updateParameter("quality", q)}
							>
								<SelectTrigger className="h-8 text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="low">Low (Faster)</SelectItem>
									<SelectItem value="medium">Medium</SelectItem>
									<SelectItem value="high">High (Best)</SelectItem>
								</SelectContent>
							</Select>
							<p className="text-xs text-muted-foreground">
								Output quality level
							</p>
						</div>

						{/* Input Fidelity Selector */}
						<div className="space-y-2">
							<Label className="text-xs">Input Fidelity</Label>
							<Select
								value={parameters.inputFidelity || "high"}
								onValueChange={(f) => updateParameter("inputFidelity", f)}
							>
								<SelectTrigger className="h-8 text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="low">Low (More Creative)</SelectItem>
									<SelectItem value="high">High (Preserve Input)</SelectItem>
								</SelectContent>
							</Select>
							<p className="text-xs text-muted-foreground">
								How closely to follow the input image
							</p>
						</div>

						{/* Output Format Selector */}
						<div className="space-y-2">
							<Label className="text-xs">Output Format</Label>
							<Select
								value={parameters.outputFormat || "png"}
								onValueChange={(format) =>
									updateParameter("outputFormat", format)
								}
							>
								<SelectTrigger className="h-8 text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="png">PNG (Higher Quality)</SelectItem>
									<SelectItem value="jpeg">JPEG (Smaller Size)</SelectItem>
									<SelectItem value="webp">WebP (Best Compression)</SelectItem>
								</SelectContent>
							</Select>
							<p className="text-xs text-muted-foreground">
								Choose output image format
							</p>
						</div>

						{/* Sync Mode Switch */}
						<div className="flex items-center justify-between">
							<Label className="text-xs">Sync Mode</Label>
							<Switch
								checked={parameters.syncMode || false}
								onCheckedChange={(checked) =>
									updateParameter("syncMode", checked)
								}
							/>
						</div>
						<p className="text-xs text-muted-foreground">
							Use synchronous processing mode
						</p>

						{/* Pricing Display */}
						<div className="space-y-1">
							<div className="text-xs text-muted-foreground">
								Cost: $0.04-0.08 per image
							</div>
						</div>
					</>
				)}
			</CardContent>
		</Card>
	);
}
