// Materials that sample the simulation's light map, so what the player sees
// is exactly what NPCs "see" (dark rooms are dark for everyone).
import * as THREE from 'three';
import type { Lighting } from '../sim/Lighting';

export class LightMapShared {
  readonly tex: THREE.DataTexture;
  readonly uniforms: {
    uLightMap: { value: THREE.Texture };
    uMapSize: { value: THREE.Vector2 };
    uLightScale: { value: number };
  };
  private version = -1;

  constructor(private lighting: Lighting, mapW: number, mapH: number) {
    this.tex = new THREE.DataTexture(lighting.tex, lighting.texW, lighting.texH, THREE.RGBAFormat);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.wrapS = THREE.ClampToEdgeWrapping;
    this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.tex.colorSpace = THREE.NoColorSpace;
    this.tex.needsUpdate = true;
    this.uniforms = {
      uLightMap: { value: this.tex },
      uMapSize: { value: new THREE.Vector2(mapW, mapH) },
      uLightScale: { value: 1.6 },
    };
  }

  update() {
    if (this.lighting.version !== this.version) {
      this.version = this.lighting.version;
      this.tex.needsUpdate = true;
    }
  }

  patch<T extends THREE.Material>(mat: T, normalOffset = 0.3): T {
    const u = this.uniforms;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uLightMap = u.uLightMap;
      shader.uniforms.uMapSize = u.uMapSize;
      shader.uniforms.uLightScale = u.uLightScale;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vLmPos;')
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
          vec4 lmW = vec4(transformed, 1.0);
          vec3 lmN0 = objectNormal;
          #ifdef USE_INSTANCING
            lmW = instanceMatrix * lmW;
            lmN0 = mat3(instanceMatrix) * lmN0;
          #endif
          lmW = modelMatrix * lmW;
          vec3 lmN = normalize(mat3(modelMatrix) * lmN0);
          vLmPos = lmW.xyz + vec3(lmN.x, 0.0, lmN.z) * ${normalOffset.toFixed(2)};`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          '#include <common>\nvarying vec3 vLmPos;\nuniform sampler2D uLightMap;\nuniform vec2 uMapSize;\nuniform float uLightScale;',
        )
        .replace(
          '#include <opaque_fragment>',
          `vec3 lmCol = texture2D(uLightMap, vec2(vLmPos.x / uMapSize.x, vLmPos.z / uMapSize.y)).rgb * uLightScale;
          outgoingLight *= lmCol;
          #include <opaque_fragment>`,
        );
    };
    mat.customProgramCacheKey = () => 'lm' + normalOffset.toFixed(2);
    return mat;
  }
}

export class Mats {
  private cache = new Map<string, THREE.MeshLambertMaterial>();
  readonly vertex: THREE.MeshLambertMaterial;
  readonly vertexFlat: THREE.MeshLambertMaterial;

  constructor(readonly lm: LightMapShared) {
    this.vertex = lm.patch(new THREE.MeshLambertMaterial({ vertexColors: true }));
    this.vertexFlat = lm.patch(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  }

  /** Lightmap-lit flat colour. */
  lit = (hex: string): THREE.MeshLambertMaterial => {
    let m = this.cache.get(hex);
    if (!m) {
      m = this.lm.patch(new THREE.MeshLambertMaterial({ color: new THREE.Color(hex) }));
      this.cache.set(hex, m);
    }
    return m;
  };
}
