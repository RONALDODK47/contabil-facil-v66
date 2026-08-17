import { Folder } from 'lucide-react';
import type { LoanAccountFields } from '../types';
import { CF_FIELD_COL, CF_FIELD_ROW, CF_ACCOUNT_REDUCED_PLACEHOLDER } from '../lib/formFieldClasses';
import ExtratoContaPicker, { type ExtratoPlanoContaOption } from './ExtratoContaPicker';

export interface LoanAccountsSectionProps {
  values: LoanAccountFields;
  onChange: (patch: Partial<LoanAccountFields>) => void;
  /** Plano de contas da empresa — habilita o select com busca (igual à conciliação). */
  planoContaOptions?: ExtratoPlanoContaOption[];
}

interface AccountPairConfig {
  title: string;
  description?: string;
  debitKey: keyof LoanAccountFields;
  creditKey: keyof LoanAccountFields;
  debitPlaceholder: string;
  creditPlaceholder: string;
}

const ACCOUNT_PAIRS: AccountPairConfig[] = [
  {
    title: 'Conta do Empréstimo (principal)',
    description: 'Lançamento inicial do contrato: valor do principal financiado.',
    debitKey: 'accEmprestimoDebit',
    creditKey: 'accEmprestimoCredit',
    debitPlaceholder: CF_ACCOUNT_REDUCED_PLACEHOLDER,
    creditPlaceholder: CF_ACCOUNT_REDUCED_PLACEHOLDER,
  },
  {
    title: 'Provisão Juros a Apropriar (1º dia do mês)',
    debitKey: 'accJurosAproDebit',
    creditKey: 'accJurosAproCredit',
    debitPlaceholder: CF_ACCOUNT_REDUCED_PLACEHOLDER,
    creditPlaceholder: CF_ACCOUNT_REDUCED_PLACEHOLDER,
  },
  {
    title: 'Apropriação de Juros (último dia)',
    debitKey: 'accApropriacaoDebit',
    creditKey: 'accApropriacaoCredit',
    debitPlaceholder: CF_ACCOUNT_REDUCED_PLACEHOLDER,
    creditPlaceholder: CF_ACCOUNT_REDUCED_PLACEHOLDER,
  },
  {
    title: 'Transferência LP p/ CP (contrato + mensal)',
    description:
      'Na data do contrato (modo fiscal): transferência LP→CP com Curto − IOF e lançamento de saldo em longo prazo. Nas parcelas, reclassificação mensal (1º dia do mês seguinte).',
    debitKey: 'accTransferenciaDebit',
    creditKey: 'accTransferenciaCredit',
    debitPlaceholder: CF_ACCOUNT_REDUCED_PLACEHOLDER,
    creditPlaceholder: CF_ACCOUNT_REDUCED_PLACEHOLDER,
  },
  {
    title: 'Mês Não Pago — Transferência CP → LP',
    description:
      'Quando uma parcela não é paga no vencimento, o valor da parcela bruta é reclassificado do curto prazo para o longo prazo (débito LP / crédito CP).',
    debitKey: 'accNaoPagoDebit',
    creditKey: 'accNaoPagoCredit',
    debitPlaceholder: CF_ACCOUNT_REDUCED_PLACEHOLDER,
    creditPlaceholder: CF_ACCOUNT_REDUCED_PLACEHOLDER,
  },
  {
    title: 'Pagamento Atrasado — Retorno LP → CP',
    description:
      'Quando um pagamento atrasado é registrado, o valor efetivamente pago retorna do longo prazo para o curto prazo e quita apenas essa parte. Parcelas não cobertas continuam em atraso e mantêm o saldo devido.',
    debitKey: 'accAtrasadoPagoDebit',
    creditKey: 'accAtrasadoPagoCredit',
    debitPlaceholder: CF_ACCOUNT_REDUCED_PLACEHOLDER,
    creditPlaceholder: CF_ACCOUNT_REDUCED_PLACEHOLDER,
  },
];

function AccountPairRow({
  config,
  values,
  onChange,
  planoContaOptions,
}: {
  config: AccountPairConfig;
  values: LoanAccountFields;
  onChange: (patch: Partial<LoanAccountFields>) => void;
  planoContaOptions: ExtratoPlanoContaOption[];
}) {
  return (
    <div className="space-y-2">
      <h4 className="text-[10px] font-black uppercase tracking-widest">{config.title}</h4>
      {config.description ? (
        <p className="text-[10px] opacity-50 leading-snug">{config.description}</p>
      ) : null}
      <div className={CF_FIELD_ROW}>
        <div className={CF_FIELD_COL}>
          <label className="text-[9px] font-black uppercase opacity-60 mb-1 block">Débito</label>
          <ExtratoContaPicker
            ariaLabel={`Conta débito - ${config.title}`}
            placeholder={config.debitPlaceholder}
            options={planoContaOptions}
            value={values[config.debitKey]}
            onChange={(code) => onChange({ [config.debitKey]: code })}
          />
        </div>
        <div className={CF_FIELD_COL}>
          <label className="text-[9px] font-black uppercase opacity-60 mb-1 block">Crédito</label>
          <ExtratoContaPicker
            ariaLabel={`Conta crédito - ${config.title}`}
            placeholder={config.creditPlaceholder}
            options={planoContaOptions}
            value={values[config.creditKey]}
            onChange={(code) => onChange({ [config.creditKey]: code })}
          />
        </div>
      </div>
    </div>
  );
}

export function LoanAccountsSection({ values, onChange, planoContaOptions = [] }: LoanAccountsSectionProps) {
  return (
    <section className="technical-panel p-6 shadow-[4px_4px_0_0_#141414] space-y-6">
      <div className="flex items-center gap-2 border-b border-brand-border pb-3">
        <Folder className="w-4 h-4 shrink-0" />
        <h3 className="text-[10px] font-black uppercase tracking-widest">Contas Contábeis (Domínio)</h3>
      </div>

      <p className="text-[10px] opacity-50 leading-snug">
        Informe débito e crédito por tipo de lançamento. No dia do contrato, o TXT gera classificação CPC:
        transferência LP→CP e saldo longo prazo. Depois, reclasses mensais.
      </p>

      <div className="space-y-5">
        {ACCOUNT_PAIRS.map((config) => (
          <AccountPairRow
            key={config.title}
            config={config}
            values={values}
            onChange={onChange}
            planoContaOptions={planoContaOptions}
          />
        ))}
      </div>
    </section>
  );
}
