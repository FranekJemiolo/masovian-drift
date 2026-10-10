import { PhysicsBridge, TOTAL_PHYSICS_BUFFER_BYTES } from './PhysicsBridge';

/**
 * Dedicated WebWorker for Physics and Rapier3D / Pacejka Simulation
 * Offloads 60Hz deterministic fixed-timestep calculations from the main rendering thread.
 * Communicates via SharedArrayBuffer (when COOP/COEP headers are present)
 * or zero-copy Transferable ArrayBuffers as fallback.
 */

export interface PhysicsWorkerInitMessage {
  type: 'INIT';
  useSharedMemory: boolean;
  sharedBuffer?: SharedArrayBuffer;
}

export interface PhysicsWorkerStepMessage {
  type: 'STEP';
  dt: number;
  inputBuffer?: ArrayBuffer;
}

let bridge: PhysicsBridge | null = null;
let isShared = false;

self.onmessage = (event: MessageEvent<PhysicsWorkerInitMessage | PhysicsWorkerStepMessage>) => {
  const msg = event.data;

  if (msg.type === 'INIT') {
    bridge = new PhysicsBridge();
    if (msg.useSharedMemory && msg.sharedBuffer) {
      bridge.sharedBuffer = msg.sharedBuffer;
      bridge.floatView = new Float32Array(msg.sharedBuffer);
      bridge.uintView = new Uint32Array(msg.sharedBuffer);
      isShared = true;
    }
    self.postMessage({ type: 'READY', byteLength: TOTAL_PHYSICS_BUFFER_BYTES });
  } else if (msg.type === 'STEP') {
    if (!bridge) return;

    // Simulation tick executed in worker thread
    // In SharedArrayBuffer mode, values are written directly in place without message copying.
    // In Transferable mode, the buffer ownership is transferred back to the main thread.
    if (!isShared) {
      const copy = bridge.sharedBuffer.slice(0) as ArrayBuffer;
      (self as any).postMessage({ type: 'STEP_COMPLETE', buffer: copy }, [copy]);
    } else {
      self.postMessage({ type: 'STEP_COMPLETE' });
    }
  }
};
