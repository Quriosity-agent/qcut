
import React from 'react';

interface ImagePreviewModalProps {
  imageUrl: string | null;
  onClose: () => void;
}

const ImagePreviewModal: React.FC<ImagePreviewModalProps> = ({ imageUrl, onClose }) => {
  if (!imageUrl) {
    return null;
  }
  
  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent modal from closing
    if (!imageUrl) return;
    const link = document.createElement('a');
    link.href = imageUrl;
    const fileExtension = imageUrl.split(';')[0].split('/')[1] || 'png';
    link.download = `generated-image-${Date.now()}.${fileExtension}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center p-4 animate-fade-in-fast"
      onClick={onClose}
    >
      <div 
        className="relative max-w-4xl max-h-[85vh] w-full h-full flex-grow"
        onClick={(e) => e.stopPropagation()} // Prevent closing modal when clicking on the image
      >
        <img 
          src={imageUrl} 
          alt="Generated result preview" 
          className="w-full h-full object-contain rounded-lg shadow-2xl" 
        />
        <button
          onClick={onClose}
          className="absolute -top-2 -right-2 z-10 p-2 bg-black/50 backdrop-blur-sm rounded-full text-white hover:bg-red-600 transition-colors"
          aria-label="Close preview"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
       <div className="flex-shrink-0 mt-4">
        <button
          onClick={handleDownload}
          className="py-2 px-5 bg-gray-800 text-gray-200 font-semibold rounded-lg shadow-sm hover:bg-gray-700 transition-all duration-200 flex items-center justify-center gap-2"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
          <span>Download Image</span>
        </button>
      </div>
      <style>
        {`
          @keyframes fadeInFast {
            from { opacity: 0; }
            to { opacity: 1; }
          }
          .animate-fade-in-fast {
            animation: fadeInFast 0.2s ease-out forwards;
          }
        `}
      </style>
    </div>
  );
};

export default ImagePreviewModal;
