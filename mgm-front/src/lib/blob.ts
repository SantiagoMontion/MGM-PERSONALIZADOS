export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(typeof r.result === 'string' ? r.result : '');
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
