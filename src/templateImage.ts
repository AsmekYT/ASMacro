export function encodeTemplate(c: HTMLCanvasElement): string {
  const webp = c.toDataURL('image/webp', 1);
  return webp.startsWith('data:image/webp') ? webp : c.toDataURL('image/png');
}

export async function shrinkImage(dataUrl: string): Promise<string> {
  if (dataUrl.startsWith('data:image/webp')) return dataUrl;
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext('2d')?.drawImage(img, 0, 0);
  const enc = encodeTemplate(c);
  return enc.length < dataUrl.length || !/^data:image\/(png|jpeg);/.test(dataUrl) ? enc : dataUrl;
}

export async function fileToTemplate(file: File): Promise<string> {
  const orig = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  return shrinkImage(orig);
}

export async function shrinkAssets(
  assets: Record<string, string>,
  shrink = shrinkImage,
): Promise<boolean> {
  let changed = false;
  for (const [k, v] of Object.entries(assets)) {
    try {
      const out = await shrink(v);
      if (out !== v) {
        assets[k] = out;
        changed = true;
      }
    } catch (e) {
      console.error('template shrink failed', k, e);
    }
  }
  return changed;
}
