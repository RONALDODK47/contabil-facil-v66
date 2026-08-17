/**
 * Recados — tamanho fixo, rolagem interna e grade uniforme (Eye Vision).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'vendor/gestao-contabil/src/pages/Notices.jsx');

let code = fs.readFileSync(target, 'utf8');

if (code.includes('gestao-notice-card-fixed')) {
  console.info('[patch-notices] Já aplicado.');
  process.exit(0);
}

const oldGrid = `<div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 justify-items-center">`;

const newGrid = `<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">`;

const oldCard = `            <Card
              key={notice.id}
              className={cn(
                "w-full max-w-[20rem] sm:max-w-[18rem] aspect-square flex flex-col border-l-4 overflow-hidden",
                theme === "dark" ? cfg.darkBg : cfg.bg,
                notice.is_read ? "opacity-60" : ""
              )}
            >`;

const newCard = `            <Card
              key={notice.id}
              className={cn(
                "gestao-notice-card-fixed w-full h-[20rem] min-h-[20rem] max-h-[20rem] flex flex-col border border-brand-border overflow-hidden rounded-none shadow-none",
                gestaoNativeCard,
                theme === "dark" ? cfg.darkBg : cfg.bg,
                notice.is_read ? "opacity-60" : ""
              )}
            >`;

const oldBtn = `                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditDialog(notice)}>
                          <Pencil className="w-4 h-4 text-blue-500" />
                        </Button>
                        {!notice.is_read && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => markReadMutation.mutate(notice.id)}
                          >
                            <Check className="w-4 h-4 text-green-500" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => deleteMutation.mutate(notice.id)}>
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </Button>`;

const newBtn = `                        <Button variant="outline" size="icon" className="h-8 w-8 rounded-none border-brand-border shadow-none" onClick={() => openEditDialog(notice)}>
                          <Pencil className="w-4 h-4 text-blue-500" />
                        </Button>
                        {!notice.is_read && (
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-8 w-8 rounded-none border-brand-border shadow-none"
                            onClick={() => markReadMutation.mutate(notice.id)}
                          >
                            <Check className="w-4 h-4 text-green-500" />
                          </Button>
                        )}
                        <Button variant="outline" size="icon" className="h-8 w-8 rounded-none border-brand-border shadow-none" onClick={() => deleteMutation.mutate(notice.id)}>
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </Button>`;

const oldScroll = `                <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden rounded-sm pr-0.5 [scrollbar-gutter:stable]">`;

const newScroll = `                <div className="gestao-notice-card-body flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-1 [scrollbar-gutter:stable]">`;

if (!code.includes(oldGrid)) {
  console.error('[patch-notices] Grid não encontrado.');
  process.exit(1);
}

code = code
  .replace(oldGrid, newGrid)
  .replace(oldCard, newCard)
  .replace(oldBtn, newBtn)
  .replace(oldScroll, newScroll);

const hasImport = /import[\s\S]*?gestaoNativeCard[\s\S]*?GestaoEyeVisionChrome/.test(code);
if (!hasImport && code.includes('gestaoNativeCard')) {
  code = code.replace(
    /gestaoNativeMuted,\s*\n\} from "@\/components\/GestaoEyeVisionChrome";/,
    'gestaoNativeMuted,\n  gestaoNativeCard,\n} from "@/components/GestaoEyeVisionChrome";',
  );
}

fs.writeFileSync(target, code);
console.info('[patch-notices] Cards de recado padronizados.');
