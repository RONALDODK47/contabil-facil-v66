export default function GestaoPagePlaceholder({ title }: { title: string }) {
  return (
    <div className="technical-panel p-6">
      <h2 className="text-lg font-black uppercase">{title}</h2>
      <p className="mt-2 text-xs opacity-70 leading-relaxed">
        Esta página da Gestão Contábil não está disponível nesta instalação local.
      </p>
    </div>
  );
}
