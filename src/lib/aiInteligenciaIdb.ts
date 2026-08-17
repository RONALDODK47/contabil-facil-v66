/**
 * Textos longos + store completo da inteligência da IA — MEMÓRIA ZERO WRITES.
 */
const idbDocTextsMemory = new Map<string, { id: string; companySlug: string; texto: string }>();
const idbInteligenciaMemory = new Map<string, { companySlug: string; payload: string; updatedAt: string }>();

export async function idbPutDocText(
  companySlug: string,
  docId: string,
  texto: string,
): Promise<void> {
  const key = `${companySlug}::${docId}`;
  idbDocTextsMemory.set(key, {
    id: key,
    companySlug,
    texto,
  });
}

export async function idbGetDocText(companySlug: string, docId: string): Promise<string> {
  const key = `${companySlug}::${docId}`;
  return idbDocTextsMemory.get(key)?.texto ?? '';
}

export async function idbGetAllDocTexts(
  companySlug: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const [key, val] of idbDocTextsMemory.entries()) {
    if (val.companySlug === companySlug) {
      const docId = key.includes('::') ? key.split('::').slice(1).join('::') : key;
      map.set(docId, val.texto);
    }
  }
  return map;
}

export async function idbExportAllDocTexts(): Promise<
  Array<{ companySlug: string; docId: string; texto: string }>
> {
  const out: Array<{ companySlug: string; docId: string; texto: string }> = [];
  for (const [key, val] of idbDocTextsMemory.entries()) {
    const docId = key.includes('::') ? key.split('::').slice(1).join('::') : key;
    out.push({ companySlug: val.companySlug, docId, texto: val.texto });
  }
  return out;
}

export async function idbDeleteDocText(companySlug: string, docId: string): Promise<void> {
  const key = `${companySlug}::${docId}`;
  idbDocTextsMemory.delete(key);
}

/** Grava o store completo (lista de docs) no IndexedDB — MEMÓRIA. */
export async function idbPutInteligenciaStore(
  companySlug: string,
  payloadJson: string,
): Promise<void> {
  idbInteligenciaMemory.set(companySlug, {
    companySlug,
    payload: payloadJson,
    updatedAt: new Date().toISOString(),
  });
}

export async function idbGetInteligenciaStore(companySlug: string): Promise<string | null> {
  return idbInteligenciaMemory.get(companySlug)?.payload ?? null;
}

/** Exporta todos os stores de inteligência (lista de docs por empresa). */
export async function idbExportAllInteligenciaStores(): Promise<
  Array<{ companySlug: string; payload: string; updatedAt: string }>
> {
  const out: Array<{ companySlug: string; payload: string; updatedAt: string }> = [];
  for (const val of idbInteligenciaMemory.values()) {
    out.push({ companySlug: val.companySlug, payload: val.payload, updatedAt: val.updatedAt });
  }
  return out;
}
