/**
 * Node.js Grayscale Conversion Test
 * Tests the same conversion logic from debug-effects-store.test.ts
 */

interface TestPixel {
  name: string;
  rgb: [number, number, number];
}

interface ImageData {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

// Test the grayscale conversion logic without browser APIs
function testGrayscaleConversionLogic(): void {
  console.log("🎨 Testing RGB to Grayscale Conversion Logic");
  console.log("=".repeat(50));

  // Test pixels from the QCut test
  const testPixels: TestPixel[] = [
    { name: "Red", rgb: [255, 0, 0] },
    { name: "Blue", rgb: [0, 0, 255] },
    { name: "Green", rgb: [0, 255, 0] },
    { name: "Yellow", rgb: [255, 255, 0] },
    { name: "White", rgb: [255, 255, 255] },
    { name: "Black", rgb: [0, 0, 0] },
    { name: "Purple", rgb: [128, 0, 128] },
    { name: "Orange", rgb: [255, 165, 0] },
  ];

  console.log("📊 Method 1: Luminance Formula (0.299*R + 0.587*G + 0.114*B)");
  console.log("   This is the method used in the QCut test file");
  console.log("");

  testPixels.forEach((pixel) => {
    const [r, g, b] = pixel.rgb;
    const luminance = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    console.log(
      `   ${pixel.name.padEnd(8)} (${r.toString().padStart(3)}, ${g.toString().padStart(3)}, ${b.toString().padStart(3)}) → ${luminance.toString().padStart(3)}`
    );
  });

  console.log("");
  console.log("📊 Method 2: Simple Average (R + G + B) / 3");
  console.log("");

  testPixels.forEach((pixel) => {
    const [r, g, b] = pixel.rgb;
    const average = Math.round((r + g + b) / 3);
    console.log(
      `   ${pixel.name.padEnd(8)} (${r.toString().padStart(3)}, ${g.toString().padStart(3)}, ${b.toString().padStart(3)}) → ${average.toString().padStart(3)}`
    );
  });

  console.log("");
  console.log("📊 Method 3: HSL Lightness (FFmpeg hue=s=0 simulation)");
  console.log("");

  testPixels.forEach((pixel) => {
    const [r, g, b] = pixel.rgb;
    const rNorm = r / 255;
    const gNorm = g / 255;
    const bNorm = b / 255;

    const max = Math.max(rNorm, gNorm, bNorm);
    const min = Math.min(rNorm, gNorm, bNorm);
    const lightness = (max + min) / 2;
    const grayValue = Math.round(lightness * 255);

    console.log(
      `   ${pixel.name.padEnd(8)} (${r.toString().padStart(3)}, ${g.toString().padStart(3)}, ${b.toString().padStart(3)}) → ${grayValue.toString().padStart(3)}`
    );
  });

  console.log("");
  console.log("🎯 Key Findings from QCut Test:");
  console.log("   • Red (255,0,0) → 76 using luminance formula");
  console.log("   • Blue (0,0,255) → 29 using luminance formula");
  console.log("   • Green (0,255,0) → 150 using luminance formula");
  console.log("   • Yellow (255,255,0) → 226 using luminance formula");
  console.log("");
  console.log(
    "💡 The luminance formula gives the most visually accurate grayscale"
  );
  console.log(
    "   because it accounts for human eye sensitivity to different colors."
  );
  console.log("   Green appears brightest, red medium, and blue darkest.");
}

// Create a simple image data structure (simulating ImageData)
function createTestImageData(width: number, height: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);

  // Fill with the same pattern as the QCut test
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;

      if (x < width / 2 && y < height / 2) {
        // Top-left: Red
        data[i] = 255;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 255;
      } else if (x >= width / 2 && y < height / 2) {
        // Top-right: Blue
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 255;
        data[i + 3] = 255;
      } else if (x < width / 2 && y >= height / 2) {
        // Bottom-left: Green
        data[i] = 0;
        data[i + 1] = 255;
        data[i + 2] = 0;
        data[i + 3] = 255;
      } else {
        // Bottom-right: Yellow
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 0;
        data[i + 3] = 255;
      }
    }
  }

  return { data, width, height };
}

// Convert image data to grayscale using luminance formula
function convertToGrayscaleLuminance(imageData: ImageData): ImageData {
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    // Luminance formula from QCut test
    const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);

    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
    // Alpha channel unchanged
  }

  return imageData;
}

// Test the conversion with actual image data
function testImageDataConversion(): void {
  console.log("");
  console.log("🖼️  Testing Image Data Conversion");
  console.log("=".repeat(50));

  const imageData = createTestImageData(100, 100);
  console.log(`Created ${imageData.width}x${imageData.height} test image`);

  // Get sample pixels before conversion
  const redPixel: [number, number, number] = [
    imageData.data[0],
    imageData.data[1],
    imageData.data[2],
  ];
  const bluePixel: [number, number, number] = [
    imageData.data[200],
    imageData.data[201],
    imageData.data[202],
  ];

  console.log("Original pixels:");
  console.log(`  Red pixel: (${redPixel.join(", ")})`);
  console.log(`  Blue pixel: (${bluePixel.join(", ")})`);

  // Convert to grayscale
  const grayscaleData = convertToGrayscaleLuminance(imageData);

  // Check converted pixels
  const convertedRed: [number, number, number] = [
    grayscaleData.data[0],
    grayscaleData.data[1],
    grayscaleData.data[2],
  ];
  const convertedBlue: [number, number, number] = [
    grayscaleData.data[200],
    grayscaleData.data[201],
    grayscaleData.data[202],
  ];

  console.log("Converted pixels:");
  console.log(`  Red pixel: (${convertedRed.join(", ")})`);
  console.log(`  Blue pixel: (${convertedBlue.join(", ")})`);

  // Verify expected values from QCut test
  const expectedRed = 76;
  const expectedBlue = 29;

  console.log("");
  console.log("✅ Verification against QCut test expectations:");
  console.log(
    `  Red conversion: ${convertedRed[0]} (expected: ${expectedRed}) ${convertedRed[0] === expectedRed ? "✓" : "✗"}`
  );
  console.log(
    `  Blue conversion: ${convertedBlue[0]} (expected: ${expectedBlue}) ${convertedBlue[0] === expectedBlue ? "✓" : "✗"}`
  );
}

// Main execution
function main(): void {
  console.log("🎬 QCut Grayscale Conversion Test");
  console.log("Based on debug-effects-store.test.ts");
  console.log("");

  testGrayscaleConversionLogic();
  testImageDataConversion();

  console.log("");
  console.log("🔧 FFmpeg Command Equivalent:");
  console.log('   ffmpeg -i input.mp4 -vf "hue=s=0" output.mp4');
  console.log(
    "   This sets saturation to 0, which is what QCut uses for grayscale"
  );
  console.log("");
  console.log("📝 Summary:");
  console.log('   • QCut uses FFmpeg filter "hue=s=0" for video effects');
  console.log("   • The test uses luminance formula for verification");
  console.log("   • Both methods convert color to grayscale effectively");
  console.log("   • Luminance method is more accurate for human perception");
}

// Run the test
main();
