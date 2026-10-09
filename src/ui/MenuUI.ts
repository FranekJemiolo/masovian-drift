import { AudioManager } from '../audio/AudioManager';
import { EvolutionStore } from '../economy/EvolutionStore';
import { GameMode } from '../game/Types';
import { InputManager } from '../controls/InputManager';
import { QWBPProtocol } from '../net/QWBPProtocol';

export interface MenuCallbacks {
  onStartGame: (mode: GameMode) => void;
  onOpenMultiplayer: () => void;
  onOpenGarage: () => void;
  onTogglePixelShader: () => void;
}

export class MenuUI {
  private container: HTMLDivElement;
  private evolutionStore: EvolutionStore;
  private callbacks: MenuCallbacks;

  // Mobile controls overlay
  private touchOverlay: HTMLDivElement | null = null;

  constructor(evolutionStore: EvolutionStore, callbacks: MenuCallbacks) {
    this.evolutionStore = evolutionStore;
    this.callbacks = callbacks;
    this.container = document.createElement('div');
    this.container.id = 'menu-root';
    document.body.appendChild(this.container);

    this.renderMainMenu();
    this.setupMobileTouchControls();
  }

  public renderMainMenu(): void {
    this.container.innerHTML = `
      <div class="menu-backdrop">
        <div class="menu-panel">
          <div class="title-header">
            <div class="subtitle-tag">WARSAW SUBURBS RETRO RACING</div>
            <h1 class="game-title">VOXEL BOXER</h1>
            <div class="masovian-tag">MASOVIAN DRIFT</div>
          </div>

          <div class="menu-car-card">
            <div class="car-era-badge">${this.evolutionStore.getCurrentCar().era} ERA</div>
            <div class="car-name-text">${this.evolutionStore.getCurrentCar().modelName}</div>
            <div class="car-stats-row">
              <span>POWER: ${this.evolutionStore.getCurrentCar().specs.enginePowerKw} kW</span>
              <span>MASS: ${this.evolutionStore.getCurrentCar().specs.mass} kg</span>
              <span>BUDGET: ${this.evolutionStore.state.currencyPln} PLN</span>
            </div>
          </div>

          <div class="menu-actions">
            <button id="btn-quick-race" class="btn-primary">
              <span class="btn-icon">🏁</span> QUICK RACE (VS 5 AI)
            </button>
            <button id="btn-split-screen" class="btn-secondary">
              <span class="btn-icon">👥</span> SPLIT-SCREEN DUEL (2P LOCAL)
            </button>
            <button id="btn-multiplayer" class="btn-secondary">
              <span class="btn-icon">📡</span> P2P MULTIPLAYER (QR CODE)
            </button>
            <button id="btn-garage" class="btn-secondary">
              <span class="btn-icon">🔧</span> EVOLUTION GARAGE & TUNING
            </button>
          </div>

          <div class="menu-footer">
            <div class="footer-ctrl-hint">
              <span class="ctrl-chip">W / ▲ Gas</span>
              <span class="ctrl-chip">S / ▼ Brake</span>
              <span class="ctrl-chip">A/D / ◀▶ Steer</span>
              <span class="ctrl-chip">Space Drift</span>
              <span class="ctrl-chip">C Camera</span>
            </div>
            <button id="btn-gyro-perm" class="btn-mini-gyro" style="display: none;">
              📱 Enable Tilt Gyro
            </button>
          </div>
        </div>
      </div>
    `;

    this.setupMenuListeners();
  }

  private setupMenuListeners(): void {
    const btnQuick = this.container.querySelector('#btn-quick-race') as HTMLButtonElement;
    const btnSplit = this.container.querySelector('#btn-split-screen') as HTMLButtonElement;
    const btnMulti = this.container.querySelector('#btn-multiplayer') as HTMLButtonElement;
    const btnGarage = this.container.querySelector('#btn-garage') as HTMLButtonElement;
    const btnGyro = this.container.querySelector('#btn-gyro-perm') as HTMLButtonElement;

    const audio = AudioManager.getInstance();

    [btnQuick, btnSplit, btnMulti, btnGarage].forEach((b) => {
      b?.addEventListener('mouseenter', () => audio.playUiHover());
    });

    btnQuick?.addEventListener('click', () => {
      audio.playUiClick();
      this.hide();
      this.callbacks.onStartGame('quick-race');
    });

    btnSplit?.addEventListener('click', () => {
      audio.playUiClick();
      this.hide();
      this.callbacks.onStartGame('split-screen');
    });

    btnMulti?.addEventListener('click', () => {
      audio.playUiClick();
      this.callbacks.onOpenMultiplayer();
    });

    btnGarage?.addEventListener('click', () => {
      audio.playUiClick();
      this.renderGarageModal();
    });

    const input = InputManager.getInstance();
    if (input.isMobileDevice && btnGyro) {
      btnGyro.style.display = 'inline-block';
      btnGyro.addEventListener('click', async () => {
        const ok = await input.requestGyroPermission();
        if (ok) {
          btnGyro.textContent = '✓ Gyro Enabled';
          btnGyro.classList.add('active');
        }
      });
    }
  }

