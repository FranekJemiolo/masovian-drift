import pako from 'pako';
import QRCode from 'qrcode';
import { BrowserMultiFormatReader } from '@zxing/library';

export interface MinimalCandidate {
  ip: string;
  port: number;
  type: string; // 'host' | 'srflx' | 'relay'
  proto: string; // 'udp' | 'tcp'
}

export interface QWBPPresence {
  t: 'o' | 'a'; // offer or answer
  u: string;     // ice-ufrag
  p: string;     // ice-pwd
  f: string;     // fingerprint hex
  c: MinimalCandidate[];
}

export class QWBPProtocol {
  private static zxingReader: BrowserMultiFormatReader | null = null;

  /**
   * Compresses a raw WebRTC SDP string into a ~60-120 byte binary DEFLATE base64url string
   */
  public static compressSDP(sdp: string, type: 'offer' | 'answer'): string {
    const ufragMatch = sdp.match(/a=ice-ufrag:([^\r\n]+)/);
    const pwdMatch = sdp.match(/a=ice-pwd:([^\r\n]+)/);
    const fingerprintMatch = sdp.match(/a=fingerprint:sha-256 ([^\r\n]+)/);

    const candidates: MinimalCandidate[] = [];
    const candidateLines = sdp.match(/a=candidate:([^\r\n]+)/g) || [];

    for (const line of candidateLines) {
      const parts = line.replace('a=candidate:', '').trim().split(' ');
      if (parts.length >= 8) {
        candidates.push({
          ip: parts[4],
          port: parseInt(parts[5], 10),
          proto: parts[2].toLowerCase(),
          type: parts[7].toLowerCase(),
        });
      }
    }

    const payload: QWBPPresence = {
      t: type === 'offer' ? 'o' : 'a',
      u: ufragMatch ? ufragMatch[1] : '',
      p: pwdMatch ? pwdMatch[1] : '',
      f: fingerprintMatch ? fingerprintMatch[1].replace(/:/g, '') : '',
      c: candidates.slice(0, 4), // Keep most relevant STUN/host candidates to stay ultra-compact
    };

    const jsonStr = JSON.stringify(payload);
    const binary = new TextEncoder().encode(jsonStr);
    const deflated = pako.deflate(binary);

    return this.uint8ToBase64Url(deflated);
  }

  /**
   * Decompresses a QWBP payload back into a standard RFC-compliant WebRTC SDP string
   */
  public static decompressSDP(compressed: string): { sdp: string; type: 'offer' | 'answer' } {
    const bytes = this.base64UrlToUint8(compressed.trim());
    const inflated = pako.inflate(bytes);
    const jsonStr = new TextDecoder().decode(inflated);
    const payload: QWBPPresence = JSON.parse(jsonStr);

    // Format sha-256 fingerprint with colons
    const formattedFp = payload.f.match(/.{1,2}/g)?.join(':').toUpperCase() || '';

    // Reconstruct valid WebRTC SDP with data channel m-line
    let sdp =
      'v=0\r\n' +
      'o=- 1234567890 2 IN IP4 127.0.0.1\r\n' +
      's=-\r\n' +
      't=0 0\r\n' +
      'a=group:BUNDLE 0\r\n' +
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n' +
      'c=IN IP4 0.0.0.0\r\n' +
      `a=ice-ufrag:${payload.u}\r\n` +
      `a=ice-pwd:${payload.p}\r\n` +
      `a=fingerprint:sha-256 ${formattedFp}\r\n` +
      `a=setup:${payload.t === 'o' ? 'actpass' : 'active'}\r\n` +
      'a=mid:0\r\n' +
      'a=sctp-port:5000\r\n' +
      'a=max-message-size:262144\r\n';

    let foundation = 1;
    for (const c of payload.c) {
      sdp += `a=candidate:${foundation++} 1 ${c.proto.toUpperCase()} 2122260223 ${c.ip} ${c.port} typ ${c.type}\r\n`;
    }

    return {
      sdp,
      type: payload.t === 'o' ? 'offer' : 'answer',
    };
  }

  /**
   * Generates a QR Code as a Data URL (image/png)
   */
  public static async generateQRCode(data: string): Promise<string> {
    return QRCode.toDataURL(data, {
      errorCorrectionLevel: 'L', // Low redundancy = smallest QR modules for crisp scanning
      margin: 1,
      scale: 6,
      color: {
        dark: '#09090b',
        light: '#ffffff',
      },
    });
  }

  /**
   * Initializes webcam reader using @zxing/library
   */
  public static getZxingReader(): BrowserMultiFormatReader {
    if (!this.zxingReader) {
      this.zxingReader = new BrowserMultiFormatReader();
    }
    return this.zxingReader;
  }

  private static uint8ToBase64Url(bytes: Uint8Array): string {
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  private static base64UrlToUint8(base64Url: string): Uint8Array {
    let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) base64 += '=';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
}
