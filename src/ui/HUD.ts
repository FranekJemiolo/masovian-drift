import { VehicleState } from '../game/Types';

export class HUD {
  private container: HTMLDivElement;

  // Single player elements
  private speedEl!: HTMLElement;
  private rpmEl!: HTMLElement;
  private rpmBarEl!: HTMLElement;
  private gearEl!: HTMLElement;
  private lapEl!: HTMLElement;
  private timeEl!: HTMLElement;
  private rankEl!: HTMLElement;
  private driftScoreEl!: HTMLElement;
  private damageEl!: HTMLElement;

  // Telemetry load indicators
  private loadFLEl!: HTMLElement;
  private loadFREl!: HTMLElement;
  private loadRLEl!: HTMLElement;
  private loadRREl!: HTMLElement;

  // Split-screen elements (P2)
  private p2Container!: HTMLDivElement;
  private p2SpeedEl!: HTMLElement;
  private p2RpmEl!: HTMLElement;
  private p2GearEl!: HTMLElement;

  public isSplitScreen = false;

  constructor() {
    this.container = document.createElement('div');
    this.container.id = 'game-hud';
    this.createDom();
    document.body.appendChild(this.container);
  }

  private createDom(): void {
    this.container.innerHTML = `
      <div class="hud-top-bar">
        <div class="hud-card">
          <div class="hud-label">POSITION</div>
          <div id="hud-rank" class="hud-value rank-text">1st</div>
        </div>
        <div class="hud-card">
          <div class="hud-label">LAP</div>
          <div id="hud-lap" class="hud-value">1 / 3</div>
        </div>
        <div class="hud-card">
          <div class="hud-label">TIME</div>
          <div id="hud-time" class="hud-value">00:00.00</div>
        </div>
        <div id="hud-drift-card" class="hud-card drift-card">
          <div class="hud-label">DRIFT SCORE</div>
          <div id="hud-drift" class="hud-value drift-text">0 PTS</div>
        </div>
      </div>

      <div class="hud-bottom-bar">
        <!-- 4-Point Weight Transfer Telemetry -->
        <div class="hud-card telemetry-card">
          <div class="hud-label">WEIGHT TRANSFER</div>
          <div class="telemetry-grid">
            <div class="wheel-load" id="load-fl"><span class="wheel-tag">FL</span><div class="load-bar"><div class="fill" style="height: 40%"></div></div></div>
            <div class="wheel-load" id="load-fr"><span class="wheel-tag">FR</span><div class="load-bar"><div class="fill" style="height: 40%"></div></div></div>
            <div class="wheel-load" id="load-rl"><span class="wheel-tag">RL</span><div class="load-bar"><div class="fill" style="height: 60%"></div></div></div>
            <div class="wheel-load" id="load-rr"><span class="wheel-tag">RR</span><div class="load-bar"><div class="fill" style="height: 60%"></div></div></div>
          </div>
          <div id="hud-damage-status" class="damage-status">AERO: 100% | ALIGN: OK</div>
        </div>

        <!-- Main Speedometer & Tachometer Cluster -->
        <div class="hud-cluster">
          <div class="gear-display" id="hud-gear">1</div>
          <div class="speed-readout">
            <span id="hud-speed" class="speed-num">0</span>
            <span class="speed-unit">KM/H</span>
          </div>
          <div class="tachometer-wrap">
            <div class="tacho-bar-track">
              <div id="hud-rpm-bar" class="tacho-bar-fill"></div>
            </div>
            <div class="rpm-digital"><span id="hud-rpm">900</span> RPM</div>
          </div>
        </div>
      </div>

      <!-- Player 2 Cluster for Split Screen -->
      <div id="hud-p2" class="hud-p2-cluster" style="display: none;">
        <div class="p2-inner">
          <div class="hud-label">PLAYER 2</div>
          <div class="p2-speed-wrap">
            <span id="hud-p2-speed" class="speed-num">0</span>
            <span class="speed-unit">KM/H</span>
          </div>
          <div class="p2-gear-wrap">GEAR: <span id="hud-p2-gear">1</span> | <span id="hud-p2-rpm">900</span> RPM</div>
        </div>
      </div>
    `;

    this.speedEl = this.container.querySelector('#hud-speed')!;
    this.rpmEl = this.container.querySelector('#hud-rpm')!;
    this.rpmBarEl = this.container.querySelector('#hud-rpm-bar')!;
    this.gearEl = this.container.querySelector('#hud-gear')!;
    this.lapEl = this.container.querySelector('#hud-lap')!;
    this.timeEl = this.container.querySelector('#hud-time')!;
    this.rankEl = this.container.querySelector('#hud-rank')!;
    this.driftScoreEl = this.container.querySelector('#hud-drift')!;
    this.damageEl = this.container.querySelector('#hud-damage-status')!;

    this.loadFLEl = this.container.querySelector('#load-fl .fill')!;
    this.loadFREl = this.container.querySelector('#load-fr .fill')!;
    this.loadRLEl = this.container.querySelector('#load-rl .fill')!;
    this.loadRREl = this.container.querySelector('#load-rr .fill')!;

    this.p2Container = this.container.querySelector('#hud-p2')!;
    this.p2SpeedEl = this.container.querySelector('#hud-p2-speed')!;
    this.p2RpmEl = this.container.querySelector('#hud-p2-rpm')!;
    this.p2GearEl = this.container.querySelector('#hud-p2-gear')!;
  }

