import React, { useState } from 'react';

/* ────────────────────────────────────────────────────────────
   Dados de demo baseados na imagem real do extrato BB
   ──────────────────────────────────────────────────────────── */
const DEMO_ROWS = [
  { dia: '30/04/2026', lote: '',      doc: '',               historico: 'Saldo Anterior',                                                            valor: '0,00',       cd: 'N' },
  { dia: '04/05/2026', lote: '14397', doc: '10903125172831', historico: 'Pix - Recebido\n01/05 09:03 55802389168 JOSE ANTONIO D',                valor: '500,00',     cd: 'C' },
  { dia: '04/05/2026', lote: '14397', doc: '11106073834502', historico: 'Pix - Recebido\n01/05 11:06 00000076832198 MARIA JOSE',                  valor: '183,00',     cd: 'C' },
  { dia: '04/05/2026', lote: '14397', doc: '20727051520951', historico: 'Pix - Recebido\n02/05 07:27 05534688122 Thayne Luana d',                 valor: '10,00',      cd: 'C' },
  { dia: '04/05/2026', lote: '14397', doc: '31735022929881', historico: 'Pix - Recebido\n03/05 17:35 00308890140 Joziany Carnei',                 valor: '30,00',      cd: 'C' },
  { dia: '04/05/2026', lote: '14397', doc: '40828275961782', historico: 'Pix - Recebido\n04/05 08:28 00052032370182 DIVINO ANGE',                 valor: '325,00',     cd: 'C' },
  { dia: '04/05/2026', lote: '14397', doc: '40921318948591', historico: 'Pix - Recebido\n04/05 09:21 48693480634 EDEVALDO VALEN',                 valor: '1.339,00',   cd: 'C' },
  { dia: '04/05/2026', lote: '14397', doc: '42007482867732', historico: 'Pix - Recebido\n04/05 20:07 00057726760168 MARIA RODRI',                 valor: '3.000,00',   cd: 'C' },
  { dia: '04/05/2026', lote: '14397', doc: '55391028374650', historico: 'Pagamento de Boleto\nVENCTO 04/05 AGUA LIMPA SERV',                      valor: '250,00',     cd: 'D' },
];

/* ────────────────────────────────────────────────────────────
   Sub-componente: Caixinha branca de redacao
   ──────────────────────────────────────────────────────────── */
const WhiteTag: React.FC<{ width?: string; inline?: boolean }> = ({ width = '120px', inline = false }) => (
  <span
    style={{
      display: inline ? 'inline-block' : 'block',
      width,
      height: '14px',
      background: 'white',
      border: '1.5px solid #e0e0e0',
      borderRadius: '3px',
      verticalAlign: 'middle',
      boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    }}
  />
);

/* ────────────────────────────────────────────────────────────
   Estilos compartilhados
   ──────────────────────────────────────────────────────────── */
const thStyle: React.CSSProperties = {
  padding: '6px 8px',
  fontWeight: 700,
  fontSize: 11,
  color: '#555',
  borderBottom: '2px solid #d0d8e8',
  textAlign: 'left',
  background: '#e8eef8',
};

const tdStyle: React.CSSProperties = {
  padding: '5px 8px',
  verticalAlign: 'top',
  fontSize: 11,
  lineHeight: 1.4,
};

/* ────────────────────────────────────────────────────────────
   Coluna esquerda: extrato original
   ──────────────────────────────────────────────────────────── */
