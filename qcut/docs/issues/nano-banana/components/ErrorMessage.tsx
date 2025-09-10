
import React from 'react';

interface ErrorMessageProps {
  message: string;
}

const ErrorMessage: React.FC<ErrorMessageProps> = ({ message }) => {
  return (
    <div className="w-full max-w-lg p-4 bg-red-900/50 border border-red-700 text-red-300 rounded-lg text-center" role="alert">
      <p className="font-bold">An Error Occurred</p>
      <p className="text-sm">{message}</p>
    </div>
  );
};

export default ErrorMessage;