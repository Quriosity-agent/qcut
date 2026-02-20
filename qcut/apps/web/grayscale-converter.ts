/**
 * RGB to Grayscale Converter
 * Based on the conversion logic from debug-effects-store.test.ts
 */

interface GrayscaleTestResult {
	original: string;
	grayscale: string;
	expectedValues: {
		red: number;
		blue: number;
		green: number;
		yellow: number;
	};
	actualValues: {
		red: number;
		blue: number;
		green: number;
		yellow: number;
	};
}

declare global {
	interface Window {
		createRGBTestImage?: () => HTMLCanvasElement;
		convertToGrayscale?: (imageData: ImageData) => ImageData;
		simulateFFmpegHueFilter?: (imageData: ImageData) => ImageData;
		testGrayscaleConversion?: () => GrayscaleTestResult;
	}
}

// Create a canvas with RGB test pattern (like in the test)
function createRGBTestImage(): HTMLCanvasElement {
	const canvas = document.createElement("canvas");
	canvas.width = 100;
	canvas.height = 100;
	const ctx = canvas.getContext("2d")!;

	// Create colored quadrants like in the test
	for (let y = 0; y < 100; y++) {
		for (let x = 0; x < 100; x++) {
			if (x < 50 && y < 50) {
				// Top-left: Red
				ctx.fillStyle = "rgb(255, 0, 0)";
			} else if (x >= 50 && y < 50) {
				// Top-right: Blue
				ctx.fillStyle = "rgb(0, 0, 255)";
			} else if (x < 50 && y >= 50) {
				// Bottom-left: Green
				ctx.fillStyle = "rgb(0, 255, 0)";
			} else {
				// Bottom-right: Yellow
				ctx.fillStyle = "rgb(255, 255, 0)";
			}
			ctx.fillRect(x, y, 1, 1);
		}
	}

	return canvas;
}

// Grayscale conversion using luminance formula (from the test)
function convertToGrayscale(imageData: ImageData): ImageData {
	const data = imageData.data;

	for (let i = 0; i < data.length; i += 4) {
		const r = data[i];
		const g = data[i + 1];
		const b = data[i + 2];

		// Use the same luminance formula from the test: 0.299*R + 0.587*G + 0.114*B
		const grayscaleValue = Math.round(0.299 * r + 0.587 * g + 0.114 * b);

		// Set RGB channels to the same grayscale value
		data[i] = grayscaleValue; // R
		data[i + 1] = grayscaleValue; // G
		data[i + 2] = grayscaleValue; // B
		// Alpha channel (data[i + 3]) remains unchanged
	}

	return imageData;
}

// Test the conversion (like in the test file)
function testGrayscaleConversion(): GrayscaleTestResult {
	console.log("🎨 Creating RGB test image...");

	const canvas = createRGBTestImage();
	const ctx = canvas.getContext("2d")!;

	// Get original image data
	const originalImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
	const originalData = originalImageData.data;

	// Test specific pixels (like in the test)
	const redPixel: [number, number, number] = [
		originalData[0],
		originalData[1],
		originalData[2],
	];
	const bluePixel: [number, number, number] = [
		originalData[200],
		originalData[201],
		originalData[202],
	]; // Approximate blue area
	const greenPixel: [number, number, number] = [
		originalData[20_000],
		originalData[20_001],
		originalData[20_002],
	]; // Approximate green area
	const yellowPixel: [number, number, number] = [
		originalData[20_200],
		originalData[20_201],
		originalData[20_202],
	]; // Approximate yellow area

	console.log("✅ Original pixels:");
	console.log("  Red pixel:", redPixel);
	console.log("  Blue pixel:", bluePixel);
	console.log("  Green pixel:", greenPixel);
	console.log("  Yellow pixel:", yellowPixel);

	// Expected grayscale values (from the test)
	const expectedGrayscale = {
		red: Math.round(0.299 * 255 + 0.587 * 0 + 0.114 * 0), // 76
		blue: Math.round(0.299 * 0 + 0.587 * 0 + 0.114 * 255), // 29
		green: Math.round(0.299 * 0 + 0.587 * 255 + 0.114 * 0), // 150
		yellow: Math.round(0.299 * 255 + 0.587 * 255 + 0.114 * 0), // 226
	};

	console.log("🔢 Expected grayscale values:");
	console.log("  Red -> Grayscale:", expectedGrayscale.red);
	console.log("  Blue -> Grayscale:", expectedGrayscale.blue);
	console.log("  Green -> Grayscale:", expectedGrayscale.green);
	console.log("  Yellow -> Grayscale:", expectedGrayscale.yellow);

	// Convert to grayscale
	console.log("🔄 Converting to grayscale...");
	const grayscaleImageData = convertToGrayscale(originalImageData);

	// Put the grayscale data back on canvas
	ctx.putImageData(grayscaleImageData, 0, 0);

	// Verify the conversion
	const grayscaleData = grayscaleImageData.data;
	const convertedRedPixel: [number, number, number] = [
		grayscaleData[0],
		grayscaleData[1],
		grayscaleData[2],
	];

	console.log("✅ Converted red pixel:", convertedRedPixel);
	console.log(
		"🎯 Match expected?",
		convertedRedPixel[0] === expectedGrayscale.red
	);

	// Return both original and converted data URLs
	const originalCanvas = createRGBTestImage();
	const originalDataURL = originalCanvas.toDataURL();
	const grayscaleDataURL = canvas.toDataURL();

	return {
		original: originalDataURL,
		grayscale: grayscaleDataURL,
		expectedValues: expectedGrayscale,
		actualValues: {
			red: convertedRedPixel[0],
			blue: grayscaleData[201],
			green: grayscaleData[20_001],
			yellow: grayscaleData[20_201],
		},
	};
}