const ExtratoOriginal: React.FC = () => (
  <div style={{ fontFamily: 'Arial, sans-serif', fontSize: '12px', color: '#222', background: '#fff' }}>
    {/* Header */}
    <div style={{ background: '#003399', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 44, height: 44, background: '#FFCC00', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <span style={{ fontSize: 20, fontWeight: 900, color: '#003399', letterSpacing: -2 }}>BB</span>
      </div>
      <div>
        <div style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>Extrato de Conta Corrente</div>
        <div style={{ color: '#FFCC00', fontWeight: 700, fontSize: 13 }}>
          Cliente &nbsp;<span style={{ color: '#FFCC00' }}>COMERCIAL FERNANDES LTDA</span>
        </div>
      </div>
    </div>
    <div style={{ background: '#003399', color: '#fff', textAlign: 'center', padding: '4px 0', fontSize: 12, borderTop: '1px solid #1a4a99' }}>
      Agencia: 43-4 &nbsp;&nbsp; Conta: 20027-1
    </div>

    {/* Tabela */}
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ background: '#e8eef8' }}>
          <th style={thStyle}>Dia</th>
          <th style={thStyle}>Lote</th>
          <th style={{ ...thStyle, color: '#1a56a0' }}>Documento</th>
          <th style={thStyle}>Historico</th>
          <th style={{ ...thStyle, textAlign: 'right' }}>Valor</th>
        </tr>
      </thead>
      <tbody>
        {DEMO_ROWS.map((r, i) => (
          <tr key={i} style={{ borderBottom: '1px solid #e8e8e8', background: i % 2 === 0 ? '#fff' : '#f7f9fc' }}>
            <td style={tdStyle}>{r.dia}</td>
            <td style={{ ...tdStyle, color: '#1a56a0' }}>{r.lote}</td>
            <td style={{ ...tdStyle, color: '#1a56a0' }}>{r.doc}</td>
            <td style={tdStyle}>
              {r.historico.split('\n').map((line, li) => (
                <div key={li}>{line}</div>
              ))}
            </td>
            <td style={{ ...tdStyle, textAlign: 'right', color: r.cd === 'D' ? '#cc0000' : '#222' }}>
              {r.valor} {r.cd === 'C' ? '(+)' : r.cd === 'D' ? '(-)' : ''}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/* ────────────────────────────────────────────────────────────
   Coluna direita: extrato com redacoes (white tags)
   ──────────────────────────────────────────────────────────── */
const ExtratoRedacted: React.FC = () => (
  <div style={{ fontFamily: 'Arial, sans-serif', fontSize: '12px', color: '#222', background: '#fff' }}>
    {/* Header */}
    <div style={{ background: '#003399', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 44, height: 44, background: '#FFCC00', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <span style={{ fontSize: 20, fontWeight: 900, color: '#003399', letterSpacing: -2 }}>BB</span>
      </div>
      <div>
        <div style={{ color: '#fff', fontWeight: 700, fontSize: 14 }}>Extrato de Conta Corrente</div>
        <div style={{ color: '#FFCC00', fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
          Cliente &nbsp;<WhiteTag width="160px" inline />
        </div>
      </div>
    </div>
    {/* Agencia/Conta redacted */}
    <div style={{ background: '#003399', color: '#fff', textAlign: 'center', padding: '4px 0', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, borderTop: '1px solid #1a4a99' }}>
      Agencia: <WhiteTag width="40px" inline /> &nbsp;&nbsp; Conta: <WhiteTag width="55px" inline />
    </div>

    {/* Tabela */}
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ background: '#e8eef8' }}>
          <th style={thStyle}>Dia</th>
          <th style={thStyle}>Lote</th>
          <th style={{ ...thStyle, color: '#1a56a0' }}>Documento</th>
          <th style={thStyle}>Historico</th>
          <th style={{ ...thStyle, textAlign: 'right' }}>Valor</th>
        </tr>
      </thead>
      <tbody>
        {DEMO_ROWS.map((r, i) => {
          const lines = r.historico.split('\n');
          return (
            <tr key={i} style={{ borderBottom: '1px solid #e8e8e8', background: i % 2 === 0 ? '#fff' : '#f7f9fc' }}>
              <td style={tdStyle}>{r.dia}</td>
              <td style={{ ...tdStyle, color: '#1a56a0' }}>{r.lote}</td>
              {/* Numero do documento sempre redacted */}
              <td style={tdStyle}>
                {r.doc ? <WhiteTag width="88px" /> : ''}
              </td>
              {/* Historico: linha 0 mantida, linha 1+ com CPF e nome redactados */}
              <td style={tdStyle}>
                {lines.map((line, li) => {
                  if (li === 0) return <div key={li}>{line}</div>;
                  const match = line.match(/^([\d/]+ [\d:]+) (\d+) (.+)$/);
                  if (match) {
                    return (
                      <div key={li} style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                        <span>{match[1]}</span>
                        <WhiteTag width="72px" inline />
                        <WhiteTag width="84px" inline />
                      </div>
                    );
                  }
                  return <div key={li}><WhiteTag width="140px" /></div>;
                })}
              </td>
              <td style={{ ...tdStyle, textAlign: 'right', color: r.cd === 'D' ? '#cc0000' : '#222' }}>
                {r.valor} {r.cd === 'C' ? '(+)' : r.cd === 'D' ? '(-)' : ''}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

/* ────────────────────────────────────────────────────────────
   Componente principal exportado
   ──────────────────────────────────────────────────────────── */
export const BBExtratoPreviewLayout: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'split' | 'original' | 'redacted'>('split');

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        borderRadius: 24,
        padding: 24,
        border: '1px solid rgba(59,130,246,0.2)',
        boxShadow: '0 25px 50px rgba(0,0,0,0.4)',
        overflow: 'hidden',
      }}
    >
      {/* Titulo */}
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 40, height: 40, borderRadius: 12,
              background: 'linear-gradient(135deg, #FFCC00, #FF9900)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, fontWeight: 900, color: '#003399',
              boxShadow: '0 4px 16px rgba(255,204,0,0.4)',
            }}
          >BB</div>
          <div>
            <div style={{ color: '#fff', fontWeight: 800, fontSize: 15, letterSpacing: '-0.5px' }}>
              Parser BB - Layout de Privacidade
            </div>
            <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>
              Dados sensiveis cobertos com <strong style={{ color: '#94a3b8' }}>tags brancas</strong> no extrato gerado
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 4, gap: 2 }}>
          {(['split', 'original', 'redacted'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                border: 'none',
                cursor: 'pointer',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.05em',
                background: activeTab === tab
                  ? (tab === 'original' ? '#1a56a0' : tab === 'redacted' ? '#059669' : 'rgba(255,255,255,0.12)')
                  : 'transparent',
                color: activeTab === tab ? '#fff' : '#64748b',
                transition: 'all 0.15s',
                textTransform: 'uppercase',
              }}
            >
              {tab === 'split' ? 'Lado a Lado' : tab === 'original' ? 'Original' : 'Protegido'}
            </button>
          ))}
        </div>
      </div>

      {/* Legenda */}
      {(activeTab === 'split' || activeTab === 'redacted') && (
        <div
          style={{
            background: 'rgba(5,150,105,0.1)',
            border: '1px solid rgba(5,150,105,0.3)',
            borderRadius: 10,
            padding: '8px 14px',
            marginBottom: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ color: '#10b981', fontWeight: 700, fontSize: 11 }}>REDACOES APLICADAS:</span>
          {[
            'Nome do Cliente',
            'Agencia / Conta',
            'Numero do Documento',
            'CPF/CNPJ do Pix',
            'Nome do Pagador',
          ].map(label => (
            <span key={label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ display: 'inline-block', width: 28, height: 10, background: 'white', borderRadius: 2, border: '1px solid #ddd' }} />
              <span style={{ color: '#94a3b8', fontSize: 10, fontWeight: 600 }}>{label}</span>
            </span>
          ))}
        </div>
      )}

      {/* Conteudo das abas */}
      <div style={{ overflowX: 'auto' }}>
        {activeTab === 'split' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 900 }}>
            {/* Coluna Original */}
            <div>
              <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  background: '#1a56a0', color: '#fff', fontSize: 10, fontWeight: 800,
                  padding: '3px 10px', borderRadius: 20, letterSpacing: '0.08em', textTransform: 'uppercase',
                }}>Original</span>
                <span style={{ color: '#475569', fontSize: 10 }}>Extrato padrao Banco do Brasil</span>
              </div>
              <div style={{ borderRadius: 12, overflow: 'hidden', border: '2px solid #1a56a0', boxShadow: '0 8px 24px rgba(26,86,160,0.2)' }}>
                <ExtratoOriginal />
              </div>
            </div>

            {/* Coluna Redactada */}
            <div>
              <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  background: '#059669', color: '#fff', fontSize: 10, fontWeight: 800,
                  padding: '3px 10px', borderRadius: 20, letterSpacing: '0.08em', textTransform: 'uppercase',
                }}>Protegido</span>
                <span style={{ color: '#475569', fontSize: 10 }}>Novo parser com tags brancas</span>
              </div>
              <div style={{ borderRadius: 12, overflow: 'hidden', border: '2px solid #059669', boxShadow: '0 8px 24px rgba(5,150,105,0.2)' }}>
                <ExtratoRedacted />
              </div>
            </div>
          </div>
        )}

        {activeTab === 'original' && (
          <div style={{ borderRadius: 12, overflow: 'hidden', border: '2px solid #1a56a0' }}>
            <ExtratoOriginal />
          </div>
        )}

        {activeTab === 'redacted' && (
          <div style={{ borderRadius: 12, overflow: 'hidden', border: '2px solid #059669' }}>
            <ExtratoRedacted />
          </div>
        )}
      </div>

      {/* Rodape informativo */}
      <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{
          background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)',
          color: '#60a5fa', fontSize: 10, padding: '4px 10px', borderRadius: 20, fontWeight: 600,
        }}>
          Este layout reflete o que o parser gera no canvas do PDF ao processar um extrato BB real
        </span>
        <span style={{
          background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.2)',
          color: '#fbbf24', fontSize: 10, padding: '4px 10px', borderRadius: 20, fontWeight: 600,
        }}>
          Redacoes aplicadas automaticamente no canvas durante o processamento
        </span>
      </div>
    </div>
  );
};

export default BBExtratoPreviewLayout;
