/** Props compartilhadas para troca de sindicato/empresa ativa nos módulos. */
export interface CompanyWorkspaceControls {
  selectedCompany: string;
  companyOptions: string[];
  onCompanyChange: (name: string) => void;
  onCreateCompany: (name: string) => string | null;
  onRenameCompany: (currentName: string, nextName: string) => boolean;
  onDeleteCompany?: (name: string) => boolean;
}
