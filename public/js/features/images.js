// Downscale a picked photo to a ~720px JPEG data URL before upload.
export function shrink(file) {
  return new Promise((res, rej) => {
    if (!/^image\//.test(file.type)) return rej(new Error('not_image'));
    const url = URL.createObjectURL(file), im = new Image();
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error('bad_image')); };
    im.onload = () => {
      const k = Math.min(1, 720 / Math.max(im.width, im.height)), c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(im.width * k));
      c.height = Math.max(1, Math.round(im.height * k));
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', 0.82));
    };
    im.src = url;
  });
}
