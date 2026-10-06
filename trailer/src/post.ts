// Trailer-only post processing: miniature tilt-shift (the cut-away mansion reads like a doll's
// house), a soft bloom for lamps / gold / fireworks, and a gentle grade + vignette.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export interface PostOpts {
  /** Tilt-shift blur strength in px (0 = off). */
  tilt?: number;
  /** Focus band centre (0 = bottom, 1 = top) and half-width. */
  tiltCenter?: number;
  tiltWidth?: number;
  bloom?: number;
  vignette?: number;
  /** -1..1 warm(+)/cool(-) tint. */
  warmth?: number;
  saturation?: number;
  exposure?: number;
  /** Fade to black 0..1. */
  black?: number;
  /** Fade to white 0..1 (flash). */
  white?: number;
}

const TiltShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uDir: { value: new THREE.Vector2(1, 0) },
    uRes: { value: new THREE.Vector2(1920, 1080) },
    uAmount: { value: 0 },
    uCenter: { value: 0.5 },
    uWidth: { value: 0.18 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform vec2 uDir; uniform vec2 uRes; uniform float uAmount; uniform float uCenter; uniform float uWidth;
    varying vec2 vUv;
    void main(){
      float d = max(0.0, abs(vUv.y - uCenter) - uWidth);
      float r = uAmount * smoothstep(0.0, 0.35, d);
      if (r < 0.05) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
      vec4 acc = vec4(0.0); float wsum = 0.0;
      for (int i = -8; i <= 8; i++) {
        float fi = float(i) / 8.0;
        float wgt = exp(-fi*fi*2.5);
        acc += texture2D(tDiffuse, vUv + uDir * fi * r / uRes) * wgt;
        wsum += wgt;
      }
      gl_FragColor = acc / wsum;
    }`,
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0.35 },
    uWarm: { value: 0 },
    uSat: { value: 1 },
    uExposure: { value: 1 },
    uBlack: { value: 0 },
    uWhite: { value: 0 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uVignette, uWarm, uSat, uExposure, uBlack, uWhite, uTime;
    varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb * uExposure;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      col *= vec3(1.0 + 0.06*uWarm, 1.0 + 0.01*uWarm, 1.0 - 0.07*uWarm);
      vec2 q = vUv - 0.5; q.x *= 1.777;
      float v = smoothstep(1.15, 0.25, length(q));
      col *= mix(1.0, v, uVignette);
      col = mix(col, vec3(1.0), uWhite);
      col = mix(col, vec3(0.0), uBlack);
      gl_FragColor = vec4(col, c.a);
    }`,
};

export class Post {
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private tiltH: ShaderPass;
  private tiltV: ShaderPass;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;

  constructor(renderer: THREE.WebGLRenderer, w: number, h: number) {
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.composer.setPixelRatio(1);
    this.composer.setSize(w, h);
    this.renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
    this.composer.addPass(this.renderPass);
    this.tiltH = new ShaderPass(TiltShader);
    this.tiltV = new ShaderPass(TiltShader);
    this.tiltV.uniforms.uDir.value = new THREE.Vector2(0, 1);
    this.composer.addPass(this.tiltH);
    this.composer.addPass(this.tiltV);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.35, 0.55, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }

  render(scene: THREE.Scene, camera: THREE.Camera, o: PostOpts, t: number) {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    const tilt = o.tilt ?? 0;
    for (const p of [this.tiltH, this.tiltV]) {
      p.enabled = tilt > 0.05;
      p.uniforms.uAmount.value = tilt;
      p.uniforms.uCenter.value = o.tiltCenter ?? 0.5;
      p.uniforms.uWidth.value = o.tiltWidth ?? 0.16;
    }
    this.bloom.strength = o.bloom ?? 0.32;
    this.bloom.enabled = this.bloom.strength > 0.01;
    const g = this.grade.uniforms;
    g.uVignette.value = o.vignette ?? 0.4;
    g.uWarm.value = o.warmth ?? 0;
    g.uSat.value = o.saturation ?? 1.06;
    g.uExposure.value = o.exposure ?? 1;
    g.uBlack.value = o.black ?? 0;
    g.uWhite.value = o.white ?? 0;
    g.uTime.value = t;
    this.composer.render();
  }
}
