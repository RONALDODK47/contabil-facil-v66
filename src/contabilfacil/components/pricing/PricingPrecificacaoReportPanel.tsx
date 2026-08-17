import { useMemo, useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { downloadPricingCalculationReportPdf } from '../../../lib/pricingPdfExporter';
import { cn, formatCurrency } from '../../lib/utils';
import {
  buildGlobalPricingReportIntro,
  buildPricingProductReport,
  type PricingProductReport,
} from '../../logic/pricingReport';
import type { GlobalPricingSettings, PricingBreakdown, PricingWorkspace } from '../../logic/pricingTypes';

const reportFmt = {
  money: (n: number) => formatCurrency(n),
  qty: (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2)),
  pct: (n: number) => `${n.toFixed(1)}%`,
};

type PricingPrecificacaoReportPanelProps = {
  companyName: string;
  breakdowns: PricingBreakdown[];
  workspace: PricingWorkspace;
  settings: GlobalPricingSettings;
};

function ReportSectionBlock({ section }: { section: PricingProductReport['sections'][number] }) {
  return (
    <div className="border border-brand-border/20 rounded-sm overflow-hidden">
      <div className="px-3 py-1.5 bg-brand-sidebar/30 border-b border-brand-border/15">
        <h4 className="text-[9px] font-black uppercase tracking-wide">{section.title}</h4>
      </div>
      <div className="divide-y divide-brand-border/10">
        {section.lines.map((row, i) => (
          <dl
            key={`${section.title}-${i}`}
            className="grid grid-cols-1 sm:grid-cols-[minmax(10rem,1fr)_minmax(6rem,auto)] gap-x-4 gap-y-0.5 px-3 py-2"
          >
            <dt className="text-[9px] font-bold uppercase opacity-60 leading-snug">{row.label}</dt>
            <dd className="text-[10px] font-mono font-bold text-right tabular-nums">{row.value}</dd>
            {row.formula ? (
              <dd className="sm:col-span-2 text-[8px] font-mono opacity-50 leading-tight">
                {row.formula}
              </dd>
            ) : null}
          </dl>
        ))}
      </div>
    </div>
  );
}

export default function PricingPrecificacaoReportPanel({
  companyName,
  breakdowns,
  workspace,
  settings,
}: PricingPrecificacaoReportPanelProps) {
  const reports = useMemo(
    () => breakdowns.map((b) => buildPricingProductReport(b, workspace, reportFmt)),
    [breakdowns, workspace],
  );

  const globalIntro = useMemo(
    () => buildGlobalPricingReportIntro(settings, reportFmt),
    [settings],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const activeId = selectedId ?? reports[0]?.productId ?? null;
  const activeReport = reports.find((r) => r.productId === activeId) ?? null;

  if (reports.length === 0) {
    return (
      <div className="technical-panel p-12 text-center shadow-[3px_3px_0_0_#141414]">
        <FileText className="mx-auto mb-3 opacity-30" size={32} />
        <p className="text-[10px] font-bold uppercase text-slate-400">
          Cadastre produtos e custos/despesas para ver o relatório de precificação.
        </p>
      </div>
    );
  }

  const handleExportPdf = () => {
    downloadPricingCalculationReportPdf({
      companyName,
      globalIntro,
      productReports: reports,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[9px] font-bold uppercase opacity-55 leading-relaxed max-w-3xl">
          Passo a passo de como cada valor da tabela foi calculado: qtd/mês, custo unitário, preço,
          projeção do mês e meta sem prejuízo.
        </p>
        <button
          type="button"
          onClick={handleExportPdf}
          disabled={reports.length === 0}
          className="technical-button-primary text-[9px] py-1.5 px-3 flex items-center gap-1.5 shrink-0 disabled:opacity-40"
        >
          <Download size={12} />
          Exportar PDF
        </button>
      </div>

      <ReportSectionBlock section={globalIntro} />

      {reports.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {reports.map((r) => (
            <button
              key={r.productId}
              type="button"
              onClick={() => setSelectedId(r.productId)}
              className={cn(
                'px-3 py-1 text-[9px] font-bold uppercase border',
                activeId === r.productId
                  ? 'bg-brand-border text-brand-bg border-brand-border'
                  : 'border-brand-border/30',
              )}
            >
              {r.productName}
            </button>
          ))}
        </div>
      ) : null}

      {activeReport ? (
        <div className="technical-panel shadow-[3px_3px_0_0_#141414] overflow-hidden">
          <div className="px-4 py-3 border-b border-brand-border/20 bg-brand-sidebar/20 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h3 className="text-[11px] font-black uppercase">{activeReport.productName}</h3>
              <p className="text-[9px] font-bold uppercase opacity-50">{activeReport.segmentLabel}</p>
            </div>
          </div>
          <div className="p-4 space-y-4 max-h-[min(70vh,720px)] overflow-y-auto">
            {activeReport.sections.map((section) => (
              <ReportSectionBlock key={section.title} section={section} />
            ))}
          </div>
        </div>
      ) : null}

      {reports.length > 1 ? (
        <details className="technical-panel shadow-[3px_3px_0_0_#141414]">
          <summary className="px-4 py-2 text-[9px] font-black uppercase cursor-pointer select-none border-b border-brand-border/15">
            Ver todos os produtos ({reports.length})
          </summary>
          <div className="p-4 space-y-6 max-h-[min(60vh,600px)] overflow-y-auto">
            {reports
              .filter((r) => r.productId !== activeId)
              .map((r) => (
                <div key={r.productId} className="space-y-3">
                  <h3 className="text-[10px] font-black uppercase border-b border-brand-border/20 pb-1">
                    {r.productName}
                    <span className="opacity-50 font-bold ml-2">{r.segmentLabel}</span>
                  </h3>
                  {r.sections.map((section) => (
                    <ReportSectionBlock key={`${r.productId}-${section.title}`} section={section} />
                  ))}
                </div>
              ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