// Simulate the FFmpeg filter approach (from the test)
function simulateFFmpegHueFilter(imageData: ImageData): ImageData {
	// The test shows that FFmpeg uses "hue=s=0" which sets saturation to 0
	// This converts RGB to HSL, sets S=0, then converts back to RGB
	const data = imageData.data;

	for (let i = 0; i < data.length; i += 4) {
		const r = data[i] / 255;
		const g = data[i + 1] / 255;
		const b = data[i + 2] / 255;

		// Convert RGB to HSL
		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		const l = (max + min) / 2; // Lightness

		// With saturation = 0, RGB values all equal the lightness
		const grayValue = Math.round(l * 255);

		data[i] = grayValue; // R
		data[i + 1] = grayValue; // G
		data[i + 2] = grayValue; // B
		// Alpha unchanged
	}

	return imageData;
}

// Export for use in module environments
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		createRGBTestImage,
		convertToGrayscale,
		simulateFFmpegHueFilter,
		testGrayscaleConversion,
	};
}

// Auto-run test if in browser
if (typeof window !== "undefined") {
	// Expose functions to global scope for browser use
	window.createRGBTestImage = createRGBTestImage;
	window.convertToGrayscale = convertToGrayscale;
	window.simulateFFmpegHueFilter = simulateFFmpegHueFilter;
	window.testGrayscaleConversion = testGrayscaleConversion;

	document.addEventListener("DOMContentLoaded", () => {
		console.log("🚀 Starting grayscale conversion test...");
		const results = testGrayscaleConversion();
		console.log("📊 Test Results:", results);

		// Create visual comparison if we have a document
		if (document.body) {
			const container = document.createElement("div");
			container.innerHTML = `
        <h2>Grayscale Conversion Test</h2>
        <div style="display: flex; gap: 20px;">
          <div>
            <h3>Original RGB</h3>
            <img src="${results.original}" style="width: 200px; image-rendering: pixelated;">
          </div>
          <div>
            <h3>Converted Grayscale</h3>
            <img src="${results.grayscale}" style="width: 200px; image-rendering: pixelated;">
          </div>
        </div>
        <div>
          <h3>Conversion Results</h3>
          <p>Red (255,0,0) → Gray: ${results.actualValues.red} (expected: ${results.expectedValues.red})</p>
          <p>Blue (0,0,255) → Gray: ${results.actualValues.blue} (expected: ${results.expectedValues.blue})</p>
          <p>Green (0,255,0) → Gray: ${results.actualValues.green} (expected: ${results.expectedValues.green})</p>
          <p>Yellow (255,255,0) → Gray: ${results.actualValues.yellow} (expected: ${results.expectedValues.yellow})</p>
        </div>
      `;
			document.body.appendChild(container);
		}
	});
}
