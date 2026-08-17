/**
 * Health-checks fiscais leves — montados no agent-api (Render) para o frontend em GitHub Pages.
 * Rotas completas de SPED/SEFAZ continuam no fiscal-nfe-api local (porta 8780).
 */
export function registerFiscalHealthStubs(app) {
  app.get('/receita-federal/health', (_req, res) => {
    res.status(200).json({
      ok: true,
      service: 'receita-federal-regras',
      mode: 'stub',
      mensagem: 'Health via agent-api; operações completas exigem fiscal-api local ou futuro deploy.',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/sefaz/icms/health', (_req, res) => {
    res.status(200).json({
      ok: true,
      service: 'sefaz-icms',
      mode: 'stub',
      svrsPortalAcessivel: false,
      confazAcessivel: false,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/sped/health', (_req, res) => {
    res.status(200).json({
      ok: true,
      service: 'sped-receita-api',
      mode: 'stub',
      docDownloaderPython: false,
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/health', (_req, res) => {
    res.status(200).json({
      ok: true,
      service: 'fiscal-api-stub',
      timestamp: new Date().toISOString(),
    });
  });
}
