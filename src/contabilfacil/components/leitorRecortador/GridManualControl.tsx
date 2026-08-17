/**
 * Slider + campo numérico + botões de ajuste fino (-1/+1) para os parâmetros
 * da grade manual (Início Y / Altura / Qtd). O slider dá ajuste rápido; o
 * campo numérico e os botões dão precisão exata em pixel.
 */
type GridManualControlProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  ariaLabel: string;
};

export function GridManualControl({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  ariaLabel,
}: GridManualControlProps) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[9px] font-bold uppercase">{label}</label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onChange(clamp(value - step))}
            className="technical-button w-5 h-5 flex items-center justify-center text-[10px] font-black leading-none"
            aria-label={`Diminuir ${label}`}
            title={`-${step}`}
          >
            −
          </button>
          <input
            type="number"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) onChange(clamp(n));
            }}
            className="w-16 text-right border border-brand-border px-1 py-0.5 text-[10px] font-mono font-bold"
            aria-label={`Valor exato de ${label} (px)`}
          />
          <button
            type="button"
            onClick={() => onChange(clamp(value + step))}
            className="technical-button w-5 h-5 flex items-center justify-center text-[10px] font-black leading-none"
            aria-label={`Aumentar ${label}`}
            title={`+${step}`}
          >
            +
          </button>
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        aria-label={ariaLabel}
      />
    </div>
  );
}
