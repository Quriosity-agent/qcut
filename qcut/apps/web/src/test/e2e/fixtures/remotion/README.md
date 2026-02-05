# Remotion Test Fixtures

Test fixtures for Remotion folder import E2E tests.

## Directory Structure

```text
remotion/
├── valid-project/          # Valid Remotion project with compositions
│   ├── package.json        # Has remotion dependency
│   ├── tsconfig.json       # TypeScript configuration
│   └── src/
│       ├── Root.tsx        # Contains <Composition> elements
│       ├── HelloWorld.tsx  # Simple text composition
│       └── TestAnimation.tsx # Animation composition
├── invalid-project/        # Missing remotion dependency
│   └── package.json        # Has react but NOT remotion
├── no-root-project/        # Missing Root.tsx
│   └── package.json        # Has remotion but no src/Root.tsx
└── empty-folder/           # Empty directory for error testing
```

## Test Scenarios

### valid-project
- Tests successful folder validation
- Tests composition scanning (2 compositions: HelloWorld, TestAnimation)
- Tests bundling and loading
- Tests timeline integration

### invalid-project
- Tests error handling when remotion is not in dependencies
- Expected error: "No remotion dependency found in package.json"

### no-root-project
- Tests error handling when Root.tsx is missing
- Expected error: "Root.tsx not found"

### empty-folder
- Tests error handling for empty directories
- Expected error: "No package.json found"

## Composition Details

### HelloWorld
- Duration: 150 frames (5 seconds at 30fps)
- Dimensions: 1920x1080
- Features: Spring animation, text fade-in

### TestAnimation
- Duration: 300 frames (10 seconds at 30fps)
- Dimensions: 1920x1080
- Features: Rotation, scale interpolation
