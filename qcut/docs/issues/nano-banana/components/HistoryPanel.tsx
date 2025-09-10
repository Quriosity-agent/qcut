
import React from 'react';
import type { GeneratedContent } from '../types';

interface HistoryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  history: GeneratedContent[];
  onUseImage: (imageUrl: string) => void;
  onDownload: (imageUrl: string, type: 'line-art' | 'final-result' | 'single-result') => void;
}

const HistoryItem: React.FC<{ item: GeneratedContent; onUseImage: (url: string) => void; onDownload: (url: string, type: 'line-art' | 'final-result' | 'single-result') => void; }> = ({ item, onUseImage, onDownload }) => {
    
    const ActionButton: React.FC<{ onClick: () => void; children: React.ReactNode; isPrimary?: boolean; }> = ({ onClick, children, isPrimary }) => (
        <button 
            onClick={onClick}
            className={`w-full flex items-center justify-center gap-1.5 py-1.5 px-2 text-xs font-semibold rounded-md transition-colors duration-200 ${
                isPrimary 
                ? 'bg-gradient-to-r from-orange-500 to-yellow-400 text-black shadow-sm shadow-orange-500/20 hover:from-orange-600 hover:to-yellow-500' 
                : 'bg-gray-800 hover:bg-gray-700 text-gray-200'
            }`}
        >
            {children}
        </button>
    );

    return (
        <div className="bg-gray-900/50 p-3 rounded-lg border border-white/10">
            {/* Two-step result */}
            {item.secondaryImageUrl && item.imageUrl && (
                <div className="grid grid-cols-2 gap-3">
                    {/* Line Art */}
                    <div className="flex flex-col gap-2">
                        <img src={item.secondaryImageUrl} className="rounded-md aspect-square object-contain bg-black" alt="Line Art Result" />
                        <div className="text-xs text-center text-gray-400 mb-1">Line Art</div>
                        <div className="grid grid-cols-2 gap-1.5 text-xs">
                            <ActionButton onClick={() => onUseImage(item.secondaryImageUrl!)} isPrimary>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" /><path fillRule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2-2H4a2 2 0 01-2-2V6z" clipRule="evenodd" /></svg>
                                Use
                            </ActionButton>
                            <ActionButton onClick={() => onDownload(item.secondaryImageUrl!, 'line-art')}>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                                Save
                            </ActionButton>
                        </div>
                    </div>
                    {/* Final Result */}
                    <div className="flex flex-col gap-2">
                        <img src={item.imageUrl} className="rounded-md aspect-square object-contain bg-black" alt="Final Result" />
                        <div className="text-xs text-center text-gray-400 mb-1">Final Result</div>
                        <div className="grid grid-cols-2 gap-1.5 text-xs">
                            <ActionButton onClick={() => onUseImage(item.imageUrl!)} isPrimary>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" /><path fillRule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2-2H4a2 2 0 01-2-2V6z" clipRule="evenodd" /></svg>
                                Use
                            </ActionButton>
                            <ActionButton onClick={() => onDownload(item.imageUrl!, 'final-result')}>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                                Save
                            </ActionButton>
                        </div>
                    </div>
                </div>
            )}
            {/* Single result */}
            {!item.secondaryImageUrl && item.imageUrl && (
                <div className="flex flex-col gap-3">
                    <img src={item.imageUrl} className="rounded-md w-full object-contain bg-black" alt="Generated Result" />
                    <div className="grid grid-cols-2 gap-2 text-sm">
                         <ActionButton onClick={() => onDownload(item.imageUrl!, 'single-result')}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                            Download
                        </ActionButton>
                        <ActionButton onClick={() => onUseImage(item.imageUrl!)} isPrimary>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" /><path fillRule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2-2H4a2 2 0 01-2-2V6z" clipRule="evenodd" /></svg>
                            Use as Input
                        </ActionButton>
                    </div>
                </div>
            )}
        </div>
    );
};

const HistoryPanel: React.FC<HistoryPanelProps> = ({ isOpen, onClose, history, onUseImage, onDownload }) => {
  return (
    <div className={`fixed inset-0 z-40 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      
      {/* Panel */}
      <div className={`absolute top-0 right-0 h-full w-full max-w-md bg-gray-950 border-l border-white/10 shadow-2xl flex flex-col transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        {/* Header */}
        <div className="p-4 border-b border-white/10 flex justify-between items-center flex-shrink-0">
          <h2 className="text-xl font-semibold text-orange-500">Generation History</h2>
          <button onClick={onClose} className="p-1 rounded-full text-gray-400 hover:bg-gray-800 hover:text-white transition-colors">
             <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-grow overflow-y-auto p-4">
          {history.length === 0 ? (
            <div className="text-center text-gray-500 pt-10 flex flex-col items-center gap-4">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <p>Your generated images will appear here once you create something.</p>
            </div>
          ) : (
             <div className="space-y-4">
                {history.map((item, index) => (
                    <HistoryItem key={index} item={item} onUseImage={onUseImage} onDownload={onDownload} />
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default HistoryPanel;
