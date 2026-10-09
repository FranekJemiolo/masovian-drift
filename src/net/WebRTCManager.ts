import { QWBPProtocol } from './QWBPProtocol';
import { NetworkVehicleFrame, StateSync } from './StateSync';

export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  // Open TURN relay fallback for mobile Symmetric NAT networks
  {
    urls: 'turn:openrelay.metered.ca:80',
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
];

export class WebRTCManager {
  public pc: RTCPeerConnection | null = null;
  public dataChannel: RTCDataChannel | null = null;
  public isConnected = false;
  public isHost = false;

  // Backpressure Management (Milestone 5 requirement)
  // Drops update rate to 10 FPS when SCTP outbound buffer fills up past 64kB!
  public isCongested = false;
  private readonly bufferLowThreshold = 65536; // 64 kB
  public targetSendFps = 60;

  private onRemoteFrameCallback?: (frame: NetworkVehicleFrame) => void;
  private onConnectionStateChangeCallback?: (state: RTCPeerConnectionState) => void;

  constructor(
    onRemoteFrame?: (frame: NetworkVehicleFrame) => void,
    onStateChange?: (state: RTCPeerConnectionState) => void
  ) {
    this.onRemoteFrameCallback = onRemoteFrame;
    this.onConnectionStateChangeCallback = onStateChange;
  }

  /**
   * Initializes host peer connection and returns compressed QWBP QR Offer payload
   */
  public async createHostOffer(): Promise<string> {
    this.isHost = true;
    this.initPeerConnection();

    // Create unordered, unreliable RTCDataChannel for fast vehicle state sync
    this.dataChannel = this.pc!.createDataChannel('masovian-mesh', {
      ordered: false,
      maxRetransmits: 0,
    });
    this.setupDataChannel(this.dataChannel);

    const offer = await this.pc!.createOffer();
    await this.pc!.setLocalDescription(offer);
    await this.waitForIceGathering();

    if (!this.pc!.localDescription?.sdp) {
      throw new Error('Failed to create local SDP');
    }

    return QWBPProtocol.compressSDP(this.pc!.localDescription.sdp, 'offer');
  }

  /**
   * Accepts Guest answer QWBP payload on Host
   */
  public async acceptHostAnswer(compressedAnswer: string): Promise<void> {
    if (!this.pc) throw new Error('Host PC not initialized');
    const { sdp } = QWBPProtocol.decompressSDP(compressedAnswer);
    await this.pc.setRemoteDescription({ type: 'answer', sdp });
  }

  /**
   * Initializes guest peer connection, processes Host QWBP offer and returns QWBP Answer payload
   */
  public async handleOfferAndCreateAnswer(compressedOffer: string): Promise<string> {
    this.isHost = false;
    this.initPeerConnection();

    // Guest receives data channel via event
    this.pc!.ondatachannel = (event) => {
      this.setupDataChannel(event.channel);
    };

    const { sdp } = QWBPProtocol.decompressSDP(compressedOffer);
    await this.pc!.setRemoteDescription({ type: 'offer', sdp });

    const answer = await this.pc!.createAnswer();
    await this.pc!.setLocalDescription(answer);
    await this.waitForIceGathering();

    if (!this.pc!.localDescription?.sdp) {
      throw new Error('Failed to create local answer SDP');
    }

    return QWBPProtocol.compressSDP(this.pc!.localDescription.sdp, 'answer');
  }

  private initPeerConnection(): void {
    if (this.pc) {
      this.pc.close();
    }

    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this.pc.onconnectionstatechange = () => {
      const state = this.pc?.connectionState ?? 'closed';
      this.isConnected = state === 'connected';
      this.onConnectionStateChangeCallback?.(state);
    };
  }

  private setupDataChannel(channel: RTCDataChannel): void {
    this.dataChannel = channel;
    this.dataChannel.binaryType = 'arraybuffer';
    this.dataChannel.bufferedAmountLowThreshold = this.bufferLowThreshold;

    this.dataChannel.onopen = () => {
      this.isConnected = true;
    };

    this.dataChannel.onclose = () => {
      this.isConnected = false;
    };

    // Backpressure handling:
    // If the 64kB SCTP buffer clears, return to full 60 FPS
    this.dataChannel.onbufferedamountlow = () => {
      this.isCongested = false;
      this.targetSendFps = 60;
    };

    this.dataChannel.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        const frame = StateSync.deserializeState(event.data);
        this.onRemoteFrameCallback?.(frame);
      }
    };
  }

  /**
   * Transmits binary ArrayBuffer state over RTCDataChannel, monitoring buffer backpressure
   */
  public sendState(buffer: ArrayBuffer): void {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') return;

    // Check buffer backpressure against 64kB limit
    if (this.dataChannel.bufferedAmount >= this.bufferLowThreshold) {
      this.isCongested = true;
      this.targetSendFps = 10; // Drop to 10 FPS to protect WebRTC SCTP pipeline
      return;
    }

    try {
      this.dataChannel.send(buffer);
    } catch (err) {
      console.warn('DataChannel send error:', err);
    }
  }

  /**
   * Waits for complete ICE gathering with safety timeout
   */
  private waitForIceGathering(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.pc || this.pc.iceGatheringState === 'complete') {
        resolve();
        return;
      }

      const timeout = setTimeout(() => resolve(), 1200);

      const checkState = () => {
        if (this.pc?.iceGatheringState === 'complete') {
          clearTimeout(timeout);
          this.pc.removeEventListener('icegatheringstatechange', checkState);
          resolve();
        }
      };

      this.pc.addEventListener('icegatheringstatechange', checkState);
    });
  }

  public close(): void {
    try {
      this.dataChannel?.close();
      this.pc?.close();
    } catch (_) {}
    this.isConnected = false;
  }
}
