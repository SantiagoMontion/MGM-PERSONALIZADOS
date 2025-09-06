// Server-side NSFW check is stubbed to avoid heavy TFJS/NSFWJS in serverless runtime.
// Keep client-only ML in the browser.
export async function checkNSFW(_buffer) {
  return { block: false, reason: 'skipped_on_server' };
}

export default { checkNSFW };

