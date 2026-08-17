import React, { useEffect, useState } from 'react';
import { X, Sparkles, KeyRound, RefreshCw, AlertTriangle } from 'lucide-react';
import { AIVisionModelOption, AIVisionSettings } from '../types';
import { AI_VISION_MODELS, getSyncedVisionModels, saveAIVisionSettings, maskApiKey } from '../utils/aiVisionModels';

interface AISettingsModalProps {
  settings: AIVisionSettings;
  onSave: (settings: AIVisionSettings) => void;
  onClose: () => void;
}

export const AISettingsModal: React.FC<AISettingsModalProps> = ({ settings, onSave, onClose }) => {
  const [apiKey, setApiKey] = useState(settings.apiKeys[settings.provider] || '');
  const [modelId, setModelId] = useState(settings.modelId);

  const [models, setModels] = useState<AIVisionModelOption[]>(AI_VISION_MODELS);
  const [syncState, setSyncState] = useState<'idle' | 'loading' | 'synced' | 'error'>('idle');
  const [syncError, setSyncError] = useState('');
  const [autoSwitchNotice, setAutoSwitchNotice] = useState('');

  // Retorna o modelId resolvido (não confiar em state logo após o await — closures não veem
  // o valor atualizado de `modelId` até o próximo render).
  const sync = async (key: string, forceRefresh: boolean): Promise<string | null> => {
    if (!key.trim()) return null;
    setSyncState('loading');
    setSyncError('');
    try {
      const fresh = await getSyncedVisionModels(key.trim(), forceRefresh);
      if (fresh.length === 0) throw new Error('A API não retornou nenhum modelo com suporte a imagem.');
      setModels(fresh);
      setSyncState('synced');

      let resolvedModelId = modelId;
      // Se o modelo salvo não existe mais na lista sincronizada (o Google pode ter aposentado
      // ele), troca automaticamente pro primeiro disponível e avisa o usuário.
      setModelId((prev: any) => {
        if (fresh.some(m => m.id === prev)) { resolvedModelId = prev; return prev; }
        resolvedModelId = fresh[0].id;
        setAutoSwitchNotice(`O modelo salvo anteriormente não está mais disponível no Google. Selecionamos "${fresh[0].label}" automaticamente.`);
        return fresh[0].id;
      });
      return resolvedModelId;
    } catch (e) {
      setSyncState('error');
      setSyncError((e as Error).message || 'Não foi possível sincronizar com o Google.');
      return null;
    }
  };

  // Sincroniza automaticamente assim que o modal abre, se já existir uma chave salva.
  useEffect(() => {
    if (apiKey.trim()) sync(apiKey, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sincroniza automaticamente enquanto o usuário digita/cola a chave (debounced), sem precisar
  // esperar o campo perder o foco — evita o caso de a lista ficar presa no placeholder estático.
  useEffect(() => {
    if (!apiKey.trim() || apiKey.trim().length < 20) return;
    const t = setTimeout(() => sync(apiKey, false), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey]);

  const freeModels = models.filter(m => m.tier === 'free');
  const paidModels = models.filter(m => m.tier === 'paid');

  const handleSave = async () => {
    // Se por algum motivo a sincronização automática ainda não rodou (ex: usuário colou a
    // chave e clicou em Salvar muito rápido), garante uma sincronização antes de persistir, pra
    // nunca salvar um modelo com base só na lista estática de fallback.
    let finalModelId = modelId;
    if (syncState !== 'synced' && apiKey.trim()) {
      const resolved = await sync(apiKey, false);
      if (resolved) finalModelId = resolved;
    }
    const next: AIVisionSettings = {
      provider: 'gemini',
      apiKeys: { ...settings.apiKeys, gemini: apiKey.trim() },
      modelId: finalModelId,
    };
    saveAIVisionSettings(next);
    onSave(next);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-600" />
            <h2 className="text-lg font-semibold text-slate-800">Usar IA para converter</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-5 overflow-y-auto">
          <p className="text-sm text-slate-500">
            Esse modo é para PDFs escaneados (sem texto) — inclusive anotações escritas à mão.
            É um caminho separado do modo padrão de extração e usa um modelo de IA externo, que
            precisa de uma chave de API sua.
          </p>

          <div>
            <label className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-1">
              <KeyRound className="w-4 h-4" /> Chave de API (Google Gemini)
            </label>
            <div className="flex gap-2">
              <input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                onBlur={() => sync(apiKey, false)}
                placeholder="Cole sua chave da API do Gemini"
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <button
                type="button"
                onClick={() => sync(apiKey, true)}
                disabled={!apiKey.trim() || syncState === 'loading'}
                title="Sincronizar lista de modelos com o Google agora"
                className="px-3 rounded-lg border border-slate-300 text-slate-500 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              >
                <RefreshCw className={`w-4 h-4 ${syncState === 'loading' ? 'animate-spin' : ''}`} />
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Gere uma chave gratuita em aistudio.google.com/apikey. A chave fica salva só neste
              navegador (localStorage) — não é enviada a nenhum servidor além da própria Google.
            </p>
            {syncState === 'loading' && (
              <p className="text-xs text-purple-600 mt-1">Sincronizando modelos disponíveis com o Google...</p>
            )}
            {syncState === 'synced' && (
              <p className="text-xs text-emerald-600 mt-1">
                Lista de modelos sincronizada com o Google ({models.length} disponíveis para esta chave).
              </p>
            )}
            {syncState === 'error' && (
              <div className="text-xs text-red-600 mt-1 space-y-2">
                <p className="flex items-start gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {syncError}
                </p>
                <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-red-700 space-y-1">
                  <p>Chave enviada ao Google: <code className="font-mono">{maskApiKey(apiKey)}</code></p>
                  <p className="font-semibold">Se essa chave funciona em outro lugar (Google AI Studio, curl), confira:</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    <li>Se ela é uma chave da <b>Gemini API</b> (aistudio.google.com/apikey) e não uma chave/OAuth de outro produto Google (Vertex AI, Maps, etc).</li>
                    <li>Se no Google Cloud Console → Credenciais, a chave não tem "Restrições de API" que excluam a <b>Generative Language API</b>.</li>
                    <li>Se não tem "Restrições de aplicativo" por referenciador HTTP que bloqueiem chamadas feitas por este navegador.</li>
                    <li>Se ao colar a chave não veio nenhum espaço/quebra de linha extra (confira o tamanho mostrado acima).</li>
                  </ul>
                </div>
              </div>
            )}
          </div>

          {autoSwitchNotice && (
            <div className="text-xs bg-amber-50 border border-amber-200 text-amber-700 rounded-lg p-2 flex items-start gap-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {autoSwitchNotice}
            </div>
          )}

          <div>
            <label className="text-sm font-medium text-slate-700 mb-2 block">Modelo</label>
            <p className="text-xs text-slate-400 mb-2">
              {syncState === 'synced'
                ? 'Lista obtida em tempo real da API do Google — só aparecem modelos que o Google está rodando agora.'
                : 'Lista padrão (informe a chave acima para sincronizar com o que o Google tem disponível agora).'}
            </p>

            {freeModels.length > 0 && (
              <div className="mb-2">
                <p className="text-xs font-semibold text-emerald-600 mb-1">Gratuitos (cota grátis)</p>
                <div className="space-y-1">
                  {freeModels.map(m => (
                    <label key={m.id} className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer ${modelId === m.id ? 'border-purple-500 bg-purple-50' : 'border-slate-200'}`}>
                      <input type="radio" name="ai-model" checked={modelId === m.id} onChange={() => setModelId(m.id)} className="mt-1" />
                      <span>
                        <span className="block text-sm font-medium text-slate-800">{m.label}</span>
                        <span className="block text-xs text-slate-500">{m.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {paidModels.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-amber-600 mb-1">Pagos</p>
                <div className="space-y-1">
                  {paidModels.map(m => (
                    <label key={m.id} className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer ${modelId === m.id ? 'border-purple-500 bg-purple-50' : 'border-slate-200'}`}>
                      <input type="radio" name="ai-model" checked={modelId === m.id} onChange={() => setModelId(m.id)} className="mt-1" />
                      <span>
                        <span className="block text-sm font-medium text-slate-800">{m.label}</span>
                        <span className="block text-xs text-slate-500">{m.description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-200 bg-slate-50 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-slate-600 hover:bg-slate-200">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={!apiKey.trim()}
            className="px-4 py-2 text-sm rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
};
