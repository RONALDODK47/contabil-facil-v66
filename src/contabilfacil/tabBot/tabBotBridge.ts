import type { BotTab, TabBotAutomationResult } from './tabBotTypes';
import { generateUUID } from '../../lib/uuid';

type TabBotModuleHandler = () => Promise<TabBotAutomationResult>;

const handlers = new Map<BotTab, TabBotModuleHandler>();
const BOT_TIMEOUT_MS = 180_000;

export function registerTabBotHandler(tab: BotTab, handler: TabBotModuleHandler): () => void {
  handlers.set(tab, handler);
  return () => {
    if (handlers.get(tab) === handler) handlers.delete(tab);
  };
}

/** Dispara automação nativa da aba (sem IA). */
export async function runTabBotAutomation(tab: BotTab): Promise<TabBotAutomationResult> {
  const direct = handlers.get(tab);
  if (direct) return direct();

  return invokeModuleBotEvent(tab);
}

function invokeModuleBotEvent(tab: BotTab): Promise<TabBotAutomationResult> {
  return new Promise((resolve, reject) => {
    const id = generateUUID();
    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; result: TabBotAutomationResult }>).detail;
      if (detail?.id !== id) return;
      window.removeEventListener('contabilfacil-tab-bot-result', onResult);
      clearTimeout(timer);
      resolve(detail.result);
    };

    const timer = window.setTimeout(() => {
      window.removeEventListener('contabilfacil-tab-bot-result', onResult);
      reject(new Error(`Bot da aba "${tab}" não respondeu — abra a subaba correta e tente de novo.`));
    }, BOT_TIMEOUT_MS);

    window.addEventListener('contabilfacil-tab-bot-result', onResult);
    window.dispatchEvent(
      new CustomEvent('contabilfacil-tab-bot-run', { detail: { tab, id } }),
    );
  });
}

/** Módulos escutam este evento e respondem com contabilfacil-tab-bot-result. */
export function emitTabBotResult(id: string, result: TabBotAutomationResult): void {
  window.dispatchEvent(
    new CustomEvent('contabilfacil-tab-bot-result', { detail: { id, result } }),
  );
}
