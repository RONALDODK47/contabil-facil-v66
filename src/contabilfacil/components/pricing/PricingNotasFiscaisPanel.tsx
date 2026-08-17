import { useCallback, useEffect, useRef, useState } from 'react';
import { FileKey, Loader2, RefreshCw, Upload } from 'lucide-react';
import { cn, formatCurrency } from '../../lib/utils';
import {
  CF_FIELD_COL,
  CF_FIELD_ROW,
  CF_FORM_FIELDS,
  CF_INPUT_MED,
  CF_INPUT_DATE,
  CF_LABEL,
  CF_SELECT,
} from '../../lib/formFieldClasses';
import type { PricingWorkspace } from '../../logic/pricingTypes';
import { applyNfeCreditsToWorkspace, buildNfeCacheFromApi, mergeNfeCache } from '../../logic/pricingNfeCredits';
import {
  fetchNfeDistribuicaoSefaz,
  importNfeXmlFiles,
  NFE_SEFAZ_MIN_INTERVAL_MS,
  pingNfePrecificacaoApi,
} from '../../../services/nfePrecificacaoApi';
import { getTributaryRegimeDetails, getRegimeBadges, type TributaryRegime } from '../../logic/tributaryRegimeRules';
import { saveSpedFromNfeCache } from '../../logic/nfeToSpedConverter';
import FiscalImpostosAcumuladoresTable from './FiscalImpostosAcumuladoresTable';

export interface PricingNotasFiscaisPanelProps {
  selectedCompany: string;
  workspace: PricingWorkspace;
  onWorkspaceChange: (next: PricingWorkspace) => void;
}

const UFS = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
  'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
];

