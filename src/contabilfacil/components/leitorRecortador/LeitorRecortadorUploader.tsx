/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState } from 'react';
import { Upload, FileText, Image as ImageIcon, AlertCircle } from 'lucide-react';
import type { DocMetadata } from '../../../lib/leitorRecortador/types';

interface UploaderProps {
  onFileLoaded: (file: File) => void;
  metadata: DocMetadata | null;
  isProcessing: boolean;
  onPageChange?: (page: number) => void;
}

export function LeitorRecortadorUploader({
  onFileLoaded,
  metadata,
  isProcessing,
  onPageChange,
}: UploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  };

  const processFile = (file: File) => {
    setErrorMsg(null);
    const validTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
    if (!validTypes.includes(file.type)) {
      setErrorMsg('Formato de arquivo não suportado. Por favor, envie um PDF, PNG ou JPG.');
      return;
    }
    onFileLoaded(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const canGoPrev = Boolean(metadata && metadata.pageNumber > 1 && !isProcessing);
  const canGoNext = Boolean(metadata && metadata.pageNumber < metadata.totalPages && !isProcessing);

  return (
    <div className="flex flex-col gap-4">
      {/* Upload Box */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative border-2 border-dashed p-6 transition-all duration-200 text-center flex flex-col items-center justify-center cursor-pointer ${ isDragOver ? 'border-brand-border bg-brand-sidebar/10' : 'border-brand-border hover:border-brand-border bg-brand-sidebar/40 hover:bg-brand-sidebar/80' }`}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,image/png,image/jpeg,image/jpg"
          className="hidden"
          onChange={handleFileChange}
          aria-label="Selecionar arquivo de extrato bancário (PDF, PNG ou JPG)"
          title="Selecionar arquivo de extrato bancário (PDF, PNG ou JPG)"
        />

        <div className={`w-10 h-10 flex items-center justify-center mb-3 border shadow-[2px_2px_0_0_#141414] ${ isDragOver ? 'bg-brand-text text-white border-brand-border' : 'bg-brand-sidebar text-brand-text/60 border-brand-border' }`}>
          <Upload className="w-5 h-5" />
        </div>

        <h3 className="font-semibold text-brand-text text-xs mb-1">
          Importar Extrato Bancário
        </h3>
        <p className="text-brand-text/60 text-[10px] leading-normal max-w-[200px] mb-3">
          Arraste e solte seu arquivo PDF, PNG ou JPG aqui, ou clique para navegar.
        </p>
        <span className="text-[9px] bg-brand-sidebar text-brand-text/60 px-2 py-0.5 font-medium border border-brand-border">
          PDF, PNG, JPG (Máx. 10MB)
        </span>
      </div>

      {/* Error Message */}
      {errorMsg && (
        <div className="flex items-start gap-2 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs leading-normal">
          <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* File metadata & controls */}
      {metadata && (
        <div className="technical-panel flex flex-col gap-4 overflow-hidden p-4 shadow-[2px_2px_0_0_#141414]">
          <div className="flex items-start gap-3">
            <div
              className={`flex h-8 w-8 flex-shrink-0 items-center justify-center border ${
                metadata.type === 'pdf'
                  ? 'border-rose-200 bg-rose-50 text-rose-600'
                  : 'border-amber-200 bg-amber-50 text-amber-700'
              }`}
            >
              {metadata.type === 'pdf' ? (
                <FileText className="w-4 h-4" />
              ) : (
                <ImageIcon className="w-4 h-4" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="truncate text-xs font-semibold text-brand-text" title={metadata.name}>
                {metadata.name}
              </h4>
              <p className="break-all text-[10px] font-mono uppercase text-brand-text/60">
                {metadata.type} • {metadata.width}x{metadata.height}px
              </p>
            </div>
          </div>

          {/* PDF Page Selection Controls */}
          {metadata.type === 'pdf' && metadata.totalPages > 1 && (
            <div className="border-t border-brand-border pt-3">
              <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-brand-text/60">
                Página Selecionada ({metadata.pageNumber} de {metadata.totalPages})
              </label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
                <button
                  type="button"
                  disabled={!canGoPrev}
                  onClick={() => onPageChange && onPageChange(metadata.pageNumber - 1)}
                  className="technical-button flex w-full items-center justify-center px-3 py-2 text-xs font-semibold disabled:opacity-50"
                >
                  Anterior
                </button>
                <div className="flex min-h-[36px] items-center justify-center border border-brand-border bg-brand-sidebar px-3 py-2 text-center font-mono text-xs font-semibold text-brand-text">
                  Pág. {metadata.pageNumber}
                </div>
                <button
                  type="button"
                  disabled={!canGoNext}
                  onClick={() => onPageChange && onPageChange(metadata.pageNumber + 1)}
                  className="technical-button flex w-full items-center justify-center px-3 py-2 text-xs font-semibold disabled:opacity-50"
                >
                  Próxima
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