  public renderGarageModal(): void {
    const currentCar = this.evolutionStore.getCurrentCar();
    const state = this.evolutionStore.state;

    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-header">
          <h2>EVOLUTION GARAGE & WORKSHOP</h2>
          <button id="btn-close-modal" class="btn-close">&times;</button>
        </div>

        <div class="garage-wallet-bar">
          <span>WALLET BALANCE: <strong>${state.currencyPln} PLN</strong></span>
          <span>AERO DRAG PENALTY: <strong>+${Math.round((currentCar.damage.aerodynamicDragPenalty - 1.0) * 100)}%</strong></span>
        </div>

        <div class="garage-cars-grid">
          ${state.garage.map((car) => `
            <div class="garage-car-item ${car.id === currentCar.id ? 'active' : ''}" data-car-id="${car.id}">
              <div class="car-era-pill">${car.era}</div>
              <h3>${car.modelName}</h3>
              <p>Power: ${car.specs.enginePowerKw} kW | Mass: ${car.specs.mass} kg</p>
              <button class="btn-select-car" data-car-id="${car.id}">
                ${car.id === currentCar.id ? 'SELECTED' : 'DRIVE'}
              </button>
            </div>
          `).join('')}
        </div>

        <div class="garage-section-title">TUNING & PERSISTENT REPAIR</div>
        <div class="upgrades-grid">
          <div class="upgrade-card">
            <h4>Chassis Repair & Alignment</h4>
            <p>Restore damaged bodywork, eliminate aero drag penalty, and realign steering.</p>
            <button id="btn-repair-car" class="btn-upgrade">REPAIR (Est. 1200 PLN)</button>
          </div>

          <div class="upgrade-card ${currentCar.upgrades.lightweightFlywheel ? 'installed' : ''}">
            <h4>Lightweight Billet Flywheel</h4>
            <p>Drastically increases throttle rev response, but drops momentum on steep sand dunes.</p>
            <button class="btn-buy-upgrade" data-upgrade="lightweightFlywheel">
              ${currentCar.upgrades.lightweightFlywheel ? 'INSTALLED' : 'BUY (3,500 PLN)'}
            </button>
          </div>

          <div class="upgrade-card ${currentCar.upgrades.openExhaust ? 'installed' : ''}">
            <h4>Titanium Racing Exhaust</h4>
            <p>Adds +18 kW engine output and gives a louder Boxer exhaust rumble.</p>
            <button class="btn-buy-upgrade" data-upgrade="openExhaust">
              ${currentCar.upgrades.openExhaust ? 'INSTALLED' : 'BUY (2,800 PLN)'}
            </button>
          </div>

          <div class="upgrade-card ${currentCar.upgrades.sandTires ? 'installed' : ''}">
            <h4>Mazovian Hybrid Sand Tires</h4>
            <p>Increases lateral traction across Świder river dunes from 0.42 to 0.65.</p>
            <button class="btn-buy-upgrade" data-upgrade="sandTires">
              ${currentCar.upgrades.sandTires ? 'INSTALLED' : 'BUY (3,200 PLN)'}
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#btn-close-modal')?.addEventListener('click', () => {
      modal.remove();
      this.renderMainMenu();
    });

    modal.querySelectorAll('.btn-select-car').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = (e.target as HTMLElement).getAttribute('data-car-id');
        if (id) {
          this.evolutionStore.selectCar(id);
          modal.remove();
          this.renderGarageModal();
        }
      });
    });

    modal.querySelector('#btn-repair-car')?.addEventListener('click', () => {
      const res = this.evolutionStore.repairCar(currentCar.id);
      alert(res.message);
      modal.remove();
      this.renderGarageModal();
    });

    modal.querySelectorAll('.btn-buy-upgrade').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const upType = (e.target as HTMLElement).getAttribute('data-upgrade') as any;
        if (upType) {
          const res = this.evolutionStore.buyUpgrade(currentCar.id, upType);
          alert(res.message);
          modal.remove();
          this.renderGarageModal();
        }
      });
    });
  }

  public renderMultiplayerModal(
    onHost: () => Promise<string>,
    onAcceptAnswer: (answer: string) => Promise<void>,
    onJoin: (offer: string) => Promise<string>
  ): void {
    const modal = document.createElement('div');
    modal.className = 'modal-backdrop';
    modal.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-header">
          <h2>SERVERLESS P2P MULTIPLAYER (QWBP)</h2>
          <button id="btn-close-mp" class="btn-close">&times;</button>
        </div>

        <div class="mp-tabs">
          <button id="tab-host" class="mp-tab active">HOST RACE</button>
          <button id="tab-join" class="mp-tab">JOIN RACE</button>
        </div>

        <!-- Host View -->
        <div id="view-host" class="mp-view">
          <p class="mp-desc">Click Host to generate a ~60-byte compressed QR Code. Have the Guest scan it with their camera or paste the code below:</p>
          <button id="btn-generate-host" class="btn-primary">CREATE HOST QR</button>
          <div id="host-qr-wrap" class="qr-code-wrap" style="display: none;">
            <img id="host-qr-img" class="qr-img" alt="QWBP Host QR" />
            <div class="code-box">
              <input id="host-code-input" readonly />
              <button id="btn-copy-host-code" class="btn-small">Copy Code</button>
            </div>
            <div class="host-step2">
              <label>Step 2: Paste Guest's Answer Code here:</label>
              <div class="code-box">
                <input id="guest-answer-input" placeholder="Paste Guest answer code..." />
                <button id="btn-connect-host" class="btn-primary">Connect Guest</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Join View -->
        <div id="view-join" class="mp-view" style="display: none;">
          <p class="mp-desc">Scan Host's QR Code using your device camera, or paste Host's code below:</p>
          <div class="camera-scanner-wrap">
            <video id="scanner-video" class="scanner-preview" style="display: none;"></video>
            <button id="btn-start-camera" class="btn-secondary">📷 Start Camera Scanner</button>
          </div>
          <div class="code-box">
            <input id="join-offer-input" placeholder="Paste Host code here..." />
            <button id="btn-process-offer" class="btn-primary">Join Room</button>
          </div>
          <div id="join-qr-wrap" class="qr-code-wrap" style="display: none;">
            <p>Show this Answer QR Code to the Host (or copy below):</p>
            <img id="join-qr-img" class="qr-img" alt="QWBP Answer QR" />
            <div class="code-box">
              <input id="join-answer-input" readonly />
              <button id="btn-copy-answer-code" class="btn-small">Copy Code</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#btn-close-mp')?.addEventListener('click', () => {
      modal.remove();
    });

    const tabHost = modal.querySelector('#tab-host') as HTMLButtonElement;
    const tabJoin = modal.querySelector('#tab-join') as HTMLButtonElement;
    const viewHost = modal.querySelector('#view-host') as HTMLElement;
    const viewJoin = modal.querySelector('#view-join') as HTMLElement;

    tabHost.addEventListener('click', () => {
      tabHost.classList.add('active');
      tabJoin.classList.remove('active');
      viewHost.style.display = 'block';
      viewJoin.style.display = 'none';
    });

    tabJoin.addEventListener('click', () => {
      tabJoin.classList.add('active');
      tabHost.classList.remove('active');
      viewHost.style.display = 'none';
      viewJoin.style.display = 'block';
    });

    // Host generation
    const btnGen = modal.querySelector('#btn-generate-host') as HTMLButtonElement;
    const hostQrWrap = modal.querySelector('#host-qr-wrap') as HTMLElement;
    const hostQrImg = modal.querySelector('#host-qr-img') as HTMLImageElement;
    const hostCodeInput = modal.querySelector('#host-code-input') as HTMLInputElement;

    btnGen.addEventListener('click', async () => {
      btnGen.textContent = 'Generating QWBP Offer...';
      const compressedOffer = await onHost();
      const qrDataUrl = await QWBPProtocol.generateQRCode(compressedOffer);
      hostQrImg.src = qrDataUrl;
      hostCodeInput.value = compressedOffer;
      hostQrWrap.style.display = 'block';
      btnGen.style.display = 'none';
    });

    modal.querySelector('#btn-copy-host-code')?.addEventListener('click', () => {
      navigator.clipboard.writeText(hostCodeInput.value);
      alert('Host QWBP Code copied to clipboard!');
    });

    modal.querySelector('#btn-connect-host')?.addEventListener('click', async () => {
      const answerInput = modal.querySelector('#guest-answer-input') as HTMLInputElement;
      if (answerInput.value) {
        await onAcceptAnswer(answerInput.value);
        modal.remove();
        this.hide();
        this.callbacks.onStartGame('multiplayer-host');
      }
    });

    // Join processing
    const btnProcessOffer = modal.querySelector('#btn-process-offer') as HTMLButtonElement;
    const joinOfferInput = modal.querySelector('#join-offer-input') as HTMLInputElement;
    const joinQrWrap = modal.querySelector('#join-qr-wrap') as HTMLElement;
    const joinQrImg = modal.querySelector('#join-qr-img') as HTMLImageElement;
    const joinAnswerInput = modal.querySelector('#join-answer-input') as HTMLInputElement;

    const handleOfferInput = async (offerCode: string) => {
      const answerCode = await onJoin(offerCode);
      const answerQrUrl = await QWBPProtocol.generateQRCode(answerCode);
      joinQrImg.src = answerQrUrl;
      joinAnswerInput.value = answerCode;
      joinQrWrap.style.display = 'block';
    };

    btnProcessOffer.addEventListener('click', async () => {
      if (joinOfferInput.value) {
        await handleOfferInput(joinOfferInput.value);
      }
    });

    modal.querySelector('#btn-copy-answer-code')?.addEventListener('click', () => {
      navigator.clipboard.writeText(joinAnswerInput.value);
      alert('Answer code copied! Paste it in Host window.');
      modal.remove();
      this.hide();
      this.callbacks.onStartGame('multiplayer-join');
    });

    // Camera scanner
    const btnStartCamera = modal.querySelector('#btn-start-camera') as HTMLButtonElement;
    const video = modal.querySelector('#scanner-video') as HTMLVideoElement;
    btnStartCamera.addEventListener('click', async () => {
      video.style.display = 'block';
      btnStartCamera.style.display = 'none';
      try {
        const reader = QWBPProtocol.getZxingReader();
        reader.decodeFromVideoDevice(null, video, async (result) => {
          if (result) {
            reader.reset();
            video.style.display = 'none';
            joinOfferInput.value = result.getText();
            await handleOfferInput(result.getText());
          }
        });
      } catch (err) {
        alert('Camera access denied or unavailable: ' + err);
      }
    });
  }

  private setupMobileTouchControls(): void {
    const input = InputManager.getInstance();
    if (!input.isMobileDevice) return;

    this.touchOverlay = document.createElement('div');
    this.touchOverlay.id = 'touch-controls';
    this.touchOverlay.innerHTML = `
      <div id="touch-brake-zone" class="touch-zone touch-brake">
        <span class="touch-label">BRAKE</span>
      </div>
      <div id="touch-handbrake-btn" class="touch-btn touch-handbrake">
        <span>DRIFT</span>
      </div>
      <div id="touch-cam-btn" class="touch-btn touch-cam">
        <span>CAM</span>
      </div>
      <div id="touch-gas-zone" class="touch-zone touch-gas">
        <span class="touch-label">GAS</span>
      </div>
    `;
    document.body.appendChild(this.touchOverlay);

    const brakeZone = this.touchOverlay.querySelector('#touch-brake-zone')!;
    const gasZone = this.touchOverlay.querySelector('#touch-gas-zone')!;
    const handbrakeBtn = this.touchOverlay.querySelector('#touch-handbrake-btn')!;

    // Gas zone touch
    gasZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      input.touchThrottle = 1.0;
    }, { passive: false });
    gasZone.addEventListener('touchend', (e) => {
      e.preventDefault();
      input.touchThrottle = 0.0;
    }, { passive: false });

    // Brake zone touch
    brakeZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      input.touchBrake = 1.0;
    }, { passive: false });
    brakeZone.addEventListener('touchend', (e) => {
      e.preventDefault();
      input.touchBrake = 0.0;
    }, { passive: false });

    // Handbrake button
    handbrakeBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      input.touchHandbrake = true;
    }, { passive: false });
    handbrakeBtn.addEventListener('touchend', (e) => {
      e.preventDefault();
      input.touchHandbrake = false;
    }, { passive: false });
  }

  public show(): void {
    this.container.style.display = 'block';
  }

  public hide(): void {
    this.container.style.display = 'none';
  }
}
