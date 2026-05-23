/// <reference lib="webworker" />
import createViscModule from '../assets/wasm/visc.js';

let viscModule: any = null;

async function initWasm(wasmUrl: string) {
  if (!viscModule) {
    viscModule = await createViscModule({
      locateFile: (path: string) => (path.endsWith('.wasm') ? wasmUrl : path),
    });
  }
  return viscModule;
}

addEventListener('message', async ({ data }) => {
  const { type, payload } = data;

  if (type === 'ENCODE_IMAGE') {
    const module = await initWasm(payload.wasmUrl);

    let inputPtr = 0;
    let encoderPtr = 0;
    let outputSharesPtr = 0;
    const sharePtrs: number[] = [];

    try {
      const { k, n, pixelData, width, height, isColored, numColors, palette } = payload;

      if (isColored) {
        encoderPtr = module._visc_create_colored_encoder(k, n, numColors);
      } else {
        encoderPtr = module._visc_create_encoder(k, n);
      }

      if (!encoderPtr) throw new Error('Не удалось создать C++ энкодер');

      const m = module._visc_get_m(encoderPtr);
      const actualN = module._visc_get_n(encoderPtr);

      let scaleW = Math.floor(Math.sqrt(m));
      while (m % scaleW !== 0 && scaleW > 1) {
        scaleW--;
      }
      const scaleH = Math.floor(m / scaleW);
      const newWidth = width * scaleW;
      const newHeight = height * scaleH;
      const shareSizePixels = newWidth * newHeight;

      const shareSizeBytes = isColored ? shareSizePixels : Math.floor((shareSizePixels + 7) / 8);

      inputPtr = module._malloc(pixelData.length);
      module.HEAPU8.set(pixelData, inputPtr);

      outputSharesPtr = module._malloc(actualN * 4);

      for (let i = 0; i < actualN; i++) {
        const shareBufferPtr = module._malloc(shareSizeBytes);
        sharePtrs.push(shareBufferPtr);
        module.HEAP32[outputSharesPtr / 4 + i] = shareBufferPtr;
      }

      if (isColored) {
        module._visc_encode_color(encoderPtr, inputPtr, width, height, outputSharesPtr);
      } else {
        module._visc_encode(encoderPtr, inputPtr, width, height, outputSharesPtr);
      }

      const shares: Uint8Array[] = [];

      for (let i = 0; i < actualN; i++) {
        const ptr = sharePtrs[i];

        if (isColored) {
          const shareData = new Uint8Array(module.HEAPU8.buffer, ptr, shareSizeBytes).slice();
          shares.push(shareData);
        } else {
          const rawPacked = new Uint8Array(module.HEAPU8.buffer, ptr, shareSizeBytes);
          const unpackedPixels = new Uint8Array(shareSizePixels);

          for (let j = 0; j < shareSizePixels; j++) {
            const byteIdx = Math.floor(j / 8);
            const bitIdx = 7 - (j % 8);
            const bit = (rawPacked[byteIdx] >> bitIdx) & 1;
            unpackedPixels[j] = bit === 1 ? 0 : 255;
          }
          shares.push(unpackedPixels);
        }
      }

      postMessage({
        type: 'SUCCESS',
        result: {
          width: newWidth,
          height: newHeight,
          shares: shares,
          isColored: isColored,
          palette: palette,
        },
      });
    } catch (error: any) {
      postMessage({ type: 'ERROR', error: error?.message || 'Ошибка кодирования в Wasm' });
    } finally {
      if (inputPtr) module._free(inputPtr);
      if (outputSharesPtr) module._free(outputSharesPtr);
      for (const ptr of sharePtrs) {
        if (ptr) module._free(ptr);
      }
      if (encoderPtr) module._visc_destroy_encoder(encoderPtr);
    }
  }
});
