/** Bloqueia sync cloud pesado enquanto conciliação/IA trabalha na main thread. */
let heavyWorkDepth = 0;

export function beginHeavyUiWork(): void {
  heavyWorkDepth += 1;
}

export function endHeavyUiWork(): void {
  const wasActive = heavyWorkDepth > 0;
  heavyWorkDepth = Math.max(0, heavyWorkDepth - 1);
  if (wasActive && heavyWorkDepth === 0) {
    void import('../logic/eyeVisionOperationalSave').then(({ scheduleEyeVisionOperationalSave }) => {
      scheduleEyeVisionOperationalSave(3500);
    });
  }
}

export function isHeavyUiWorkActive(): boolean {
  return heavyWorkDepth > 0;
}
