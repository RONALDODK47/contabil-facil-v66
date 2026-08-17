import React, { useState } from 'react';

import BalancetePeriodoModal, { type BalancetePeriodo } from './BalancetePeriodoModal';
import { postFolhaNoRazao } from '../logic/folhaAutomation';
import { readManagerData } from '../logic/companyWorkspace';
import { flushPersistenceAfterCriticalWrite } from '../logic/eyeVisionPersistenceFlush';
import type { FolhaRelatorioImportRow } from '../logic/dominioTxtIO';
import type { FolhaPayrollLinha } from '../logic/folhaToRazao';

type Props = {
  selectedCompany: string;
  onSynced?: () => void;
};

/** Configuração de contas da folha — importação só via recorte PDF na aba principal. */
export default function FolhaModule({ selectedCompany, onSynced }: Props) {
  const [periodoModalOpen, setPeriodoModalOpen] = useState(false);

  const handleMandarFolhaBalancete = () => {
    const relatorio = readManagerData<FolhaRelatorioImportRow>(selectedCompany, 'folhaRelatorio');
    const payroll = readManagerData<FolhaPayrollLinha>(selectedCompany, 'folha');
    if (relatorio.length === 0 && payroll.length === 0) {
      alert('Nenhum dado de folha importado para enviar ao balancete.');
      return;
    }
    setPeriodoModalOpen(true);
  };

  const handlePeriodoConfirmado = (periodo: BalancetePeriodo) => {
    setPeriodoModalOpen(false);
    try {
      const { gerados, pendencias } = postFolhaNoRazao(selectedCompany);
      void flushPersistenceAfterCriticalWrite();
      onSynced?.();
      if (pendencias.length && gerados <= 0) {
        alert(pendencias.slice(0, 5).join('\n'));
        return;
      }
      const periodoStr = `${periodo.dataInicio.split('-').reverse().join('/')} até ${periodo.dataFim.split('-').reverse().join('/')}`;
      alert(
        gerados > 0
          ? `${gerados} lançamento(s) da folha enviados ao balancete.\nPeríodo: ${periodoStr}\n\nAbra a aba Balancete para conferir.`
          : 'Nada novo para enviar — já estavam no balancete (ou configure as contas).',
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Falha ao enviar para o balancete.');
    }
  };

  return (
    <div className="space-y-4">

      <BalancetePeriodoModal
        isOpen={periodoModalOpen}
        onConfirm={handlePeriodoConfirmado}
        onCancel={() => setPeriodoModalOpen(false)}
      />
    </div>
  );
}
