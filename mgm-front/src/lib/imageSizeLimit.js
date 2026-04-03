import { getMaxImageMb } from './imageLimits.js';

// Unificamos el límite con el valor que usa el front para los guard (UploadStep).
// Si VITE_MAX_IMAGE_MB no está seteado, cae al default de imageLimits (30MB).
export const MAX_IMAGE_MB = getMaxImageMb();
export const MAX_IMAGE_BYTES = MAX_IMAGE_MB * 1024 * 1024;
