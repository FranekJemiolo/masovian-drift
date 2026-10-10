import { VehicleTelemetry } from '../Components';
import { ECSWorldManager } from '../World';
import { AudioManager } from '../../audio/AudioManager';

export class TelemetrySystem {
  public static getPlayerSpeed(eid: number): number {
    return VehicleTelemetry.speedKmh[eid];
  }

  public static getPlayerRpm(eid: number): number {
    return VehicleTelemetry.rpm[eid];
  }

  public static updateAudio(audioManager: AudioManager, currentSurface: string, throttle: number): void {
    const ecs = ECSWorldManager.getInstance();
    const playerEid = ecs.playerEntity;
    if (playerEid <= 0) return;

    audioManager.updatePlayerEngine(
      VehicleTelemetry.rpm[playerEid],
      throttle,
      VehicleTelemetry.slipAngle[playerEid],
      VehicleTelemetry.speedKmh[playerEid],
      currentSurface
    );
  }
}
