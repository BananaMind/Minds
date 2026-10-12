// Downscale picked or pasted images before they travel to the host (desktop IPC or phone P2P).
const encode = (img, side, quality) => {
  const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * scale)); c.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); // JPEG has no alpha
  g.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
};

/** File -> {data, thumb}: data at most 1600px, thumb at most 320px, both JPEG data URLs. */
export async function prepareImage(file) {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name || 'File'} is not an image.`);
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error(`Could not read ${file.name || 'image'}.`)); img.src = url; });
    return { data: encode(img, 1600, 0.85), thumb: encode(img, 320, 0.7) };
  } finally { URL.revokeObjectURL(url); }
}
