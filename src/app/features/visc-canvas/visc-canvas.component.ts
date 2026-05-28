import { Component, ElementRef, ViewChild, OnInit, input, effect, OnDestroy } from '@angular/core';
import * as twgl from 'twgl.js';

@Component({
  selector: 'visc-canvas',
  standalone: true,
  template: `<canvas #webglCanvas class="w-full h-full block pointer-events-none"></canvas>`,
})
export class ViscCanvas implements OnInit, OnDestroy {
  @ViewChild('webglCanvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  result = input<any>(null);
  selectedShares = input<Set<number>>(new Set());
  transform = input({ x: 0, y: 0, scale: 1 });

  private gl!: WebGL2RenderingContext;
  private programInfo!: twgl.ProgramInfo;
  private bufferInfo!: twgl.BufferInfo;
  private textures: WebGLTexture[] = [];
  private animationFrameId: number = 0;
  private whiteTexture!: WebGLTexture;

  private fboInfo!: twgl.FramebufferInfo;

  private vertexShader = `#version 300 es
    in vec2 a_position;
    in vec2 a_texcoord;
    uniform mat4 u_matrix;
    out vec2 v_texcoord;
    void main() {
      gl_Position = u_matrix * vec4(a_position, 0.0, 1.0);
      v_texcoord = a_texcoord;
    }
  `;

  private fragmentShader = `#version 300 es
    precision mediump float;
    in vec2 v_texcoord;
    uniform sampler2D u_texture;
    out vec4 outColor;
    void main() {
      outColor = texture(u_texture, v_texcoord);
    }
  `;

  constructor() {
    effect(() => {
      const res = this.result();
      if (res) this.rebuildTextures(res);
    });

    effect(() => {
      this.transform();
      this.selectedShares();
      this.requestRender();
    });
  }

  ngOnInit() {
    const canvas = this.canvasRef.nativeElement;
    this.gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false })!;

    this.programInfo = twgl.createProgramInfo(this.gl, [this.vertexShader, this.fragmentShader]);

    const arrays = {
      a_position: { numComponents: 2, data: [0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1] },
      a_texcoord: { numComponents: 2, data: [0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1] },
    };
    this.bufferInfo = twgl.createBufferInfoFromArrays(this.gl, arrays);

    this.whiteTexture = twgl.createTexture(this.gl, {
      src: [255, 255, 255, 255],
    });

    this.requestRender();
  }

  ngOnDestroy() {
    cancelAnimationFrame(this.animationFrameId);
    this.textures.forEach((t) => this.gl.deleteTexture(t));
    if (this.fboInfo) {
      this.gl.deleteFramebuffer(this.fboInfo.framebuffer);
      this.gl.deleteTexture(this.fboInfo.attachments[0]);
    }
  }

  private rebuildTextures(result: any) {
    this.textures.forEach((t) => this.gl.deleteTexture(t));
    this.textures = [];

    const w = result.width;
    const h = result.height;

    const fboAttachments = [{ min: this.gl.LINEAR_MIPMAP_LINEAR, mag: this.gl.NEAREST }];
    if (this.fboInfo) {
      twgl.resizeFramebufferInfo(this.gl, this.fboInfo, fboAttachments, w, h);
    } else {
      this.fboInfo = twgl.createFramebufferInfo(this.gl, fboAttachments, w, h);
    }

    result.shares.forEach((share: Uint8Array) => {
      const rgba = new Uint8Array(w * h * 4);

      if (result.isColored) {
        const numColors = result.palette.length;
        for (let i = 0; i < share.length; i++) {
          const cIdx = share[i];
          if (cIdx === numColors) {
            rgba[i * 4] = 0;
            rgba[i * 4 + 1] = 0;
            rgba[i * 4 + 2] = 0;
            rgba[i * 4 + 3] = 255;
          } else {
            const c = result.palette[cIdx];
            rgba[i * 4] = c[0];
            rgba[i * 4 + 1] = c[1];
            rgba[i * 4 + 2] = c[2];
            rgba[i * 4 + 3] = 255;
          }
        }
      } else {
        for (let i = 0; i < share.length; i++) {
          const val = share[i];
          rgba[i * 4] = val;
          rgba[i * 4 + 1] = val;
          rgba[i * 4 + 2] = val;
          rgba[i * 4 + 3] = 255;
        }
      }

      const tex = twgl.createTexture(this.gl, {
        min: this.gl.NEAREST,
        mag: this.gl.NEAREST,
        width: w,
        height: h,
        src: rgba,
      });
      this.textures.push(tex);
    });

    this.requestRender();
  }

  private requestRender() {
    if (!this.animationFrameId) {
      this.animationFrameId = requestAnimationFrame(() => this.render());
    }
  }

  private render() {
    this.animationFrameId = 0;
    if (!this.gl || !this.result() || !this.fboInfo) return;

    twgl.resizeCanvasToDisplaySize(this.gl.canvas as HTMLCanvasElement);

    const res = this.result();
    const t = this.transform();
    const selected = Array.from(this.selectedShares());

    this.gl.useProgram(this.programInfo.program);
    twgl.setBuffersAndAttributes(this.gl, this.programInfo, this.bufferInfo);

    twgl.bindFramebufferInfo(this.gl, this.fboInfo);
    this.gl.viewport(0, 0, res.width, res.height);

    this.gl.clearColor(1, 1, 1, 1);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    const fboProjection = twgl.m4.ortho(0, res.width, 0, res.height, -1, 1);
    const fboMatrix = twgl.m4.scale(fboProjection, [res.width, res.height, 1]);

    this.gl.enable(this.gl.BLEND);
    this.gl.blendEquation(this.gl.FUNC_ADD);
    this.gl.blendFunc(this.gl.DST_COLOR, this.gl.ZERO);

    selected.forEach((idx) => {
      if (this.textures[idx]) {
        twgl.setUniforms(this.programInfo, { u_matrix: fboMatrix, u_texture: this.textures[idx] });
        twgl.drawBufferInfo(this.gl, this.bufferInfo);
      }
    });

    this.gl.bindTexture(this.gl.TEXTURE_2D, this.fboInfo.attachments[0]);
    this.gl.generateMipmap(this.gl.TEXTURE_2D);

    twgl.bindFramebufferInfo(this.gl, null);
    this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);

    this.gl.clearColor(0, 0, 0, 0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);

    const projection = twgl.m4.ortho(0, this.gl.canvas.width, this.gl.canvas.height, 0, -1, 1);
    const PADDING = 6;

    let bgMatrix = twgl.m4.translate(projection, [
      t.x - PADDING * t.scale,
      t.y - PADDING * t.scale,
      0,
    ]);
    bgMatrix = twgl.m4.scale(bgMatrix, [t.scale, t.scale, 1]);
    bgMatrix = twgl.m4.scale(bgMatrix, [res.width + PADDING * 2, res.height + PADDING * 2, 1]);

    let imgMatrix = twgl.m4.translate(projection, [t.x, t.y, 0]);
    imgMatrix = twgl.m4.scale(imgMatrix, [t.scale, t.scale, 1]);
    imgMatrix = twgl.m4.scale(imgMatrix, [res.width, res.height, 1]);

    this.gl.disable(this.gl.BLEND);

    twgl.setUniforms(this.programInfo, { u_matrix: bgMatrix, u_texture: this.whiteTexture });
    twgl.drawBufferInfo(this.gl, this.bufferInfo);

    twgl.setUniforms(this.programInfo, {
      u_matrix: imgMatrix,
      u_texture: this.fboInfo.attachments[0],
    });
    twgl.drawBufferInfo(this.gl, this.bufferInfo);
  }
}
