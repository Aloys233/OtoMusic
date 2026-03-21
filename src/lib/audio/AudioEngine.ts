type ReplayGainOptions = {
  trackGainDb?: number | null;
  albumGainDb?: number | null;
  preferAlbumGain?: boolean;
};

export class AudioEngine {
  private static instance: AudioEngine;

  private context: AudioContext | null = null;

  private mediaElement: HTMLAudioElement | null = null;

  private sourceNode: MediaElementAudioSourceNode | null = null;

  private replayGainNode: GainNode | null = null;

  private masterGainNode: GainNode | null = null;

  private initPromise: Promise<void> | null = null;

  private targetVolume = 0.75;

  private readonly fadeDuration = 0.2;

  private constructor() {
    // 使用 getInstance() 获取单例
  }

  static getInstance() {
    if (!AudioEngine.instance) {
      AudioEngine.instance = new AudioEngine();
    }
    return AudioEngine.instance;
  }

  async playStream(url: string, replayGain: ReplayGainOptions = {}) {
    await this.ensureInitialized();
    const nodes = this.getNodes();

    const isSwitchingTrack = nodes.mediaElement.src !== url;
    if (isSwitchingTrack && !nodes.mediaElement.paused) {
      await this.fadeOutCurrent(160);
    }

    if (isSwitchingTrack) {
      nodes.mediaElement.src = url;
      nodes.mediaElement.load();
      nodes.masterGainNode.gain.setValueAtTime(0, nodes.context.currentTime);
    }

    this.applyReplayGain(replayGain);

    await this.resume();
    await nodes.mediaElement.play();
    this.rampMasterGain(this.targetVolume, this.fadeDuration);
  }

  async resume() {
    await this.ensureInitialized();
    const { context } = this.getNodes();

    if (context.state === "suspended") {
      await context.resume();
    }
  }

  async pause() {
    await this.ensureInitialized();
    const nodes = this.getNodes();

    if (nodes.mediaElement.paused) {
      return;
    }

    await this.fadeOutCurrent(200);
    nodes.mediaElement.pause();
  }

  async seek(seconds: number) {
    await this.ensureInitialized();
    const nodes = this.getNodes();
    const duration = Number.isFinite(nodes.mediaElement.duration)
      ? nodes.mediaElement.duration
      : seconds;
    const safeSeconds = Math.max(0, Math.min(seconds, duration));

    const wasPlaying = !nodes.mediaElement.paused;
    if (wasPlaying) {
      this.rampMasterGain(0, this.fadeDuration / 2);
    }

    nodes.mediaElement.currentTime = safeSeconds;

    if (wasPlaying) {
      this.rampMasterGain(this.targetVolume, this.fadeDuration);
    }
  }

  setVolume(volume: number) {
    const safeVolume = Math.max(0, Math.min(1, volume));
    this.targetVolume = safeVolume;

    if (!this.context || !this.masterGainNode) {
      return;
    }

    const now = this.context.currentTime;
    this.masterGainNode.gain.cancelScheduledValues(now);
    this.masterGainNode.gain.setTargetAtTime(safeVolume, now, 0.03);
  }

  setReplayGainDb(db: number | null | undefined) {
    const safeDb = typeof db === "number" ? db : 0;
    const linearGain = Math.pow(10, safeDb / 20);

    if (!this.context || !this.replayGainNode) {
      return;
    }

    const now = this.context.currentTime;
    this.replayGainNode.gain.cancelScheduledValues(now);
    this.replayGainNode.gain.setTargetAtTime(linearGain, now, 0.03);
  }

  getCurrentTime() {
    return this.mediaElement?.currentTime ?? 0;
  }

  getDuration() {
    const duration = this.mediaElement?.duration;
    return Number.isFinite(duration) ? (duration as number) : 0;
  }

  async onEnded(listener: () => void) {
    await this.ensureInitialized();
    const { mediaElement } = this.getNodes();
    mediaElement.addEventListener("ended", listener);

    return () => {
      mediaElement.removeEventListener("ended", listener);
    };
  }

  private applyReplayGain(options: ReplayGainOptions) {
    const db = options.preferAlbumGain
      ? (options.albumGainDb ?? options.trackGainDb)
      : (options.trackGainDb ?? options.albumGainDb);

    this.setReplayGainDb(db ?? 0);
  }

  private async ensureInitialized() {
    if (this.initPromise) {
      await this.initPromise;
      return;
    }

    this.initPromise = (async () => {
      const AudioContextCtor = window.AudioContext;
      const context = new AudioContextCtor();
      const mediaElement = new Audio();

      mediaElement.preload = "auto";
      mediaElement.crossOrigin = "anonymous";

      const sourceNode = context.createMediaElementSource(mediaElement);
      const replayGainNode = context.createGain();
      const masterGainNode = context.createGain();

      replayGainNode.gain.value = 1;
      masterGainNode.gain.value = this.targetVolume;

      sourceNode.connect(replayGainNode);
      replayGainNode.connect(masterGainNode);
      masterGainNode.connect(context.destination);

      this.context = context;
      this.mediaElement = mediaElement;
      this.sourceNode = sourceNode;
      this.replayGainNode = replayGainNode;
      this.masterGainNode = masterGainNode;
    })();

    await this.initPromise;
  }

  private getNodes() {
    if (
      !this.context ||
      !this.mediaElement ||
      !this.sourceNode ||
      !this.replayGainNode ||
      !this.masterGainNode
    ) {
      throw new Error("AudioEngine is not initialized");
    }

    return {
      context: this.context,
      mediaElement: this.mediaElement,
      sourceNode: this.sourceNode,
      replayGainNode: this.replayGainNode,
      masterGainNode: this.masterGainNode,
    };
  }

  private rampMasterGain(target: number, durationSec: number) {
    if (!this.context || !this.masterGainNode) {
      return;
    }

    const now = this.context.currentTime;
    this.masterGainNode.gain.cancelScheduledValues(now);
    this.masterGainNode.gain.setValueAtTime(this.masterGainNode.gain.value, now);
    this.masterGainNode.gain.linearRampToValueAtTime(target, now + durationSec);
  }

  private async fadeOutCurrent(waitMs: number) {
    this.rampMasterGain(0, this.fadeDuration);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

export const audioEngine = AudioEngine.getInstance();