  public setSplitScreen(active: boolean): void {
    this.isSplitScreen = active;
    this.p2Container.style.display = active ? 'block' : 'none';
    if (active) {
      this.container.classList.add('split-screen-active');
    } else {
      this.container.classList.remove('split-screen-active');
    }
  }

  public show(): void {
    this.container.style.display = 'block';
  }

  public hide(): void {
    this.container.style.display = 'none';
  }

  public update(playerState: VehicleState, p2State?: VehicleState): void {
    this.speedEl.textContent = Math.round(playerState.speedKmh).toString();
    this.rpmEl.textContent = Math.round(playerState.rpm).toString();

    // RPM fill percentage (up to 7800 RPM)
    const rpmPercent = Math.min(100, Math.max(0, (playerState.rpm / 7800) * 100));
    this.rpmBarEl.style.width = `${rpmPercent}%`;
    if (playerState.rpm > 6800) {
      this.rpmBarEl.classList.add('redline');
    } else {
      this.rpmBarEl.classList.remove('redline');
    }

    // Gear formatting
    let gearText = playerState.gear.toString();
    if (playerState.gear === -1) gearText = 'R';
    else if (playerState.gear === 0) gearText = 'N';
    this.gearEl.textContent = gearText;

    // Lap and position
    this.lapEl.textContent = `${playerState.lap} / 3`;
    const rankSuffix = ['th', 'st', 'nd', 'rd', 'th', 'th', 'th'][playerState.raceRank] || 'th';
    this.rankEl.textContent = `${playerState.raceRank}${rankSuffix}`;

    // Lap time formatting (MM:SS.ms)
    const minutes = Math.floor(playerState.lapTime / 60);
    const seconds = Math.floor(playerState.lapTime % 60);
    const ms = Math.floor((playerState.lapTime * 100) % 100);
    this.timeEl.textContent = `${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;

    // Drift score
    this.driftScoreEl.textContent = `${playerState.driftScore} PTS`;
    const driftCard = this.container.querySelector('#hud-drift-card')!;
    if (playerState.isDrifting) {
      driftCard.classList.add('drifting-flame');
    } else {
      driftCard.classList.remove('drifting-flame');
    }

    // Weight transfer load telemetry
    const wt = playerState.weightTransfer;
    this.loadFLEl.style.height = `${Math.min(100, Math.max(5, wt.frontLeftLoad * 220))}%`;
    this.loadFREl.style.height = `${Math.min(100, Math.max(5, wt.frontRightLoad * 220))}%`;
    this.loadRLEl.style.height = `${Math.min(100, Math.max(5, wt.rearLeftLoad * 220))}%`;
    this.loadRREl.style.height = `${Math.min(100, Math.max(5, wt.rearRightLoad * 220))}%`;

    // Damage status text
    const aeroEfficiency = Math.round((1.0 / playerState.damage.aerodynamicDragPenalty) * 100);
    const alignOk = Math.abs(playerState.damage.steeringAlignmentOffset) < 0.01;
    this.damageEl.textContent = `AERO: ${aeroEfficiency}% | ALIGN: ${alignOk ? 'OK' : 'BENT'}`;
    if (!alignOk || aeroEfficiency < 85) {
      this.damageEl.classList.add('damaged');
    } else {
      this.damageEl.classList.remove('damaged');
    }

    // Player 2 update if in split-screen
    if (this.isSplitScreen && p2State) {
      this.p2SpeedEl.textContent = Math.round(p2State.speedKmh).toString();
      this.p2RpmEl.textContent = Math.round(p2State.rpm).toString();
      let p2Gear = p2State.gear.toString();
      if (p2State.gear === -1) p2Gear = 'R';
      this.p2GearEl.textContent = p2Gear;
    }
  }
}
