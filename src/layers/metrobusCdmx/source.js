function decodeBase64(text) {
  const binary = globalThis.atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function bundledPayload() {
  const modules = await Promise.all([
    import('./payload-0.js'),
    import('./payload-1.js'),
    import('./payload-2.js'),
    import('./payload-3.js'),
    import('./payload-4.js'),
    import('./payload-5.js'),
    import('./payload-6.js'),
    import('./payload-7.js'),
  ]);
  return modules.map((module) => module.PAYLOAD_CHUNK).join('');
}

export async function loadBundledMetrobusNetwork({
  payload = null,
  DecompressionStreamImpl = globalThis.DecompressionStream,
} = {}) {
  if (typeof DecompressionStreamImpl !== 'function')
    throw new Error('Browser gzip decompression is unavailable');
  const encoded = payload ?? (await bundledPayload());
  const bytes = decodeBase64(encoded);
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStreamImpl('gzip'));
  const text = await new Response(stream).text();
  return JSON.parse(text);
}
