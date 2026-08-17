let pushScheduler: (() => void) | null = null;
let flushHandler: ((options?: { force?: boolean }) => Promise<void>) | null = null;

export function registerEyeVisionCloudPushHandlers(handlers: {
  schedule: () => void;
  flush: (options?: { force?: boolean }) => Promise<void>;
}): void {
  pushScheduler = handlers.schedule;
  flushHandler = handlers.flush;
}

export function scheduleEyeVisionCloudPush(): void {
  pushScheduler?.();
}

export async function flushEyeVisionCloudPushSafe(options?: { force?: boolean }): Promise<void> {
  if (flushHandler) await flushHandler(options);
}
