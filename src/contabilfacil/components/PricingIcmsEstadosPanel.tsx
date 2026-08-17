import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, Info, Loader2, MapPin, RefreshCw } from 'lucide-react';
import { cn, formatCurrency } from '../lib/utils';
import { FreeNumericInput } from './FreeNumericInput';
import {
  CF_FIELD_COL,
  CF_FIELD_ROW,
  CF_FORM_INPUT_MONEY,
  CF_SELECT_WIDE,
} from '../lib/formFieldClasses';
import type { IcmsComparacaoResult } from '../logic/icmsInterestadual';
import { compararIcmsInterestadual, listarUfsIcms } from '../logic/icmsInterestadual';
import PricingInfoModal from './pricing/PricingInfoModal';
import {
  compararIcmsViaApi,
  getIcmsCatalogoLocal,
  pingSefazIcmsApi,
  sincronizarReferenciasSefazIcms,
  type SefazIcmsSyncStatus,
} from '../../services/sefazIcmsApi';
import {
  loadPricingIcmsUfPrefs,
  savePricingIcmsUfPrefs,
} from '../logic/pricingCompanyWorkspace';

const UFS = listarUfsIcms();

export interface PricingIcmsEstadosPanelProps {
  selectedCompany: string;
  /** Valor sugerido a partir de mercadoria/produto precificado. */
  valorBaseSugerido?: number;
}

