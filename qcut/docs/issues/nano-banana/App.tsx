

import React, { useState, useCallback, useEffect } from 'react';
import { TRANSFORMATIONS } from './constants';
import { editImage } from './services/geminiService';
import type { GeneratedContent, Transformation } from './types';
import TransformationSelector from './components/TransformationSelector';
import ResultDisplay from './components/ResultDisplay';
import LoadingSpinner from './components/LoadingSpinner';
import ErrorMessage from './components/ErrorMessage';
import ImageEditorCanvas from './components/ImageEditorCanvas';
// Fix: Removed unused and non-existent 'fileToDataUrl' import.
import { dataUrlToFile, embedWatermark, loadImage, resizeImageToMatch, downloadImage } from './utils/fileUtils';
import ImagePreviewModal from './components/ImagePreviewModal';
import MultiImageUploader from './components/MultiImageUploader';
import HistoryPanel from './components/HistoryPanel';

type ActiveTool = 'mask' | 'none';

const App: React.FC = () => {
  const [transformations, setTransformations] = useState<Transformation[]>(() => {
    try {
      const savedOrder = localStorage.getItem('transformationOrder');
      if (savedOrder) {
        const orderedTitles = JSON.parse(savedOrder) as string[];
        const transformationMap = new Map(TRANSFORMATIONS.map(t => [t.title, t]));
        
        const orderedTransformations = orderedTitles
          .map(title => transformationMap.get(title))
          .filter((t): t is Transformation => !!t);

        const savedTitlesSet = new Set(orderedTitles);
        const newTransformations = TRANSFORMATIONS.filter(t => !savedTitlesSet.has(t.title));
        
        return [...orderedTransformations, ...newTransformations];
      }
    } catch (e) {
      console.error("Failed to load or parse transformation order from localStorage", e);
    }
    return TRANSFORMATIONS;
  });

  const [selectedTransformation, setSelectedTransformation] = useState<Transformation | null>(null);
  const [primaryImageUrl, setPrimaryImageUrl] = useState<string | null>(null);
  const [primaryFile, setPrimaryFile] = useState<File | null>(null);
  const [secondaryImageUrl, setSecondaryImageUrl] = useState<string | null>(null);
  const [secondaryFile, setSecondaryFile] = useState<File | null>(null);
  const [generatedContent, setGeneratedContent] = useState<GeneratedContent | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [maskDataUrl, setMaskDataUrl] = useState<string | null>(null);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState<string>('');
  const [activeTool, setActiveTool] = useState<ActiveTool>('none');
  const [history, setHistory] = useState<GeneratedContent[]>([]);
  const [isHistoryPanelOpen, setIsHistoryPanelOpen] = useState<boolean>(false);
  
  useEffect(() => {
    try {
      const orderToSave = transformations.map(t => t.title);
      localStorage.setItem('transformationOrder', JSON.stringify(orderToSave));
    } catch (e) {
      console.error("Failed to save transformation order to localStorage", e);
    }
  }, [transformations]);


  const handleSelectTransformation = (transformation: Transformation) => {
    setSelectedTransformation(transformation);
    setGeneratedContent(null);
    setError(null);
    if (transformation.prompt !== 'CUSTOM') {
      setCustomPrompt('');
    }
  };

  const handlePrimaryImageSelect = useCallback((file: File, dataUrl: string) => {
    setPrimaryFile(file);
    setPrimaryImageUrl(dataUrl);
    setGeneratedContent(null);
    setError(null);
    setMaskDataUrl(null);
    setActiveTool('none');
  }, []);

  const handleSecondaryImageSelect = useCallback((file: File, dataUrl: string) => {
    setSecondaryFile(file);
    setSecondaryImageUrl(dataUrl);
    setGeneratedContent(null);
    setError(null);
  }, []);
  
  const handleClearPrimaryImage = () => {
    setPrimaryImageUrl(null);
    setPrimaryFile(null);
    setGeneratedContent(null);
    setError(null);
    setMaskDataUrl(null);
    setActiveTool('none');
  };
  
  const handleClearSecondaryImage = () => {
    setSecondaryImageUrl(null);
    setSecondaryFile(null);
  };

  const handleGenerate = useCallback(async () => {
    if (!primaryImageUrl || !selectedTransformation) {
        setError("Please upload an image and select an effect.");
        return;
    }
    if (selectedTransformation.isMultiImage && !secondaryImageUrl) {
        setError("Please upload both required images.");
        return;
    }
    
    const promptToUse = selectedTransformation.prompt === 'CUSTOM' ? customPrompt : selectedTransformation.prompt;
    if (!promptToUse.trim()) {
        setError("Please enter a prompt describing the change you want to see.");
        return;
    }

    setIsLoading(true);
    setError(null);
    setGeneratedContent(null);
    setLoadingMessage('');

    try {
        const primaryMimeType = primaryImageUrl!.split(';')[0].split(':')[1] ?? 'image/png';
        const primaryBase64 = primaryImageUrl!.split(',')[1];
        const maskBase64 = maskDataUrl ? maskDataUrl.split(',')[1] : null;

        if (selectedTransformation.isTwoStep) {
            // Step 1: Generate line art (using only the primary image)
            setLoadingMessage('Step 1: Creating line art...');
            const stepOneResult = await editImage(
                primaryBase64,
                primaryMimeType,
                promptToUse, // First prompt
                null, // No mask for step 1
                null  // No secondary image for step 1
            );

            if (!stepOneResult.imageUrl) {
                throw new Error("Step 1 (line art) failed to generate an image.");
            }

            // Step 2: Color the line art using the palette
            setLoadingMessage('Step 2: Applying color palette...');
            const stepOneImageBase64 = stepOneResult.imageUrl.split(',')[1];
            const stepOneImageMimeType = stepOneResult.imageUrl.split(';')[0].split(':')[1] ?? 'image/png';

            let secondaryImagePayload = null;
            if (selectedTransformation.isMultiImage && secondaryImageUrl && primaryImageUrl) {
                // Load primary image to get its dimensions
                const primaryImage = await loadImage(primaryImageUrl);
                // Resize color palette to match primary image's aspect ratio
                const resizedSecondaryImageUrl = await resizeImageToMatch(secondaryImageUrl, primaryImage);

                const secondaryMimeType = resizedSecondaryImageUrl.split(';')[0].split(':')[1] ?? 'image/png';
                const secondaryBase64 = resizedSecondaryImageUrl.split(',')[1];
                secondaryImagePayload = { base64: secondaryBase64, mimeType: secondaryMimeType };
            }

            const stepTwoResult = await editImage(
                stepOneImageBase64,
                stepOneImageMimeType,
                selectedTransformation.stepTwoPrompt!, // Second prompt
                null, // No mask for step 2
                secondaryImagePayload // Use the RESIZED color palette here
            );
            
            if (stepTwoResult.imageUrl) {
                stepTwoResult.imageUrl = await embedWatermark(stepTwoResult.imageUrl, "Nano Bananary｜ZHO");
            }

            const finalResult = {
                imageUrl: stepTwoResult.imageUrl,
                text: stepTwoResult.text,
                secondaryImageUrl: stepOneResult.imageUrl, // Store intermediate result
            };
            setGeneratedContent(finalResult);
            setHistory(prev => [finalResult, ...prev]);

        } else { // Single-step generation
             let secondaryImagePayload = null;
            if (selectedTransformation.isMultiImage && secondaryImageUrl) {
                const secondaryMimeType = secondaryImageUrl.split(';')[0].split(':')[1] ?? 'image/png';
                const secondaryBase64 = secondaryImageUrl.split(',')[1];
                secondaryImagePayload = { base64: secondaryBase64, mimeType: secondaryMimeType };
            }
            setLoadingMessage('Generating your masterpiece...');
            const result = await editImage(
                primaryBase64, 
                primaryMimeType, 
                promptToUse,
                maskBase64,
                secondaryImagePayload
            );

            if (result.imageUrl) {
                result.imageUrl = await embedWatermark(result.imageUrl, "Nano Bananary｜ZHO");
            }

            setGeneratedContent(result);
            setHistory(prev => [result, ...prev]);
        }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "An unknown error occurred.");
    } finally {
      setIsLoading(false);
      setLoadingMessage('');
    }
  }, [primaryImageUrl, secondaryImageUrl, selectedTransformation, maskDataUrl, customPrompt, transformations]);


  const handleUseImageAsInput = useCallback(async (imageUrl: string) => {
    if (!imageUrl) return;

    try {
      const newFile = await dataUrlToFile(imageUrl, `edited-${Date.now()}.png`);
      setPrimaryFile(newFile);
      setPrimaryImageUrl(imageUrl);
      setGeneratedContent(null);
      setError(null);
      setMaskDataUrl(null);
      setActiveTool('none');
      setSecondaryFile(null);
      setSecondaryImageUrl(null);
      setSelectedTransformation(null); 
    } catch (err) {
      console.error("Failed to use image as input:", err);
      setError("Could not use the generated image as a new input.");
    }
  }, []);
  
  const toggleHistoryPanel = () => setIsHistoryPanelOpen(prev => !prev);
  
  const handleUseHistoryImageAsInput = (imageUrl: string) => {
      handleUseImageAsInput(imageUrl);
      setIsHistoryPanelOpen(false);
  };
  
  const handleDownloadFromHistory = (imageUrl: string, type: 'line-art' | 'final-result' | 'single-result') => {
      const fileExtension = imageUrl.split(';')[0].split('/')[1] || 'png';
      const filename = `${type}-${Date.now()}.${fileExtension}`;
      downloadImage(imageUrl, filename);
  };

  const handleBackToSelection = () => {
    setSelectedTransformation(null);
  };

  const handleResetApp = () => {
    setSelectedTransformation(null);
    setPrimaryImageUrl(null);
    setPrimaryFile(null);
    setSecondaryImageUrl(null);
    setSecondaryFile(null);
    setGeneratedContent(null);
    setError(null);
    setIsLoading(false);
    setMaskDataUrl(null);
    setCustomPrompt('');
    setActiveTool('none');
    // Don't clear history on reset
  };

  const handleOpenPreview = (url: string) => setPreviewImageUrl(url);
  const handleClosePreview = () => setPreviewImageUrl(null);
  
  const toggleMaskTool = () => {
    setActiveTool(current => (current === 'mask' ? 'none' : 'mask'));
  };
  
  const isCustomPromptEmpty = selectedTransformation?.prompt === 'CUSTOM' && !customPrompt.trim();
  const isSingleImageReady = !selectedTransformation?.isMultiImage && primaryImageUrl;
  const isMultiImageReady = selectedTransformation?.isMultiImage && primaryImageUrl && secondaryImageUrl;
  const isGenerateDisabled = isLoading || isCustomPromptEmpty || (!isSingleImageReady && !isMultiImageReady);


  return (
    <div className="min-h-screen bg-black text-gray-300 font-sans">
      <header className="bg-black/60 backdrop-blur-lg sticky top-0 z-20 p-4 border-b border-white/10">
        <div className="container mx-auto flex justify-between items-center">
          <h1 className="text-2xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-orange-500 to-yellow-400 cursor-pointer" onClick={handleResetApp}>
            🍌 Nano Bananary｜ZHO
          </h1>
          <button
            onClick={toggleHistoryPanel}
            className="flex items-center gap-2 py-2 px-3 text-sm font-semibold text-gray-200 bg-gray-800/50 rounded-md hover:bg-gray-700/50 transition-colors duration-200"
            aria-label="Toggle generation history"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
            </svg>
            <span>History</span>
          </button>
        </div>
      </header>

      <main>
        {!selectedTransformation ? (
          <TransformationSelector 
            transformations={transformations} 
            onSelect={handleSelectTransformation} 
            hasPreviousResult={!!primaryImageUrl}
            onOrderChange={setTransformations}
          />
        ) : (
          <div className="container mx-auto p-4 md:p-8 animate-fade-in">
            <div className="mb-8">
              <button
                onClick={handleBackToSelection}
                className="flex items-center gap-2 text-orange-500 hover:text-orange-400 transition-colors duration-200 py-2 px-4 rounded-lg hover:bg-gray-900"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Choose Another Effect
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Input Column */}
              <div className="flex flex-col gap-6 p-6 bg-gray-950/60 backdrop-blur-lg rounded-xl border border-white/10 shadow-2xl shadow-black/20">
                <div>
                  <div className="mb-4">
                    <h2 className="text-xl font-semibold mb-1 text-orange-500 flex items-center gap-3">
                      <span className="text-3xl">{selectedTransformation.emoji}</span>
                      {selectedTransformation.title}
                    </h2>
                    {selectedTransformation.prompt === 'CUSTOM' ? (
                        <textarea
                            value={customPrompt}
                            onChange={(e) => setCustomPrompt(e.target.value)}
                            placeholder="e.g., 'make the sky a vibrant sunset' or 'add a small red boat on the water'"
                            rows={3}
                            className="w-full mt-2 p-3 bg-gray-900 border border-white/20 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-colors placeholder-gray-500"
                        />
                    ) : (
                       <p className="text-gray-400">{selectedTransformation.description}</p>
                    )}
                  </div>
                  
                  {selectedTransformation.isMultiImage ? (
                    <MultiImageUploader
                      onPrimarySelect={handlePrimaryImageSelect}
                      onSecondarySelect={handleSecondaryImageSelect}
                      primaryImageUrl={primaryImageUrl}
                      secondaryImageUrl={secondaryImageUrl}
                      onClearPrimary={handleClearPrimaryImage}
                      onClearSecondary={handleClearSecondaryImage}
                      primaryTitle={selectedTransformation.primaryUploaderTitle}
                      primaryDescription={selectedTransformation.primaryUploaderDescription}
                      secondaryTitle={selectedTransformation.secondaryUploaderTitle}
                      secondaryDescription={selectedTransformation.secondaryUploaderDescription}
                    />
                  ) : (
                    <ImageEditorCanvas
                      onImageSelect={handlePrimaryImageSelect}
                      initialImageUrl={primaryImageUrl}
                      onMaskChange={setMaskDataUrl}
                      onClearImage={handleClearPrimaryImage}
                      isMaskToolActive={activeTool === 'mask'}
                    />
                  )}

                  {primaryImageUrl && !selectedTransformation.isMultiImage && (
                    <div className="mt-4">
                        <button
                            onClick={toggleMaskTool}
                            className={`w-full flex items-center justify-center gap-2 py-2 px-3 text-sm font-semibold rounded-md transition-colors duration-200 ${
                                activeTool === 'mask' ? 'bg-gradient-to-r from-orange-500 to-yellow-400 text-black' : 'bg-gray-800 hover:bg-gray-700'
                            }`}
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L15.232 5.232z" /></svg>
                            <span>Draw Mask</span>
                        </button>
                    </div>
                  )}
                  
                   <button
                    onClick={handleGenerate}
                    disabled={isGenerateDisabled}
                    className="w-full mt-6 py-3 px-4 bg-gradient-to-r from-orange-500 to-yellow-400 text-black font-semibold rounded-lg shadow-lg shadow-orange-500/20 hover:from-orange-600 hover:to-yellow-500 disabled:bg-gray-800 disabled:from-gray-800 disabled:to-gray-800 disabled:text-gray-500 disabled:shadow-none disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center gap-2"
                  >
                    {isLoading ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Generating...</span>
                      </>
                    ) : (
                      <>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                        <span>Generate Image</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Output Column */}
              <div className="flex flex-col p-6 bg-gray-950/60 backdrop-blur-lg rounded-xl border border-white/10 shadow-2xl shadow-black/20">
                <h2 className="text-xl font-semibold mb-4 text-orange-500 self-start">Result</h2>
                {isLoading && <div className="flex-grow flex items-center justify-center"><LoadingSpinner message={loadingMessage} /></div>}
                {error && <div className="flex-grow flex items-center justify-center w-full"><ErrorMessage message={error} /></div>}
                {!isLoading && !error && generatedContent && (
                    <ResultDisplay 
                        content={generatedContent} 
                        onUseImageAsInput={handleUseImageAsInput}
                        onImageClick={handleOpenPreview}
                        originalImageUrl={primaryImageUrl}
                    />
                )}
                {!isLoading && !error && !generatedContent && (
                  <div className="flex-grow flex flex-col items-center justify-center text-center text-gray-500">
                    <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-12 w-12" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <p className="mt-2">Your generated image will appear here.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
      <ImagePreviewModal imageUrl={previewImageUrl} onClose={handleClosePreview} />
      <HistoryPanel
        isOpen={isHistoryPanelOpen}
        onClose={toggleHistoryPanel}
        history={history}
        onUseImage={handleUseHistoryImageAsInput}
        onDownload={handleDownloadFromHistory}
      />
    </div>
  );
};

// Add fade-in animation for view transitions
const style = document.createElement('style');
style.innerHTML = `
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .animate-fade-in {
    animation: fadeIn 0.4s ease-out forwards;
  }
  @keyframes fadeInFast {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .animate-fade-in-fast {
    animation: fadeInFast 0.2s ease-out forwards;
  }
`;
document.head.appendChild(style);


export default App;