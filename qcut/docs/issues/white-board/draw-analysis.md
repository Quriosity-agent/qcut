# Draw Folder Analysis

## Overview
The `draw` folder contains a React-based AI image editing application called "🍌-nano-bananary｜zho" that integrates with Google's Gemini AI for image transformations.

## Project Structure

### Core Files
- **App.tsx** - Main React component handling image editing workflow
- **package.json** - Node.js project configuration with React 19 and Gemini AI dependencies
- **index.tsx** - Application entry point
- **index.html** - HTML template
- **vite.config.ts** - Vite build configuration
- **tsconfig.json** - TypeScript configuration
- **.env.local** - Environment variables (likely contains GEMINI_API_KEY)

### Key Directories
- **components/** - React UI components
- **services/** - API integration services (Gemini AI)
- **utils/** - Utility functions for file handling
- **types.ts** - TypeScript type definitions
- **constants.ts** - Application constants and transformations

## Technology Stack
- **Frontend**: React 19.1.1 with TypeScript
- **Build Tool**: Vite 6.2.0
- **AI Integration**: Google Generative AI (@google/genai 1.17.0)
- **Node.js**: TypeScript support with @types/node

## Key Features (Based on Code Analysis)
- Image editing with AI-powered transformations
- Canvas-based image editor
- Multiple image upload support
- History panel for tracking changes
- Preview modal for images
- Watermark embedding functionality
- File download capabilities
- Transformation selector with customizable order

## Application Flow
1. User uploads primary/secondary images
2. Selects from predefined transformations
3. AI processes images using Gemini API
4. Results displayed with preview options
5. Users can download processed images

## Development Commands
```bash
npm run dev      # Start development server
npm run build    # Build for production
npm run preview  # Preview production build
```

## Dependencies
- React 19.1.1 (latest)
- Google Generative AI for image processing
- TypeScript for type safety
- Vite for fast development and building

## Notes
- Requires GEMINI_API_KEY environment variable
- Appears to be a standalone AI Studio app deployment
- Contains sophisticated image manipulation features
- Uses modern React patterns with hooks and TypeScript