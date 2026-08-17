export default function TabLoadingFallback() {
  return (
    <div className="flex h-full min-h-[200px] items-center justify-center">
      <div className="flex flex-col items-center gap-2 opacity-60">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-border border-t-transparent" />
        <span className="text-[10px] font-mono font-bold uppercase tracking-wider">Carregando módulo…</span>
      </div>
    </div>
  );
}
