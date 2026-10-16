import React, { useState } from 'react';
import './FileUpload.css';

interface FileUploadProps {
  file: File | null;
  onFileUpload: (file: File) => void;
  label?: string;
  id?: string;
}

const FileUpload: React.FC<FileUploadProps> = ({
  file,
  onFileUpload,
  label = 'Choose Excel File',
  id = 'file-input'
}) => {
  const [isDragging, setIsDragging] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (uploadedFile) {
      onFileUpload(uploadedFile);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile && /\.(xlsx|xls|zip)$/i.test(droppedFile.name)) {
      onFileUpload(droppedFile);
    }
  };

  return (
    <div className="upload-section">
      <input
        type="file"
        accept=".xlsx,.xls,.zip"
        onChange={handleFileChange}
        id={id}
      />
      <label
        htmlFor={id}
        className={`file-label${isDragging ? ' file-label--dragging' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {file ? file.name : label}
      </label>
    </div>
  );
};

export default FileUpload;