export default function PricingNotasFiscaisPanel({
  selectedCompany,
  workspace,
  onWorkspaceChange,
}: PricingNotasFiscaisPanelProps) {
  const certRef = useRef<HTMLInputElement>(null);
  const xmlRef = useRef<HTMLInputElement>(null);
  const [cnpj, setCnpj] = useState('');
  const [uf, setUf] = useState('SP');
  const [ambiente, setAmbiente] = useState<'producao' | 'homologacao'>('producao');
  const [senha, setSenha] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [certFile, setCertFile] = useState<File | null>(null);
  const [manifestarCiencia, setManifestarCiencia] = useState(true);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [importingXml, setImportingXml] = useState(false);
  const [applying, setApplying] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);
  const [selectedRegime, setSelectedRegime] = useState<TributaryRegime>(
    (workspace.nfeCache?.selectedRegime ?? 'Lucro Real') as TributaryRegime
  );

  const cache = workspace.nfeCache;

  useEffect(() => {
    pingNfePrecificacaoApi().then(setApiOnline).catch(() => setApiOnline(false));
  }, []);

  // Atualizar regime selecionado quando muda
  useEffect(() => {
    if (cache?.selectedRegime) {
      setSelectedRegime(cache.selectedRegime as TributaryRegime);
    }
  }, [cache?.selectedRegime]);

  useEffect(() => {
    if (cache?.cnpjSync) setCnpj(cache.cnpjSync);
    if (cache?.ufSync) setUf(cache.ufSync);
  }, [selectedCompany, cache?.cnpjSync, cache?.ufSync]);

  const proximaSyncPermitida = cache?.lastSyncAt
    ? new Date(cache.lastSyncAt).getTime() + NFE_SEFAZ_MIN_INTERVAL_MS
    : 0;
  const bloqueadoPorIntervalo = proximaSyncPermitida > Date.now();

  const syncSefaz = useCallback(async () => {
    setErro(null);
    setSucesso(null);
    if (!certFile) {
      setErro('Selecione o certificado digital e-CNPJ A1 (.pfx).');
      return;
    }
    if (!senha.trim()) {
      setErro('Informe a senha do certificado.');
      return;
    }
    if (cnpj.replace(/\D/g, '').length > 0 && cnpj.replace(/\D/g, '').length !== 14) {
      setErro('CNPJ inválido — use 14 dígitos ou deixe vazio para usar o do certificado.');
      return;
    }
    if (bloqueadoPorIntervalo) {
      const min = Math.ceil((proximaSyncPermitida - Date.now()) / 60_000);
      setErro(`Aguarde ~${min} min antes de nova consulta SEFAZ (evita bloqueio cStat 656).`);
      return;
    }

    setSyncing(true);
    try {
      const cnpjLimpo = cnpj.replace(/\D/g, '');
      const ultNSU =
        cache?.cnpjSync === cnpjLimpo && cache?.ultNSU ? cache.ultNSU : '0';

      const result = await fetchNfeDistribuicaoSefaz({
        cnpj: cnpjLimpo,
        uf,
        ambiente,
        certificadoA1: certFile,
        senhaCertificado: senha,
        dataInicio: dataInicio || undefined,
        dataFim: dataFim || undefined,
        ultNSU,
        manifestarCiencia,
      });

      if (!result.ok) {
        setErro(result.mensagem);
        return;
      }

      const incoming = buildNfeCacheFromApi({
        notas: result.notas,
        itensEstoque: result.itensEstoque,
        creditosSugeridos: result.creditosSugeridos,
        ultNSU: result.ultNSU,
        maxNSU: result.maxNSU,
        manifestados: result.manifestados,
        cnpjSync: cnpjLimpo,
        ufSync: uf,
      });
      const nfeCache = mergeNfeCache(workspace.nfeCache, incoming);
      onWorkspaceChange({ ...workspace, nfeCache });
      setSucesso(result.mensagem);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao sincronizar SEFAZ.');
    } finally {
      setSyncing(false);
    }
  }, [
    ambiente,
    bloqueadoPorIntervalo,
    cache?.cnpjSync,
    cache?.ultNSU,
    certFile,
    cnpj,
    dataFim,
    dataInicio,
    manifestarCiencia,
    onWorkspaceChange,
    proximaSyncPermitida,
    senha,
    uf,
    workspace,
  ]);

  const resetarNsu = useCallback(() => {
    if (!workspace.nfeCache) return;
    onWorkspaceChange({
      ...workspace,
      nfeCache: { ...workspace.nfeCache, ultNSU: '0', maxNSU: '0' },
    });
    setSucesso('NSU reiniciado — próxima consulta buscará desde o início.');
    setErro(null);
  }, [onWorkspaceChange, workspace]);

  const importarXmls = useCallback(async (files: FileList | null) => {
    if (!files?.length) {
      setErro('Selecione um ou mais arquivos .xml de NF-e.');
      return;
    }
    setErro(null);
    setSucesso(null);
    setImportingXml(true);
    try {
      const result = await importNfeXmlFiles([...files], {
        dataInicio: dataInicio || undefined,
        dataFim: dataFim || undefined,
      });
      if (!result.ok) {
        setErro(result.mensagem);
        return;
      }
      const nfeCache = mergeNfeCache(workspace.nfeCache, buildNfeCacheFromApi(result));
      onWorkspaceChange({ ...workspace, nfeCache });
      setSucesso(result.mensagem);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao importar XMLs.');
    } finally {
      setImportingXml(false);
    }
  }, [dataFim, dataInicio, onWorkspaceChange, workspace]);

  const aplicarCreditos = useCallback(async () => {
    setApplying(true);
    setErro(null);
    try {
      const applied = applyNfeCreditsToWorkspace(workspace, {
        importStockItems: true,
      });
      onWorkspaceChange(applied.workspace);
      
      // Salvar as NFs também como arquivo SPED para aparecerem nos acumuladores
      if (cache && cache.creditosSugeridos?.length) {
        const cnpjParaSalvar = cache.cnpjSync || cnpj.replace(/\D/g, '');
        if (cnpjParaSalvar.length === 14) {
          const savedToSped = saveSpedFromNfeCache(selectedCompany, cache, cnpjParaSalvar);
          if (savedToSped) {
            // Disparar evento para que a aba de Acumuladores recarregue
            window.dispatchEvent(new CustomEvent('contabilfacil-fiscal-sped-updated'));
          }
        }
      }
      
      setSucesso(applied.message);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao aplicar créditos.');
    } finally {
      setApplying(false);
    }
  }, [onWorkspaceChange, workspace, cache, selectedCompany, cnpj]);

  return (
    <div className="space-y-4">
      {/* Seletor de Regime Tributário */}
      <div className="technical-panel shadow-[3px_3px_0_0_#141414] p-4">
        <div className={CF_FIELD_ROW}>
          <label className={CF_FIELD_COL}>
            <span className={CF_LABEL}>Regime Tributário</span>
            <select
              className={CF_SELECT}
              value={selectedRegime}
              onChange={(e) => {
                const newRegime = e.target.value as TributaryRegime;
                setSelectedRegime(newRegime);
                if (cache) {
                  onWorkspaceChange({
                    ...workspace,
                    nfeCache: { ...cache, selectedRegime: newRegime },
                  });
                }
              }}
            >
              <option value="Lucro Real">Lucro Real</option>
              <option value="Lucro Presumido">Lucro Presumido</option>
              <option value="Simples Nacional">Simples Nacional</option>
            </select>
          </label>
          <div className={CF_FIELD_COL}>
            <span className={CF_LABEL}>Impacto</span>
            <p className="text-[9px] opacity-70 font-mono pt-1">
              Determina recuperação de impostos, alíquotas zero, monofásicos e ICMS ST acima ↑
            </p>
          </div>
        </div>
      </div>

      {/* Conteúdo existente */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase">Notas fiscais · Distribuição DF-e SEFAZ</p>
          <p className="text-[9px] opacity-60 uppercase font-bold mt-1">
            Web Service oficial · certificado A1 · sem scraping de portal
          </p>
        </div>
        <span
          className={cn(
            'text-[9px] font-mono uppercase px-2 py-1 border',
            apiOnline ? 'border-green-700 text-green-800' : 'border-red-700 text-red-800',
          )}
        >
          API fiscal {apiOnline ? 'online' : 'offline'} (:8780)
        </span>
      </div>

      <div className="technical-panel shadow-[3px_3px_0_0_#141414] p-4 space-y-3 text-[9px] leading-relaxed opacity-80">
        <p className="font-black uppercase text-[10px] opacity-100">Como o robô funciona</p>
        <ol className="list-decimal list-inside space-y-1 font-mono">
          <li>
            <strong>ConsNSU</strong> — consulta Distribuição DF-e informando o último NSU (contador SEFAZ).
          </li>
          <li>
            <strong>Manifesto</strong> — registra ciência da operação (evento 210210) para liberar XML de terceiros.
          </li>
          <li>
            <strong>Download</strong> — recebe XML compactado (GZIP), descompacta e extrai itens/créditos.
          </li>
        </ol>
        <p className="opacity-70">
          Consultas repetidas em curto intervalo geram rejeição 656. O sistema aguarda ~1 h entre sincronizações
          automáticas e persiste o NSU por empresa.
        </p>
      </div>

      <div className="technical-panel shadow-[3px_3px_0_0_#141414] p-4 space-y-4">
        <div className={CF_FIELD_ROW}>
          <label className={CF_FIELD_COL}>
            <span className={CF_LABEL}>CNPJ empresa</span>
            <input
              className={CF_INPUT_MED}
              placeholder="00.000.000/0001-00 (opcional se no cert.)"
              value={cnpj}
              onChange={(e) => setCnpj(e.target.value)}
            />
          </label>
          <label className={CF_FIELD_COL}>
            <span className={CF_LABEL}>UF</span>
            <select className={CF_SELECT} value={uf} onChange={(e) => setUf(e.target.value)}>
              {UFS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          <label className={CF_FIELD_COL}>
            <span className={CF_LABEL}>Ambiente</span>
            <select
              className={CF_SELECT}
              value={ambiente}
              onChange={(e) => setAmbiente(e.target.value as 'producao' | 'homologacao')}
            >
              <option value="producao">Produção</option>
              <option value="homologacao">Homologação</option>
            </select>
          </label>
          <label className={CF_FIELD_COL}>
            <span className={CF_LABEL}>Período início</span>
            <input
              type="date"
              className={CF_INPUT_DATE}
              value={dataInicio}
              onChange={(e) => setDataInicio(e.target.value)}
            />
          </label>
          <label className={CF_FIELD_COL}>
            <span className={CF_LABEL}>Período fim</span>
            <input
              type="date"
              className={CF_INPUT_DATE}
              value={dataFim}
              onChange={(e) => setDataFim(e.target.value)}
            />
          </label>
        </div>

        <div className={CF_FIELD_ROW}>
          <label className={CF_FIELD_COL}>
            <span className={CF_LABEL}>Certificado A1 (.pfx)</span>
            <input
              ref={certRef}
              type="file"
              accept=".pfx,.p12"
              className="hidden"
              onChange={(e) => setCertFile(e.target.files?.[0] ?? null)}
            />
            <button
              type="button"
              className="technical-button text-[9px] flex items-center gap-2"
              onClick={() => certRef.current?.click()}
            >
              <Upload size={12} />
              {certFile ? certFile.name : 'Selecionar certificado'}
            </button>
          </label>
          <label className={CF_FIELD_COL}>
            <span className={CF_LABEL}>Senha do certificado</span>
            <input
              type="password"
              className={CF_INPUT_MED}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoComplete="off"
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-[9px] font-mono cursor-pointer">
          <input
            type="checkbox"
            checked={manifestarCiencia}
            onChange={(e) => setManifestarCiencia(e.target.checked)}
            className="accent-brand-border"
          />
          Manifestar ciência da operação automaticamente (recomendado para NF-e de terceiros)
        </label>

        {cache?.ultNSU ? (
          <p className="text-[9px] font-mono opacity-70">
            NSU salvo: <strong>{cache.ultNSU}</strong>
            {cache.maxNSU ? ` · máx ${cache.maxNSU}` : ''}
            {cache.manifestados ? ` · ${cache.manifestados} manifesto(s) na última sync` : ''}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={syncing || !apiOnline || bloqueadoPorIntervalo}
            onClick={() => void syncSefaz()}
            className="technical-button-primary text-[9px] flex items-center gap-2 disabled:opacity-40"
            title={
              bloqueadoPorIntervalo
                ? 'Aguarde 1 h entre consultas SEFAZ'
                : 'Distribuição DF-e + manifesto + XML'
            }
          >
            {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Importar da SEFAZ
          </button>
          <button
            type="button"
            disabled={!cache?.ultNSU}
            onClick={resetarNsu}
            className="technical-button text-[9px] disabled:opacity-40"
          >
            Resetar NSU
          </button>
          <input
            ref={xmlRef}
            type="file"
            accept=".xml,application/xml,text/xml"
            multiple
            className="hidden"
            aria-label="Selecionar arquivos XML de NF-e"
            onChange={(e) => {
              void importarXmls(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            disabled={importingXml || !apiOnline}
            onClick={() => xmlRef.current?.click()}
            className="technical-button text-[9px] flex items-center gap-2 disabled:opacity-40"
          >
            {importingXml ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            Importar XMLs (manual)
          </button>
          <button
            type="button"
            disabled={applying || !cache?.creditosSugeridos?.length}
            onClick={() => void aplicarCreditos()}
            className="technical-button text-[9px] flex items-center gap-2 disabled:opacity-40"
          >
            {applying ? <Loader2 size={12} className="animate-spin" /> : <FileKey size={12} />}
            Lançar créditos a recuperar
          </button>
        </div>

        {bloqueadoPorIntervalo && cache?.lastSyncAt ? (
          <p className="text-[9px] text-amber-800 font-mono">
            Próxima consulta SEFAZ liberada após{' '}
            {new Date(proximaSyncPermitida).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.
          </p>
        ) : null}

        {erro ? <p className="text-[10px] text-red-800 font-bold">{erro}</p> : null}
        {sucesso ? <p className="text-[10px] text-green-800 font-bold">{sucesso}</p> : null}
      </div>

      {cache?.lastSyncAt ? (
        <div className="technical-panel shadow-[3px_3px_0_0_#141414] overflow-hidden">
          <div className="px-4 py-3 border-b border-brand-border text-[10px] font-black uppercase">
            Última sync · {new Date(cache.lastSyncAt).toLocaleString('pt-BR')}
          </div>
          <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-[10px] font-mono">
            <div>
              <p className="font-black uppercase opacity-50">Notas</p>
              <p className="text-lg font-bold">{cache.notas.length}</p>
            </div>
            <div>
              <p className="font-black uppercase opacity-50">Itens estoque</p>
              <p className="text-lg font-bold">{cache.itensEstoque.length}</p>
            </div>
            <div>
              <p className="font-black uppercase opacity-50">Créditos sugeridos</p>
              <p className="text-lg font-bold">{cache.creditosSugeridos.length}</p>
            </div>
          </div>

          {/* Exibição de Notas Fiscais */}
          {cache.notas.length > 0 ? (
            <div className="border-t border-brand-border/30">
              <div className="px-4 py-2 bg-brand-sidebar/20 text-[9px] font-black uppercase">
                Notas Fiscais ({cache.notas.length})
              </div>
              <div className="max-h-48 overflow-y-auto divide-y divide-brand-border/10">
                {cache.notas.slice(0, 20).map((n) => (
                  <div key={n.chave} className="px-4 py-2 text-[9px] font-mono flex justify-between gap-2 hover:bg-brand-sidebar/10">
                    <div className="min-w-0 flex-1">
                      <span className="truncate block font-bold">
                        NF {n.numero}/{n.serie}
                      </span>
                      <span className="truncate block opacity-70">{n.emitente}</span>
                      {n.emissao && <span className="text-[8px] opacity-50">{n.emissao}</span>}
                    </div>
                    <span className="shrink-0 font-bold text-emerald-400">{formatCurrency(n.total)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Nova Tabela: Impostos & Acumuladores */}
          <div className="border-t border-brand-border/30">
            <FiscalImpostosAcumuladoresTable
              cache={cache}
              selectedRegime={selectedRegime}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
