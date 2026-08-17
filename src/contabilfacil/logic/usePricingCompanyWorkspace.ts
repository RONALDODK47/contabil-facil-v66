import { useCallback, useEffect, useMemo, useState } from 'react';
import { createCompanyRecord, normalizeCompanyName, type CompanyRecord } from './companyWorkspace';
import {
  deletePricingCompanyInStorage,
  renamePricingCompanyInStorage,
  resolvePricingSelectedCompany,
  savePricingCompaniesRegistry,
  savePricingSelectedCompanyName,
  syncPricingCompanyRegistry,
} from './pricingCompanyWorkspace';

export function usePricingCompanyWorkspace() {
  const [companies, setCompanies] = useState<CompanyRecord[]>([]);
  const [selectedCompany, setSelectedCompanyState] = useState('');
  const [workspaceVersion, setWorkspaceVersion] = useState(0);

  const refreshCompanies = useCallback(() => {
    let synced = syncPricingCompanyRegistry();
    if (synced.length === 0) {
      synced = [createCompanyRecord('SINDICATO')];
      savePricingCompaniesRegistry(synced);
    }
    const selected = resolvePricingSelectedCompany(synced);
    savePricingSelectedCompanyName(selected);
    setCompanies(synced);
    setSelectedCompanyState(selected);
    setWorkspaceVersion((v) => v + 1);
    return selected;
  }, []);

  useEffect(() => {
    refreshCompanies();
    const onHydrated = () => refreshCompanies();
    window.addEventListener('contabilfacil:data-hydrated', onHydrated);
    return () => window.removeEventListener('contabilfacil:data-hydrated', onHydrated);
  }, [refreshCompanies]);

  const setSelectedCompany = useCallback((name: string) => {
    const normalized = normalizeCompanyName(name);
    savePricingSelectedCompanyName(normalized);
    setSelectedCompanyState(normalized);
    setWorkspaceVersion((v) => v + 1);
  }, []);

  const createCompany = useCallback(
    (name: string) => {
      const normalized = normalizeCompanyName(name);
      if (!normalized || normalized === 'SEM EMPRESA') return null;

      const nextRecord = createCompanyRecord(normalized);
      setCompanies((prev) => {
        if (prev.some((c) => c.name === normalized)) return prev;
        const next = [...prev, nextRecord].sort((a, b) =>
          a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }),
        );
        savePricingCompaniesRegistry(next);
        return next;
      });
      setSelectedCompany(normalized);
      return normalized;
    },
    [setSelectedCompany],
  );

  const renameCompany = useCallback(
    (currentName: string, nextName: string) => {
      const normalized = normalizeCompanyName(nextName);
      if (!normalized || normalized === 'SEM EMPRESA') return false;
      if (normalizeCompanyName(currentName) === normalized) return true;

      const ok = renamePricingCompanyInStorage(currentName, normalized);
      if (!ok) return false;

      refreshCompanies();
      setSelectedCompany(normalized);
      return true;
    },
    [refreshCompanies, setSelectedCompany],
  );

  const deleteCompany = useCallback(
    (name: string) => {
      const ok = deletePricingCompanyInStorage(name);
      if (!ok) return false;
      refreshCompanies();
      return true;
    },
    [refreshCompanies],
  );

  const companyOptions = useMemo(
    () => companies.map((c) => c.name).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })),
    [companies],
  );

  return {
    companies,
    companyOptions,
    selectedCompany,
    setSelectedCompany,
    createCompany,
    renameCompany,
    deleteCompany,
    refreshCompanies,
    workspaceVersion,
  };
}
