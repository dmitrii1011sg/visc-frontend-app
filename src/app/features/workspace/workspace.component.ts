import {
  Component,
  signal,
  HostListener,
  computed,
  OnInit,
  OnDestroy,
  ViewChild,
  ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ViscSettingsSharePanel } from '../settings-share-panel/settings-share-panel.component';
import { ViscImageUpload } from '../image-upload/image-upload.component';
import { ViscLayersPanel } from '../layers-panel/layers-panel.component';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faLayerGroup,
  faXmark,
  faSpinner,
  faShieldHalved,
  faLockOpen,
  faLock,
  faImage,
  faExpand,
  faSave,
} from '@fortawesome/free-solid-svg-icons';
import JSZip from 'jszip';
import * as iq from 'image-q';

interface CryptoResult {
  width: number;
  height: number;
  shares: Uint8Array[];
  isColored: boolean;
  palette?: [number, number, number][];
}

@Component({
  standalone: true,
  imports: [
    CommonModule,
    FontAwesomeModule,
    ViscSettingsSharePanel,
    ViscImageUpload,
    ViscLayersPanel,
  ],
  selector: 'visc-workspace',
  templateUrl: './workspace.component.html',
})
export class ViscWorkspace implements OnInit, OnDestroy {
  @ViewChild('viewport', { static: true }) viewport!: ElementRef<HTMLDivElement>;

  private lastTouchDistance = 0;
  private initialPinchScale = 1;

  protected kValue = signal<number>(2);
  protected nValue = signal<number>(2);
  protected isColoredMode = signal<boolean>(false);

  protected isLoading = signal<boolean>(false);
  protected errorMessage = signal<string | null>(null);
  protected cryptoResult = signal<CryptoResult | null>(null);
  protected uploadedImageUrl = signal<string | null>(null);
  protected uploadedImageData = signal<ImageData | null>(null);

  protected selectedShares = signal<Set<number>>(new Set());
  protected selectedSharesCount = computed(() => this.selectedShares().size);

  private worker!: Worker;

  readonly icons = {
    layers: faLayerGroup,
    close: faXmark,
    spinner: faSpinner,
    shield: faShieldHalved,
    unlocked: faLockOpen,
    locked: faLock,
    image: faImage,
    expand: faExpand,
    download: faSave,
  };

  transform = signal({ x: 0, y: 0, scale: 1 });
  isDragging = signal(false);
  private dragStart = { x: 0, y: 0 };
  isMobileLayersOpen = signal(false);

  sceneTransform = computed(() => {
    const t = this.transform();
    return `translate(${t.x}px, ${t.y}px) scale(${t.scale})`;
  });

  ngOnInit() {
    try {
      this.worker = new Worker(new URL('../../visc.worker', import.meta.url), {
        type: 'module',
      });

      this.worker.onmessage = ({ data }) => {
        if (data.type === 'SUCCESS') {
          this.handleCryptoSuccess(data.result);
        } else if (data.type === 'ERROR') {
          this.isLoading.set(false);
          this.errorMessage.set(data.error);
        }
      };
    } catch (e) {
      console.warn('Ошибка инициализации Web Worker', e);
    }
  }

  ngOnDestroy() {
    if (this.worker) this.worker.terminate();
  }

  onSettingsChange(settings: { k: number; n: number; isColored: boolean }) {
    this.kValue.set(settings.k);
    this.nValue.set(settings.n);
    this.isColoredMode.set(settings.isColored);
  }

  handleImageSelected(data: ImageData) {
    this.uploadedImageData.set(data);
    this.errorMessage.set(null);
  }

  handlePreviewGenerated(url: string) {
    this.uploadedImageUrl.set(url);
  }

