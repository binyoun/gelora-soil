export type FacingMode = 'environment' | 'user';

export class Camera {
  readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private facing: FacingMode = 'user';

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  async start(facing: FacingMode = this.facing): Promise<void> {
    this.stop();
    this.facing = facing;
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: facing,
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });
    this.video.srcObject = this.stream;
    await this.video.play();
  }

  async toggleFacing(): Promise<void> {
    await this.start(this.facing === 'environment' ? 'user' : 'environment');
  }

  get currentFacing(): FacingMode {
    return this.facing;
  }

  stop(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}
