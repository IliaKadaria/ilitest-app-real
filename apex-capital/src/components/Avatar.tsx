// Profile pictures: an uploaded photo (small JPEG data URL), one of the preset
// gradients ("p:0".."p:11"), or initials on brushed metal.

export const PRESETS = [
  ['#2b2d32', '#6b6f78'],
  ['#1d3b2f', '#4cc38a'],
  ['#3b1d20', '#e5484d'],
  ['#1d2a44', '#7aa7ff'],
  ['#3d3320', '#d6b26e'],
  ['#2d1f3d', '#b48cff'],
  ['#14343a', '#5ad1d1'],
  ['#3a2414', '#ff9a5a'],
  ['#222', '#e5e5e7'],
  ['#0f2a1f', '#9be15d'],
  ['#2a0f26', '#ff6fb5'],
  ['#101a33', '#3d7bff'],
];

export const initials = (name: string) =>
  name
    .replace(/[^A-Za-z0-9 ._-]/g, '')
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';

export function Avatar({ name, src, size = 40, online }: { name: string; src?: string; size?: number; online?: boolean }) {
  const preset = src?.startsWith('p:') ? PRESETS[Number(src.slice(2)) % PRESETS.length] : null;
  const photo = src && src.startsWith('data:image/') ? src : null;
  return (
    <span className="av" style={{ width: size, height: size, fontSize: Math.max(10, size * 0.34), background: preset ? `linear-gradient(135deg, ${preset[0]}, ${preset[1]})` : undefined }}>
      {photo ? <img src={photo} alt="" /> : initials(name)}
      {online !== undefined && <i className={`presence ${online ? 'on' : ''}`} />}
    </span>
  );
}

/** Downscale a picked image to a 128px square JPEG data URL (~6 KB). */
export function fileToAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const S = 128;
      const cv = document.createElement('canvas');
      cv.width = S;
      cv.height = S;
      const ctx = cv.getContext('2d')!;
      const m = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - m) / 2, (img.height - m) / 2, m, m, 0, 0, S, S);
      URL.revokeObjectURL(url);
      resolve(cv.toDataURL('image/jpeg', 0.78));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image.'));
    };
    img.src = url;
  });
}