  async onGenerateShares(): Promise<void> {
    const imgData = this.uploadedImageData();
    if (!imgData) {
      this.errorMessage.set('Пожалуйста, сначала загрузите изображение!');
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set(null);

    const baseHref =
      window.location.origin + window.location.pathname.split('/').slice(0, -1).join('/') + '/';
    const wasmUrl = `${baseHref}assets/wasm/visc.wasm`;

    const width = imgData.width;
    const height = imgData.height;
    const isColored = this.isColoredMode();

    if (isColored) {
      const { pixelIndices, palette } = await this.quantize(imgData, 8);
      this.worker.postMessage(
        {
          type: 'ENCODE_IMAGE',
          payload: {
            k: this.kValue(),
            n: this.nValue(),
            pixelData: pixelIndices,
            width,
            height,
            isColored: true,
            numColors: palette.length,
            palette,
            wasmUrl,
          },
        },
        [pixelIndices.buffer],
      );
    } else {
      const grayscaleData = new Uint8Array(width * height);
      for (let i = 0; i < imgData.data.length; i += 4) {
        const r = imgData.data[i];
        const g = imgData.data[i + 1];
        const b = imgData.data[i + 2];
        const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
        grayscaleData[i / 4] = luminance > 128 ? 255 : 0;
      }

      this.worker.postMessage(
        {
          type: 'ENCODE_IMAGE',
          payload: {
            k: this.kValue(),
            n: this.nValue(),
            pixelData: grayscaleData,
            width,
            height,
            isColored: false,
            wasmUrl,
          },
        },
        [grayscaleData.buffer],
      );
    }
  }

  private async quantize(imgData: ImageData, colorCount: number) {
    const { width, height, data } = imgData;

    const pointContainer = iq.utils.PointContainer.fromUint8Array(data, width, height);
    const distanceMetric = new iq.distance.Euclidean();

    const paletteQuantizer = new iq.palette.WuQuant(distanceMetric, colorCount);

    paletteQuantizer.sample(pointContainer);

    const paletteIterator = paletteQuantizer.quantize();
    let palette: any;

    for (const result of paletteIterator) {
      if (result && result.palette) {
        palette = result.palette;
      }
    }

    if (!palette) {
      throw new Error('Palette is not exist');
    }

    const imageQuantizer = new iq.image.ErrorDiffusionArray(
      distanceMetric,
      iq.image.ErrorDiffusionArrayKernel.FloydSteinberg,
    );

    const quantizationIterator = imageQuantizer.quantize(pointContainer, palette);
    for (const _ of quantizationIterator) {
    }

    const quantizedRgba = pointContainer.toUint8Array();

    const palettePoints = palette.getPointContainer().getPointArray();
    const finalPalette: [number, number, number][] = palettePoints.map(
      (p: iq.utils.Point) => [p.r, p.g, p.b] as [number, number, number],
    );

    finalPalette.push([0, 0, 0]);

    const pixelIndices = new Uint8Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const r = quantizedRgba[i * 4];
      const g = quantizedRgba[i * 4 + 1];
      const b = quantizedRgba[i * 4 + 2];

      let bestIdx = 0;
      let minDist = Infinity;
      for (let j = 0; j < finalPalette.length; j++) {
        const d =
          Math.pow(r - finalPalette[j][0], 2) +
          Math.pow(g - finalPalette[j][1], 2) +
          Math.pow(b - finalPalette[j][2], 2);
        if (d < minDist) {
          minDist = d;
          bestIdx = j;
        }
      }
      pixelIndices[i] = bestIdx;
    }

    return { pixelIndices, palette: finalPalette };
  }

  private handleCryptoSuccess(result: CryptoResult): void {
    this.isLoading.set(false);
    this.cryptoResult.set(result);
    this.selectedShares.set(new Set());
    this.resetZoom();
    this.renderIndividualShares(result);
    this.updateOverlayCanvas();
  }

  isShareSelected(index: number): boolean {
    return this.selectedShares().has(index);
  }

