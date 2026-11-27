export function bindCheck(id: string, apply: (v: boolean) => void, persist: () => void) {
  (document.getElementById(id) as HTMLInputElement | null)?.addEventListener('change', e => {
    apply((e.target as HTMLInputElement).checked);
    persist();
  });
}

export function bindNumber(id: string, apply: (v: number) => void, persist: () => void) {
  (document.getElementById(id) as HTMLInputElement | null)?.addEventListener('change', e => {
    const v = Number((e.target as HTMLInputElement).value);
    if (!isNaN(v)) apply(v);
    persist();
  });
}

export function bindSelect(id: string, apply: (v: string) => void, persist: () => void) {
  (document.getElementById(id) as HTMLSelectElement | null)?.addEventListener('change', e => {
    apply((e.target as HTMLSelectElement).value);
    persist();
  });
}
