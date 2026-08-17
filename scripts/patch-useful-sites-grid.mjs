/**
 * Grade única em Links Úteis — cards lado a lado (Eye Vision embed).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'vendor/gestao-contabil/src/pages/UsefulSites.jsx');

let code = fs.readFileSync(target, 'utf8');

const oldRender = `  const renderGrid = (list) => (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {list.map((site) => (
        <SiteCard
          key={site.id}
          site={site}
          currentUid={myUid}
          canEditOffice={canEditOfficeContent}
          onEdit={openEdit}
          onDelete={(id) => deleteMutation.mutate({ id })}
          isDeleting={
            deleteMutation.isPending && deleteMutation.variables && deleteMutation.variables.id === site.id
          }
        />
      ))}
    </div>
  );`;

const newRender = `  const sitesGridClass = "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4";

  const renderSiteCard = (site) => (
    <SiteCard
      key={site.id}
      site={site}
      currentUid={myUid}
      canEditOffice={canEditOfficeContent}
      onEdit={openEdit}
      onDelete={(id) => deleteMutation.mutate({ id })}
      isDeleting={
        deleteMutation.isPending && deleteMutation.variables && deleteMutation.variables.id === site.id
      }
    />
  );`;

const oldCats = `      {categories.length > 0 &&
        categories.map((cat) => (
          <div key={cat}>
            <h3 className={cn("mb-3", gestaoNativeMuted)}>
              {cat}
            </h3>
            {renderGrid(sites.filter((s) => s.category === cat))}
          </div>
        ))}

      {sites.filter((s) => !s.category).length > 0 && (
        <div>
          <h3 className={cn("mb-3", gestaoNativeMuted)}>Sem categoria</h3>
          {renderGrid(sites.filter((s) => !s.category))}
        </div>
      )}`;

const newCats = `      {sites.length > 0 && (
        <div className={sitesGridClass}>
          {categories.map((cat) => (
            <React.Fragment key={cat}>
              <h3 className={cn("col-span-full mb-1 mt-3 first:mt-0", gestaoNativeMuted)}>{cat}</h3>
              {sites.filter((s) => s.category === cat).map((site) => renderSiteCard(site))}
            </React.Fragment>
          ))}
          {sites.filter((s) => !s.category).length > 0 && (
            <React.Fragment key="__sem_categoria">
              <h3 className={cn("col-span-full mb-1 mt-3", gestaoNativeMuted)}>Sem categoria</h3>
              {sites.filter((s) => !s.category).map((site) => renderSiteCard(site))}
            </React.Fragment>
          )}
        </div>
      )}`;

if (!code.includes(oldRender)) {
  if (code.includes('sitesGridClass')) {
    console.info('[patch-useful-sites] Já aplicado.');
    process.exit(0);
  }
  console.error('[patch-useful-sites] Bloco renderGrid não encontrado.');
  process.exit(1);
}

if (!code.includes(oldCats)) {
  console.error('[patch-useful-sites] Bloco categorias não encontrado.');
  process.exit(1);
}

code = code.replace(oldRender, newRender).replace(oldCats, newCats);
fs.writeFileSync(target, code);
console.info('[patch-useful-sites] Grade unificada aplicada em UsefulSites.jsx');
