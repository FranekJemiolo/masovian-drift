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
  private driftCardEl!: HTMLElement;
  private damageEl!: HTMLElement;
  private biasTagEl!: HTMLElement;

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
    this.container.style.display = 'none';
    this.createDom();
    document.body.appendChild(this.container);
  }

  private createDom(): void {
    this.container.innerHTML = `
      <!-- TOP STATUS BAR -->
      <div class="hud-top-bar">
        <div class="hud-card hud-glass">
          <div class="hud-label">POSITION</div>
          <div id="hud-rank" class="hud-value rank-text">1st</div>
        </div>
        <div class="hud-card hud-glass">
          <div class="hud-label">LAP</div>
          <div id="hud-lap" class="hud-value">1 / 3</div>
        </div>
        <div class="hud-card hud-glass">
          <div class="hud-label">LAP TIME</div>
          <div id="hud-time" class="hud-value time-mono">00:00.00</div>
        </div>
        <div id="hud-drift-card" class="hud-card hud-glass drift-card">
          <div class="hud-label">DRIFT SCORE</div>
          <div id="hud-drift" class="hud-value drift-text">0 PTS</div>
        </div>
      </div>

      <!-- BOTTOM CLUSTERS (Pinned Strictly to Bottom Edges) -->
      <div class="hud-bottom-bar">
        <!-- 4-Point Dynamic Weight Transfer Telemetry -->
        <div class="telemetry-card hud-glass">
          <div class="hud-card-header">
            <span class="hud-label">4-POINT SUSPENSION LOAD</span>
            <span id="hud-bias-tag" class="bias-tag">40F / 60R</span>
          </div>
          <div class="chassis-diagram">
            <div class="chassis-silhouette">
              <div class="axle-line front-axle"></div>
              <div class="chassis-spine"></div>
              <div class="axle-line rear-axle"></div>
              <div class="engine-rear-badge">RWD BOXER</div>
            </div>
            <div class="tire-patch patch-fl" id="patch-fl">
              <span class="patch-name">FL</span>
              <div class="patch-bar"><div class="fill" style="height: 40%"></div></div>
            </div>
            <div class="tire-patch patch-fr" id="patch-fr">
              <span class="patch-name">FR</span>
              <div class="patch-bar"><div class="fill" style="height: 40%"></div></div>
            </div>
            <div class="tire-patch patch-rl" id="patch-rl">
              <span class="patch-name">RL</span>
              <div class="patch-bar"><div class="fill" style="height: 60%"></div></div>
            </div>
            <div class="tire-patch patch-rr" id="patch-rr">
              <span class="patch-name">RR</span>
              <div class="patch-bar"><div class="fill" style="height: 60%"></div></div>
            </div>
          </div>
          <div class="telemetry-footer">
            <span id="hud-damage-status" class="damage-status">AERO: 100% | ALIGN: OK</span>
          </div>
        </div>

        <!-- Main Speedometer & Tachometer Cluster -->
        <div class="hud-cluster hud-glass">
          <div class="gear-badge">
            <span class="gear-sub">GEAR</span>
            <span class="gear-display" id="hud-gear">1</span>
          </div>

          <div class="cluster-speed-wrap">
            <div class="speed-row">
              <span id="hud-speed" class="speed-num">0</span>
              <span class="speed-unit">KM/H</span>
            </div>
            <div class="tacho-wrap">
              <div class="tacho-bar-track">
                <div id="hud-rpm-bar" class="tacho-bar-fill"></div>
              </div>
              <div class="tacho-ticks">
                <span>0</span>
                <span>2k</span>
                <span>4k</span>
                <span>6k</span>
                <span class="redline-tick">7.5k</span>
              </div>
            </div>
          </div>

          <div class="rpm-digital-box">
            <span id="hud-rpm" class="rpm-num">900</span>
            <span class="rpm-lbl">RPM</span>
          </div>
        </div>
      </div>

      <!-- Player 2 Cluster for Split Screen -->
      <div id="hud-p2" class="hud-p2-cluster hud-glass" style="display: none;">
        <div class="hud-label">PLAYER 2 (RIGHT SCREEN)</div>
        <div class="p2-speed-wrap">
          <span id="hud-p2-speed" class="speed-num">0</span>
          <span class="speed-unit">KM/H</span>
        </div>
        <div class="p2-gear-wrap">GEAR: <span id="hud-p2-gear">1</span> | <span id="hud-p2-rpm">900</span> RPM</div>
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
    this.driftCardEl = this.container.querySelector('#hud-drift-card')!;
    this.damageEl = this.container.querySelector('#hud-damage-status')!;
    this.biasTagEl = this.container.querySelector('#hud-bias-tag')!;

    this.loadFLEl = this.container.querySelector('#patch-fl .fill')!;
    this.loadFREl = this.container.querySelector('#patch-fr .fill')!;
    this.loadRLEl = this.container.querySelector('#patch-rl .fill')!;
    this.loadRREl = this.container.querySelector('#patch-rr .fill')!;

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

    // Drift score & flame animation
    this.driftScoreEl.textContent = `${playerState.driftScore} PTS`;
    if (playerState.isDrifting) {
      this.driftCardEl.classList.add('drifting-flame');
    } else {
      this.driftCardEl.classList.remove('drifting-flame');
    }

    // Weight transfer load telemetry
    const wt = playerState.weightTransfer;
    const fPct = Math.round(wt.frontBias * 100);
    const rPct = 100 - fPct;
    this.biasTagEl.textContent = `${fPct}F / ${rPct}R`;

    // Dynamic wheel load heights (scaled 0-100%)
    this.loadFLEl.style.height = `${Math.min(100, Math.max(8, wt.frontLeftLoad * 220))}%`;
    this.loadFREl.style.height = `${Math.min(100, Math.max(8, wt.frontRightLoad * 220))}%`;
    this.loadRLEl.style.height = `${Math.min(100, Math.max(8, wt.rearLeftLoad * 220))}%`;
    this.loadRREl.style.height = `${Math.min(100, Math.max(8, wt.rearRightLoad * 220))}%`;

    // Highlight oversteer / unloaded rear
    if (wt.rearBias < 0.45 && Math.abs(playerState.steer) > 0.05) {
      this.biasTagEl.classList.add('oversteer-alert');
    } else {
      this.biasTagEl.classList.remove('oversteer-alert');
    }

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