export default function PricingIcmsEstadosPanel({
  selectedCompany,
  valorBaseSugerido = 0,
}: PricingIcmsEstadosPanelProps) {
  const catalogo = useMemo(() => getIcmsCatalogoLocal(), []);
  const [ufOrigem, setUfOrigem] = useState('SP');
  const [ufDestino, setUfDestino] = useState('RJ');
  const [valorBase, setValorBase] = useState(0);
  const [produtoImportado, setProdutoImportado] = useState(false);
  const [consumidorFinal, setConsumidorFinal] = useState(true);
  const [resultado, setResultado] = useState<IcmsComparacaoResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [syncStatus, setSyncStatus] = useState<SefazIcmsSyncStatus | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  useEffect(() => {
    const prefs = loadPricingIcmsUfPrefs(selectedCompany);
    if (prefs.ufOrigem) setUfOrigem(prefs.ufOrigem);
    if (prefs.ufDestino) setUfDestino(prefs.ufDestino);
  }, [selectedCompany]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      savePricingIcmsUfPrefs(selectedCompany, { ufOrigem, ufDestino });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [selectedCompany, ufOrigem, ufDestino]);

  useEffect(() => {
    if (valorBaseSugerido > 0 && valorBase <= 0) {
      setValorBase(valorBaseSugerido);
    }
  }, [valorBaseSugerido, valorBase]);

  useEffect(() => {
    pingSefazIcmsApi().then(setApiOnline).catch(() => setApiOnline(false));
  }, []);

  const calcular = useCallback(async () => {
    setLoading(true);
    setErro(null);
    // Atualiza os cards instantaneamente com cálculo local.
    const localComp = compararIcmsInterestadual({
      ufOrigem,
      ufDestino,
      valorBase,
      produtoImportado,
      consumidorFinalNaoContribuinte: consumidorFinal,
    });
    setResultado(localComp);
    try {
      const comp = await compararIcmsViaApi({
        ufOrigem,
        ufDestino,
        valorBase,
        produtoImportado,
        consumidorFinalNaoContribuinte: consumidorFinal,
      });
      setResultado(comp);
    } catch (e) {
      // Se API falhar, mantém cálculo local e apenas sinaliza fallback.
      setErro(e instanceof Error ? `${e.message} (usando cálculo local)` : 'Falha na API (usando cálculo local).');
      setApiOnline(false);
    } finally {
      setLoading(false);
    }
  }, [
    ufOrigem,
    ufDestino,
    valorBase,
    produtoImportado,
    consumidorFinal,
  ]);

  useEffect(() => {
    void calcular();
  }, [calcular]);

  const handleSyncSefaz = async () => {
    setSyncing(true);
    try {
      const st = await sincronizarReferenciasSefazIcms();
      setSyncStatus(st);
      setApiOnline(await pingSefazIcmsApi());
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="technical-panel p-4 shadow-[3px_3px_0_0_#141414] space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                <MapPin size={14} /> ICMS entre estados (mercadoria)
              </p>
              <button
                type="button"
                onClick={() => setInfoOpen(true)}
                className={cn(
                  'h-7 w-7 border border-brand-border flex items-center justify-center text-brand-text',
                  infoOpen ? 'bg-brand-border text-brand-bg' : 'bg-transparent hover:bg-brand-sidebar/20',
                )}
                title="Informações do cálculo ICMS entre estados"
                aria-label="Informações do cálculo ICMS entre estados"
                aria-haspopup="dialog"
              >
                <Info size={12} aria-hidden />
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <span
              className={cn(
                'text-[8px] font-black uppercase px-2 py-1 border',
                apiOnline === true
                  ? 'border-emerald-700 text-emerald-800 bg-emerald-50'
                  : apiOnline === false
                    ? 'border-amber-700 text-amber-900 bg-amber-50'
                    : 'border-brand-border/40 opacity-50',
              )}
            >
              API fiscal {apiOnline === true ? 'online' : apiOnline === false ? 'local' : '…'}
            </span>
            <button
              type="button"
              onClick={() => void handleSyncSefaz()}
              disabled={syncing}
              className="technical-button-secondary text-[9px] flex items-center gap-1"
            >
              {syncing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              Sincronizar SEFAZ
            </button>
          </div>
        </div>

        {syncStatus && (
          <p className="text-[9px] font-mono border border-brand-border/30 bg-brand-sidebar/30 px-2 py-1.5">
            {syncStatus.mensagem}
            {syncStatus.svrsPortalAcessivel ? ' · Portal DIFAL SVRS OK' : ''}
            {syncStatus.confazAcessivel ? ' · CONFAZ OK' : ''}
          </p>
        )}

        <div className="flex flex-wrap gap-2 text-[9px]">
          <a
            href={catalogo.portalDifalUrl}
            target="_blank"
            rel="noreferrer"
            className="technical-button text-[8px] flex items-center gap-1"
          >
            Portal DIFAL (SVRS) <ExternalLink size={10} />
          </a>
          <a
            href={catalogo.confazUrl}
            target="_blank"
            rel="noreferrer"
            className="technical-button text-[8px] flex items-center gap-1"
          >
            CONFAZ <ExternalLink size={10} />
          </a>
        </div>
      </div>

      <div className="technical-panel p-4 shadow-[3px_3px_0_0_#141414]">
        <div className={CF_FIELD_ROW}>
        <label className={CF_FIELD_COL}>
          <span className="text-[9px] font-black uppercase">UF origem (comprador)</span>
          <select
            aria-label="UF origem do comprador"
            className={CF_SELECT_WIDE}
            value={ufOrigem}
            onChange={(e) => setUfOrigem(e.target.value)}
          >
            {UFS.map((u) => (
              <option key={u.uf} value={u.uf}>
                {u.uf} — {u.nome}
              </option>
            ))}
          </select>
        </label>
        <label className={CF_FIELD_COL}>
          <span className="text-[9px] font-black uppercase">UF destino (fornecedor)</span>
          <select
            aria-label="UF destino do fornecedor"
            className={CF_SELECT_WIDE}
            value={ufDestino}
            onChange={(e) => setUfDestino(e.target.value)}
          >
            {UFS.map((u) => (
              <option key={u.uf} value={u.uf}>
                {u.uf} — {u.nome}
              </option>
            ))}
          </select>
        </label>
        <label className={CF_FIELD_COL}>
          <span className="text-[9px] font-black uppercase">Valor mercadoria (R$)</span>
          <FreeNumericInput
            aria-label="Valor da mercadoria em reais"
            className={CF_FORM_INPUT_MONEY}
            placeholder="1000"
            value={valorBase}
            onChange={setValorBase}
          />
        </label>
        <div className={CF_FIELD_COL}>
          <label className="flex items-center gap-2 text-[9px] font-bold uppercase cursor-pointer">
            <input
              type="checkbox"
              aria-label="Consumidor final (DIFAL)"
              checked={consumidorFinal}
              onChange={(e) => setConsumidorFinal(e.target.checked)}
            />
            Consumidor final (DIFAL)
          </label>
          <label className="flex items-center gap-2 text-[9px] font-bold uppercase cursor-pointer">
            <input
              type="checkbox"
              aria-label="Produto importado com mais de 40%"
              checked={produtoImportado}
              onChange={(e) => setProdutoImportado(e.target.checked)}
            />
            Produto importado (&gt;40%)
          </label>
          <button
            type="button"
            onClick={() => void calcular()}
            disabled={loading}
            className="technical-button-primary text-[9px] flex items-center justify-center gap-1"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : null}
            Calcular diferença
          </button>
        </div>
      </div>
      </div>

      {erro && (
        <p className="text-[10px] font-bold uppercase text-red-800 border border-red-800/40 bg-red-50 px-3 py-2">
          {erro}
        </p>
      )}

      {resultado && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            {
              label: 'Alíquota interna origem',
              value: `${resultado.aliquotaInternaOrigem.toFixed(2)}%`,
              sub: resultado.nomeOrigem,
              tone: 'text-brand-text',
            },
            {
              label: 'ICMS interestadual (NF)',
              value: `${resultado.aliquotaInterestadual.toFixed(2)}%`,
              sub: formatCurrency(resultado.valorIcmsInterestadual),
              tone: 'text-blue-800',
            },
            {
              label: 'Alíquota interna destino',
              value: `${resultado.aliquotaInternaDestino.toFixed(2)}%`,
              sub: resultado.nomeDestino,
              tone: 'text-brand-text',
            },
            {
              label: 'Diferença (p.p.)',
              value: `${resultado.diferencaPercentualPontos.toFixed(2)} p.p.`,
              sub: 'Interna destino − interestadual',
              tone: 'text-amber-800',
            },
            {
              label: resultado.difalAplicavel ? 'DIFAL estimado' : 'Custo ICMS extra (est.)',
              value: formatCurrency(
                resultado.difalAplicavel
                  ? resultado.valorDifalEstimado
                  : resultado.custoIcmsExtraEstimado,
              ),
              sub: resultado.difalAplicavel ? `${resultado.difalPercentual.toFixed(2)}% s/ base` : 'Sem DIFAL marcado',
              tone: 'text-red-800',
            },
          ].map((card) => (
            <div
              key={card.label}
              className="technical-panel p-4 shadow-[2px_2px_0_0_#141414] border-brand-border/30"
            >
              <p className="text-[8px] font-black uppercase opacity-50">{card.label}</p>
              <p className={cn('text-xl font-black mt-1', card.tone)}>{card.value}</p>
              <p className="text-[9px] font-mono opacity-60 mt-1">{card.sub}</p>
            </div>
          ))}
        </div>
      )}

      <PricingInfoModal
        open={infoOpen}
        title="ICMS entre estados — como funciona?"
        body={
          resultado
            ? [
                '**Resumo**',
                '• Simula compra interestadual: alíquota na NF, diferença para a UF de destino e DIFAL (Portal Nacional SVRS / CONFAZ).',
                `• Catálogo v${catalogo.versao} · ${catalogo.atualizadoEm}.`,
                '',
                '**Interestadual**',
                `• ${resultado.fundamentoInterestadual}`,
                '',
                '**DIFAL**',
                `• ${resultado.fundamentoDifal}`,
                ...(resultado.avisos.length > 0
                  ? ['', '**Avisos**', ...resultado.avisos.map((a) => `• ${a}`)]
                  : []),
              ].join('\n')
            : [
                '**Resumo**',
                '• Simula compra interestadual: alíquota na NF, diferença para a UF de destino e DIFAL (Portal Nacional SVRS / CONFAZ).',
                `• Catálogo v${catalogo.versao} · ${catalogo.atualizadoEm}.`,
                '',
                '**Interestadual**',
                '• Escolha UF origem/destino, valor e parâmetros da operação.',
                '',
                '**DIFAL**',
                '• O sistema calcula a diferença de alíquota e o valor estimado sobre a base informada.',
              ].join('\n')
        }
        onClose={() => setInfoOpen(false)}
      />

    </div>
  );
}
