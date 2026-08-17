import { useEffect, useState } from 'react';
import { AlertTriangle, KeyRound, RefreshCw, Sparkles } from 'lucide-react';
import type { AIVisionModelOption, AIVisionSettings } from '../../../lib/leitorRecortador/aiVision/types';
import {
  AI_VISION_MODELS,
  getSyncedVisionModels,
  maskApiKey,
  saveAIVisionSettings,
} from '../../../lib/leitorRecortador/aiVision/aiVisionModels';

type Props = {
  settings: AIVisionSettings;
  onChange: (settings: AIVisionSettings) => void;
};

export function AIConfigTab({ settings, onChange }: Props) {
  const [apiKey, setApiKey] = useState(settings.apiKey);
  const [modelId, setModelId] = useState(settings.modelId);
  const [models, setModels] = useState<AIVisionModelOption[]>(AI_VISION_MODELS);
  const [syncState, setSyncState] = useState<'idle' | 'loading' | 'synced' | 'error'>('idle');
  const [syncError, setSyncError] = useState('');

  const sync = async (key: string, forceRefresh: boolean) => {
    if (!key.trim()) return;
    setSyncState('loading');
    setSyncError('');
    try {
      const fresh = await getSyncedVisionModels(key.trim(), forceRefresh);
      if (fresh.length === 0) throw new Error('A API não retornou nenhum modelo com suporte a imagem.');
      setModels(fresh);
      setSyncState('synced');
      setModelId((prev) => {
        const resolved = fresh.some((m) => m.id === prev) ? prev : fresh[0]!.id;
        const next: AIVisionSettings = { apiKey: key.trim(), modelId: resolved, validated: true };
        saveAIVisionSettings(next);
        onChange(next);
        return resolved;
      });
    } catch (e) {
      setSyncState('error');
      setSyncError((e as Error).message || 'Não foi possível sincronizar com o Google.');
    }
  };

  useEffect(() => {
    if (apiKey.trim()) void sync(apiKey, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!apiKey.trim() || apiKey.trim().length < 20) return;
    const t = setTimeout(() => void sync(apiKey, false), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  const persist = (next: Partial<AIVisionSettings>) => {
    const merged: AIVisionSettings = { apiKey, modelId, validated: settings.validated, ...next };
    saveAIVisionSettings(merged);
    onChange(merged);
  };

  const freeModels = models.filter((m) => m.tier === 'free');
  const paidModels = models.filter((m) => m.tier === 'paid');

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3 max-w-2xl">
      <section className="technical-panel p-3 space-y-2">
        <h3 className="text-[9px] font-black uppercase flex items-center gap-1.5">
          <Sparkles size={12} />
          Configuração IA (Google Gemini)
        </h3>
        <p className="text-[9px] text-brand-text/60 leading-relaxed">
          Usado pelo motor "OCR IA" para ler PDFs escaneados (inclusive anotações escritas à mão)
          sem etapa de alinhamento manual. Precisa de uma chave de API do Gemini, gerada em
          aistudio.google.com/apikey. A chave fica salva só neste navegador.
        </p>
        <label className="block text-[9px] font-bold uppercase opacity-60 flex items-center gap-1">
          <KeyRound size={11} /> Chave de API
        </label>
        <div className="flex gap-1.5">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onBlur={() => {
              persist({ apiKey, validated: false });
              void sync(apiKey, false);
            }}
            placeholder="Cole sua chave da API do Gemini"
            className="flex-1 border border-brand-border px-2 py-1.5 text-[10px]"
          />
          <button
            type="button"
            onClick={() => void sync(apiKey, true)}
            disabled={!apiKey.trim() || syncState === 'loading'}
            title="Sincronizar lista de modelos com o Google agora"
            className="technical-button px-2 shrink-0"
          >
            <RefreshCw size={13} className={syncState === 'loading' ? 'animate-spin' : ''} />
          </button>
        </div>

        {syncState === 'loading' && (
          <p className="text-[9px] font-bold uppercase text-brand-text/60">Sincronizando modelos com o Google...</p>
        )}
        {syncState === 'synced' && (
          <p className="text-[9px] font-bold uppercase text-green-700">
            ✓ Chave validada — {models.length} modelo(s) disponível(is). Pronta para uso no OCR IA.
          </p>
        )}
        {syncState !== 'synced' && syncState !== 'loading' && (
          <p className="text-[9px] font-bold uppercase text-amber-700">
            {settings.validated
              ? 'Chave salva anteriormente — sincronize novamente para confirmar que ainda é válida.'
              : 'Chave ainda não validada. O OCR IA só funciona depois de uma sincronização bem-sucedida.'}
          </p>
        )}
        {syncState === 'error' && (
          <div className="text-[9px] space-y-1.5 border border-red-400 bg-red-50 text-red-900 p-2">
            <p className="flex items-start gap-1 font-bold uppercase">
              <AlertTriangle size={11} className="shrink-0 mt-0.5" /> {syncError}
            </p>
            <p>Chave enviada: <span className="font-mono">{maskApiKey(apiKey)}</span></p>
          </div>
        )}
      </section>

      <section className="technical-panel p-3 space-y-2">
        <h3 className="text-[9px] font-black uppercase">Modelo</h3>
        <p className="text-[9px] text-brand-text/50">
          {syncState === 'synced'
            ? 'Lista obtida em tempo real da API do Google.'
            : 'Lista padrão — informe a chave acima para sincronizar.'}
        </p>
        {freeModels.length > 0 && (
          <div className="space-y-1">
            <p className="text-[8px] font-black uppercase text-green-700">Gratuitos</p>
            {freeModels.map((m) => (
              <label
                key={m.id}
                className={`flex items-start gap-2 p-2 border cursor-pointer text-[9px] ${
                  modelId === m.id ? 'border-brand-border bg-brand-sidebar/30' : 'border-brand-border/40'
                }`}
              >
                <input
                  type="radio"
                  name="ai-model"
                  checked={modelId === m.id}
                  onChange={() => {
                    setModelId(m.id);
                    persist({ modelId: m.id });
                  }}
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-black uppercase">{m.label}</span>
                  <span className="block text-brand-text/60">{m.description}</span>
                </span>
              </label>
            ))}
          </div>
        )}
        {paidModels.length > 0 && (
          <div className="space-y-1">
            <p className="text-[8px] font-black uppercase text-amber-700">Pagos</p>
            {paidModels.map((m) => (
              <label
                key={m.id}
                className={`flex items-start gap-2 p-2 border cursor-pointer text-[9px] ${
                  modelId === m.id ? 'border-brand-border bg-brand-sidebar/30' : 'border-brand-border/40'
                }`}
              >
                <input
                  type="radio"
                  name="ai-model"
                  checked={modelId === m.id}
                  onChange={() => {
                    setModelId(m.id);
                    persist({ modelId: m.id });
                  }}
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-black uppercase">{m.label}</span>
                  <span className="block text-brand-text/60">{m.description}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
