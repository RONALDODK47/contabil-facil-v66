/** Gera TXT no layout Domínio para testes de importação (plano + razão). */

export function buildDominioPlanoTxt(): string {
  const linhas = [
    linhaPlano('0000101', '1101020002', 'CAIXA GERAL', 'A'),
    linhaPlano('0000102', '1101030001', 'BANCO CONTA MOVIMENTO', 'S'),
    linhaPlano('0000103', '1101030002', 'BANCO XYZ', 'A'),
    linhaPlano('0000201', '2101010001', 'FORNECEDORES NACIONAIS', 'A'),
    linhaPlano('0000301', '3101010001', 'RECEITA DE VENDAS', 'A'),
    linhaPlano('0000401', '4101010001', 'DESPESAS ADMINISTRATIVAS', 'A'),
  ];
  return linhas.join('\r\n');
}

function linhaPlano(reduzido: string, codigo: string, nome: string, tipo: 'S' | 'A'): string {
  const r = reduzido.padStart(7, '0').slice(0, 7);
  const cField = codigo.replace(/\D/g, '').padStart(12, '0').padEnd(19, ' ');
  const n = nome.padEnd(40, ' ').slice(0, 40);
  return `${r}${cField}${n}${tipo}`;
}

export function buildDominioRazaoTxt(qtdLancamentos = 420): string {
  const out: string[] = ['010000001LANCAMENTOS'];
  const meses = [
    '31/01/2025',
    '28/02/2025',
    '31/03/2025',
    '30/04/2025',
    '31/05/2025',
    '30/06/2025',
    '31/07/2025',
    '31/08/2025',
    '30/09/2025',
    '31/10/2025',
    '30/11/2025',
    '31/12/2025',
  ];
  let seq = 1;
  for (let i = 0; i < qtdLancamentos; i++) {
    const mes = meses[i % meses.length];
    if (i % 35 === 0) {
      out.push(`02${String(Math.floor(i / 35) + 1).padStart(7, '0')}V${mes}`);
    }
    const deb = i % 2 === 0 ? '0000101' : '0000103';
    const cred = i % 2 === 0 ? '0000201' : '0000301';
    const valor = 100 + (i % 50) * 17.13;
    out.push(linha03(seq++, deb, cred, valor, `LANCAMENTO QA ${i + 1} REF ${mes}`));
  }
  return out.join('\r\n');
}

function linha03(seq: number, deb: string, cred: string, valorReais: number, hist: string): string {
  const seq7 = String(seq).padStart(7, '0');
  const deb7 = deb.replace(/\D/g, '').padStart(7, '0').slice(-7);
  const cred7 = cred.replace(/\D/g, '').padStart(7, '0').slice(-7);
  const cents = Math.round(valorReais * 100);
  const intPart = String(cents).padStart(11, '0');
  const fracPart = '00000000000';
  const histPad = hist.padEnd(300, ' ').slice(0, 300);
  return `03${seq7}${deb7}${cred7}${intPart}${fracPart}${histPad}`;
}