  toggleShareSelection(index: number): void {
    this.selectedShares.update((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
    this.updateOverlayCanvas();
  }

  private updateOverlayCanvas(): void {
    const result = this.cryptoResult();
    const selected = this.selectedShares();
    const canvas = document.getElementById('overlay-canvas') as HTMLCanvasElement;

    if (!result || !canvas) return;

    const ctx = canvas.getContext('2d')!;
    const imgData = ctx.createImageData(result.width, result.height);
    const totalPixels = result.width * result.height;

    if (selected.size === 0) {
      imgData.data.fill(255);
      ctx.putImageData(imgData, 0, 0);
      return;
    }

    if (result.isColored) {
      const palette = result.palette || [];
      const numColors = palette.length;

      for (let i = 0; i < totalPixels; i++) {
        let finalColorIdx = -1;
        for (const shareIdx of selected) {
          const colorIdx = result.shares[shareIdx][i];
          if (colorIdx === numColors) {
            finalColorIdx = numColors;
            break;
          }
          if (colorIdx < numColors) finalColorIdx = colorIdx;
        }

        const rIdx = i * 4;
        if (finalColorIdx === numColors || finalColorIdx === -1) {
          imgData.data[rIdx] = 0;
          imgData.data[rIdx + 1] = 0;
          imgData.data[rIdx + 2] = 0;
        } else {
          const color = palette[finalColorIdx];
          imgData.data[rIdx] = color[0];
          imgData.data[rIdx + 1] = color[1];
          imgData.data[rIdx + 2] = color[2];
        }
        imgData.data[rIdx + 3] = 255;
      }
    } else {
      for (let i = 0; i < totalPixels; i++) {
        let minBrightness = 255;
        for (const shareIdx of selected) {
          const brightness = result.shares[shareIdx][i];
          if (brightness < minBrightness) minBrightness = brightness;
        }
        const rIdx = i * 4;
        imgData.data[rIdx] = minBrightness;
        imgData.data[rIdx + 1] = minBrightness;
        imgData.data[rIdx + 2] = minBrightness;
        imgData.data[rIdx + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }

  private renderIndividualShares(result: CryptoResult): void {
    setTimeout(() => {
      result.shares.forEach((sharePixels, index) => {
        const canvas = document.getElementById(`share-canvas-${index}`) as HTMLCanvasElement;
        if (!canvas) return;

        const ctx = canvas.getContext('2d')!;
        const imgData = ctx.createImageData(result.width, result.height);

        if (result.isColored) {
          const palette = result.palette || [];
          const numColors = palette.length;
          for (let i = 0; i < sharePixels.length; i++) {
            const colorIdx = sharePixels[i];
            const idx = i * 4;
            if (colorIdx === numColors) {
              imgData.data[idx] = 0;
              imgData.data[idx + 1] = 0;
              imgData.data[idx + 2] = 0;
            } else {
              const color = palette[colorIdx];
              imgData.data[idx] = color[0];
              imgData.data[idx + 1] = color[1];
              imgData.data[idx + 2] = color[2];
            }
            imgData.data[idx + 3] = 255;
          }
        } else {
          for (let i = 0; i < sharePixels.length; i++) {
            const val = sharePixels[i];
            const idx = i * 4;
            imgData.data[idx] = val;
            imgData.data[idx + 1] = val;
            imgData.data[idx + 2] = val;
            imgData.data[idx + 3] = 255;
          }
        }
        ctx.putImageData(imgData, 0, 0);
      });
    }, 0);
  }

  async downloadAllShares() {
    const result = this.cryptoResult();
    if (!result) return;

    const zip = new JSZip();
    const canvas = document.createElement('canvas');
    canvas.width = result.width;
    canvas.height = result.height;
    const ctx = canvas.getContext('2d')!;

    for (let i = 0; i < result.shares.length; i++) {
      const sharePixels = result.shares[i];
      const imgData = ctx.createImageData(result.width, result.height);

      if (result.isColored) {
        const palette = result.palette || [];
        const numColors = palette.length;
        for (let p = 0; p < sharePixels.length; p++) {
          const colorIdx = sharePixels[p];
          const idx = p * 4;
          if (colorIdx === numColors) {
            imgData.data[idx] = imgData.data[idx + 1] = imgData.data[idx + 2] = 0;
          } else {
            const color = palette[colorIdx];
            imgData.data[idx] = color[0];
            imgData.data[idx + 1] = color[1];
            imgData.data[idx + 2] = color[2];
          }
          imgData.data[idx + 3] = 255;
        }
      } else {
        for (let p = 0; p < sharePixels.length; p++) {
          const val = sharePixels[p];
          imgData.data.set([val, val, val, 255], p * 4);
        }
      }

      ctx.putImageData(imgData, 0, 0);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (blob) zip.file(`share_${i + 1}.png`, blob);
    }

    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'shares.zip';
    a.click();
    URL.revokeObjectURL(url);
  }

  @HostListener('document:mousemove', ['$event'])
  @HostListener('document:touchmove', ['$event'])
  onMouseMove(event: MouseEvent | TouchEvent) {
    if (!this.isDragging()) return;
    const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
    const clientY = 'touches' in event ? event.touches[0].clientY : event.clientY;

    this.transform.update((t) => ({
      ...t,
      x: clientX - this.dragStart.x,
      y: clientY - this.dragStart.y,
    }));
  }

  @HostListener('document:mouseup')
  @HostListener('document:touchend')
  onMouseUp() {
    this.isDragging.set(false);
  }

  onWheel(event: WheelEvent) {
    event.preventDefault();

    const zoomSensitivity = 0.0015;
    const delta = -event.deltaY * zoomSensitivity;

    this.transform.update((t) => {
      let newScale = t.scale * Math.exp(delta);
      newScale = Math.max(0.1, Math.min(newScale, 10));
      if (newScale === t.scale) return t;

      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;

      const ratio = newScale / t.scale;

      return {
        scale: newScale,
        x: mouseX - (mouseX - t.x) * ratio,
        y: mouseY - (mouseY - t.y) * ratio,
      };
    });
  }

  onMouseDown(event: MouseEvent | TouchEvent) {
    if ('touches' in event && event.touches.length === 2) {
      this.lastTouchDistance = this.getDistance(event.touches[0], event.touches[1]);
      this.initialPinchScale = this.transform().scale;
      return;
    }

    this.isDragging.set(true);
    const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
    const clientY = 'touches' in event ? event.touches[0].clientY : event.clientY;
    this.dragStart = { x: clientX - this.transform().x, y: clientY - this.transform().y };
  }

  @HostListener('document:touchmove', ['$event'])
  onMove(event: TouchEvent) {
    if (event.touches.length === 2) {
      event.preventDefault();

      const dist = this.getDistance(event.touches[0], event.touches[1]);
      const midX = (event.touches[0].clientX + event.touches[1].clientX) / 2;
      const midY = (event.touches[0].clientY + event.touches[1].clientY) / 2;

      const scaleFactor = dist / this.lastTouchDistance;
      const newScale = Math.max(0.1, Math.min(this.initialPinchScale * scaleFactor, 10));

      this.transform.update((t) => {
        const ratio = newScale / t.scale;

        const newX = midX - (midX - t.x) * ratio;
        const newY = midY - (midY - t.y) * ratio;

        return { scale: newScale, x: newX, y: newY };
      });

      return;
    }

    if (this.isDragging() && event.touches.length === 1) {
      const { clientX, clientY } = event.touches[0];
      this.transform.update((t) => ({
        ...t,
        x: clientX - this.dragStart.x,
        y: clientY - this.dragStart.y,
      }));
    }
  }

  @HostListener('document:touchend', ['$event'])
  onTouchEnd(event: TouchEvent) {
    this.isDragging.set(false);
    this.lastTouchDistance = 0;
  }

  private getDistance(t1: Touch, t2: Touch): number {
    return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
  }

  resetZoom() {
    const result = this.cryptoResult();
    const vp = this.viewport.nativeElement;
    if (!result || !vp) return;

    const isMobile = window.innerWidth < 768;
    const padding = isMobile ? 20 : 60;

    const availableWidth = vp.clientWidth - padding;
    const availableHeight = vp.clientHeight - padding;

    const scaleX = availableWidth / result.width;
    const scaleY = availableHeight / result.height;
    const newScale = Math.min(scaleX, scaleY, 1);

    this.transform.set({
      x: (vp.clientWidth - result.width * newScale) / 2,
      y: (vp.clientHeight - result.height * newScale) / 2,
      scale: newScale,
    });
  }

  toggleMobileLayers() {
    this.isMobileLayersOpen.update((v) => !v);
  }
}
