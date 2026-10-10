/**
 * Temporal Rewind Ring Buffer Subsystem (Forza-Style Time Reversal)
 * Pre-allocates a 600-frame circular ring buffer (10.0s at 60Hz) capturing
 * physical transforms, velocities, drivetrain state, and score.
 */

import * as THREE from 'three';

export interface RewindFrame {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  velocity: [number, number, number];
  angularVelocity: [number, number, number];
  speedKmh: number;
  rpm: number;
  gear: number;
  steer: number;
  throttle: number;
  brake: number;
  driftScore: number;
  slipAngle: number;
}

export class RewindController {
  private readonly bufferCapacity = 600; // 10.0 seconds at 60Hz
  private buffer: (RewindFrame | null)[] = new Array(this.bufferCapacity).fill(null);
  private head = 0;
  private count = 0;

  public isRewinding = false;
  private rewindPlayhead = 0;

  public pushFrame(frame: RewindFrame): void {
    if (this.isRewinding) return; // Do not record during active rewind

    this.buffer[this.head] = {
      position: [...frame.position],
      quaternion: [...frame.quaternion],
      velocity: [...frame.velocity],
      angularVelocity: [...frame.angularVelocity],
      speedKmh: frame.speedKmh,
      rpm: frame.rpm,
      gear: frame.gear,
      steer: frame.steer,
      throttle: frame.throttle,
      brake: frame.brake,
      driftScore: frame.driftScore,
      slipAngle: frame.slipAngle,
    };

    this.head = (this.head + 1) % this.bufferCapacity;
    if (this.count < this.bufferCapacity) {
      this.count++;
    }
  }

  public startRewind(): boolean {
    if (this.count < 30) return false; // Need at least 0.5s of history
    this.isRewinding = true;
    this.rewindPlayhead = (this.head - 1 + this.bufferCapacity) % this.bufferCapacity;
    return true;
  }

  public stepRewind(playbackSpeed = 2): RewindFrame | null {
    if (!this.isRewinding || this.count <= 0) return null;

    // Step backward in circular ring buffer
    this.rewindPlayhead = (this.rewindPlayhead - playbackSpeed + this.bufferCapacity) % this.bufferCapacity;
    this.count = Math.max(0, this.count - playbackSpeed);

    const frame = this.buffer[this.rewindPlayhead];
    if (this.count === 0) {
      this.stopRewind();
    }
    return frame;
  }

  public stopRewind(): RewindFrame | null {
    this.isRewinding = false;
    this.head = this.rewindPlayhead;
    return this.buffer[this.head];
  }

  public reset(): void {
    this.buffer.fill(null);
    this.head = 0;
    this.count = 0;
    this.isRewinding = false;
  }

  public getHistoryDurationSec(): number {
    return this.count / 60.0;
  }
}
