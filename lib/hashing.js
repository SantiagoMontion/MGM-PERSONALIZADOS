// Tiny image hashing utilities (dependency-free, pair with sharp for decode)

export function hamming(a, b) {
  const x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let n = 0n;
  let y = x;
  while (y) { n += y & 1n; y >>= 1n; }
  return Number(n);
}

// Compute pHash via 2D DCT of 32x32 grayscale, take top-left 8x8
export function pHashFromGray(gray, width, height) {
  // gray: Uint8Array length width*height
  const N = 32, M = 32;
  // resample to 32x32 using nearest neighbor (simple)
  const small = new Float64Array(N * M);
  for (let y = 0; y < M; y++) {
    const sy = Math.floor(y * height / M);
    for (let x = 0; x < N; x++) {
      const sx = Math.floor(x * width / N);
      small[y * N + x] = gray[sy * width + sx];
    }
  }

  // 1D DCT helper
  function dct1d(vec, n) {
    const out = new Float64Array(n);
    const factor = Math.PI / n;
    for (let k = 0; k < n; k++) {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += vec[i] * Math.cos(((i + 0.5) * k) * factor);
      const ck = k === 0 ? Math.SQRT1_2 : 1; // orthonormal DCT-II scaling
      out[k] = sum * ck;
    }
    return out;
  }

  // 2D DCT (row then column)
  const tmp = new Float64Array(N * M);
  for (let y = 0; y < M; y++) {
    const row = small.subarray(y * N, (y + 1) * N);
    const d = dct1d(row, N);
    tmp.set(d, y * N);
  }
  const dct = new Float64Array(N * M);
  const col = new Float64Array(M);
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < M; y++) col[y] = tmp[y * N + x];
    const d = dct1d(col, M);
    for (let y = 0; y < M; y++) dct[y * N + x] = d[y];
  }

  // Take top-left 8x8 (excluding DC at [0,0])
  const size = 8;
  const coeffs = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (x === 0 && y === 0) continue;
      coeffs.push(dct[y * N + x]);
    }
  }
  const median = coeffs.slice().sort((a,b) => a-b)[Math.floor(coeffs.length / 2)];
  // Build 64-bit hash including DC bit as 1 (or could skip); to keep 64, include DC > median
  const bits = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = dct[y * N + x];
      bits.push(v > median ? 1 : 0);
    }
  }
  // Pack into hex
  let hex = '';
  for (let i = 0; i < 64; i += 4) {
    const nibble = (bits[i] << 3) | (bits[i+1] << 2) | (bits[i+2] << 1) | (bits[i+3]);
    hex += nibble.toString(16);
  }
  return hex;
}

