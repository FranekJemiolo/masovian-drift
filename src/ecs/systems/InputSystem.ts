import { InputManager } from '../../controls/InputManager';
import { VehicleInput } from '../Components';
import { ECSWorldManager } from '../World';

export class InputSystem {
  public static update(inputManager: InputManager, isCountingDown: boolean): void {
    const ecs = ECSWorldManager.getInstance();
    const playerEid = ecs.playerEntity;

    if (playerEid > 0) {
      let p1 = inputManager.getPlayerInputs();
      if (isCountingDown) {
        VehicleInput.throttle[playerEid] = 0.35;
        VehicleInput.brake[playerEid] = 1.0;
        VehicleInput.steer[playerEid] = p1.steer;
        VehicleInput.handbrake[playerEid] = 1.0;
      } else {
        VehicleInput.throttle[playerEid] = p1.throttle;
        VehicleInput.brake[playerEid] = p1.brake;
        VehicleInput.steer[playerEid] = p1.steer;
        VehicleInput.handbrake[playerEid] = p1.handbrake ? 1.0 : 0.0;
      }
    }

    const p2Eid = ecs.p2Entity;
    if (p2Eid > 0) {
      let p2 = inputManager.getPlayer2Inputs();
      if (isCountingDown) {
        VehicleInput.throttle[p2Eid] = 0.35;
        VehicleInput.brake[p2Eid] = 1.0;
        VehicleInput.steer[p2Eid] = p2.steer;
        VehicleInput.handbrake[p2Eid] = 1.0;
      } else {
        VehicleInput.throttle[p2Eid] = p2.throttle;
        VehicleInput.brake[p2Eid] = p2.brake;
        VehicleInput.steer[p2Eid] = p2.steer;
        VehicleInput.handbrake[p2Eid] = p2.handbrake ? 1.0 : 0.0;
      }
    }
  }
}
