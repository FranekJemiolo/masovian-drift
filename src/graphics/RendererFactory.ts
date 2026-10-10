import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';

export interface RendererCreationResult {
  renderer: THREE.WebGLRenderer | WebGPURenderer;
  isWebGPU: boolean;
  adapterInfo?: string;
}

export class RendererFactory {
  /**
   * Initializes high-performance WebGPURenderer with automatic fallback to WebGLRenderer.
   * Ensures that WebGPU compute and TSL features run on capable hardware, while headless
   * CI tests and older mobile browsers continue to function with 100% stability.
   */
  public static async createRenderer(canvas?: HTMLCanvasElement): Promise<RendererCreationResult> {
    const isWebGPUSupported = typeof navigator !== 'undefined' && 'gpu' in navigator;

    if (isWebGPUSupported) {
      try {
        const adapter = await (navigator as any).gpu.requestAdapter();
        if (adapter) {
          const webgpuRenderer = new WebGPURenderer({
            canvas,
            antialias: true,
            alpha: false,
            powerPreference: 'high-performance',
          });

          await webgpuRenderer.init();

          webgpuRenderer.toneMapping = THREE.ACESFilmicToneMapping;
          webgpuRenderer.toneMappingExposure = 1.05;
          webgpuRenderer.outputColorSpace = THREE.SRGBColorSpace;
          webgpuRenderer.shadowMap.enabled = true;
          webgpuRenderer.shadowMap.type = THREE.PCFSoftShadowMap;

          console.log('✓ Initialized AAA Three.js WebGPURenderer subsystem');
          return {
            renderer: webgpuRenderer,
            isWebGPU: true,
            adapterInfo: adapter.info?.description || 'WebGPU Device',
          };
        }
      } catch (err) {
        console.warn('WebGPU initialization failed, falling back to WebGLRenderer:', err);
      }
    }

    // High-performance WebGLRenderer fallback
    const webglRenderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });

    webglRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    webglRenderer.toneMappingExposure = 1.05;
    webglRenderer.outputColorSpace = THREE.SRGBColorSpace;
    webglRenderer.shadowMap.enabled = true;
    webglRenderer.shadowMap.type = THREE.PCFSoftShadowMap;

    return {
      renderer: webglRenderer,
      isWebGPU: false,
      adapterInfo: 'WebGL 2.0 Hardware Fallback',
    };
  }
}
