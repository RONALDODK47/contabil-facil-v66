/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback } from 'react';
import { motion } from 'motion/react';
import { Upload, FileText } from 'lucide-react';

interface FileUploaderProps {
  onFilesProcessed: (content: string, name: string) => void;
}

export function FileUploader({ onFilesProcessed }: FileUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFile = useCallback((file: File) => {
    if (file && file.name.toLowerCase().endsWith('.txt')) {
      setFileName(file.name);
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        onFilesProcessed(content, file.name);
      };
      reader.readAsText(file, 'ISO-8859-1');
    } else {
      alert('Por favor, envie um arquivo .txt do SPED');
    }
  }, [onFilesProcessed]);

  return (
    <div className="w-full max-w-2xl mx-auto mb-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className={`relative border-2 border-dashed rounded-2xl p-12 transition-all duration-300 ${
          isDragging 
            ? 'border-blue-500 bg-blue-50/50' 
            : 'border-slate-300 hover:border-blue-400 bg-white shadow-sm'
        }`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) handleFile(file);
        }}
      >
        <input
          type="file"
          accept=".txt"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          id="sped-upload"
          aria-label="Upload de arquivo SPED"
        />
        <div className="flex flex-col items-center justify-center text-center space-y-4">
          <div className={`p-4 rounded-full ${isDragging ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
            {fileName ? <FileText size={48} /> : <Upload size={48} />}
          </div>
          <div>
            <h3 className="text-xl font-semibold text-slate-800">
              {fileName ? fileName : 'Arraste seu arquivo SPED'}
            </h3>
            <p className="text-slate-500 mt-1 text-sm">
              {fileName ? 'Arquivo processado com sucesso' : 'Suporta SPED ICMS/IPI e SPED Contribuições (.txt)'}
            </p>
          </div>
          {!fileName && (
            <button
              type="button"
              className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors shadow-sm text-sm"
            >
              Selecionar Arquivo SPED
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
