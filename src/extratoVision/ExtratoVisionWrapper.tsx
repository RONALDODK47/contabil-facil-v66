import { ExtratoVisionApp } from './App';
import { Transaction } from './types';
import './index.css';

interface ExtratoVisionWrapperProps {
  initialMode?: 'ia';
  initialFile?: File;
  onClose?: () => void;
  onImportTransactions?: (transactions: Transaction[]) => void;
}

export function ExtratoVisionWrapper({ initialMode, initialFile, onClose, onImportTransactions }: ExtratoVisionWrapperProps) {
  return (
    <div
      className="extrato-vision-theme"
      style={{
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <ExtratoVisionApp
        initialMode={initialMode}
        initialFile={initialFile}
        onClose={onClose}
        onImportTransactions={onImportTransactions}
      />
    </div>
  );
}
