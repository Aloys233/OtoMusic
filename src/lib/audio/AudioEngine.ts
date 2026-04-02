type ReplayGainOptions = {
  trackGainDb?: number | null;
  albumGainDb?: number | null;
  preferAlbumGain?: boolean;
};

const EQ_BAND_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] as const;

type SinkAwareAudioElement = HTMLAudioElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
  sinkId?: string;
};

export class AudioEngine {
  private static instance: AudioEngine;

  private context: AudioContext | null = null;

  private mediaElement: HTMLAudioElement | null = null;

  private sourceNode: MediaElementAudioSourceNode | null = null;

  private replayGainNode: GainNode | null = null;

  private preampGainNode: GainNode | null = null;

  private equalizerNodes: BiquadFilterNode[] = [];

  private masterGainNode: GainNode | null = null;

  private initPromise: Promise<void> | null = null;

  private targetVolume = 0.75;

  private preampGainDb = 0;

  private equalizerEnabled = false;

  private equalizerBands = [...EQ_BAND_FREQUENCIES.map(() => 0)];

  private gaplessEnabled = true;

  private crossfadeEnabled = false;

  private crossfadeDurationSec = 3;

  private fadeDuration = 0.2;

  private playbackRate = 1.0;

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
    const wasPlaying = !nodes.mediaElement.paused;
    const shouldCrossfade = isSwitchingTrack && wasPlaying && this.crossfadeEnabled;
    const shouldUseTransitionFade = isSwitchingTrack && wasPlaying && (!this.gaplessEnabled || shouldCrossfade);

    if (shouldUseTransitionFade) {
      const fadeMs = shouldCrossfade
        ? Math.round(this.crossfadeDurationSec * 1000)
        : 160;
      await this.fadeOutCurrent(fadeMs);
    }

    if (isSwitchingTrack) {
      nodes.mediaElement.src = url;
      nodes.mediaElement.load();
      if (shouldUseTransitionFade) {
        nodes.masterGainNode.gain.setValueAtTime(0, nodes.context.currentTime);
      } else {
        nodes.masterGainNode.gain.setValueAtTime(this.targetVolume, nodes.context.currentTime);
      }
    }

    this.applyReplayGain(replayGain);

    await this.resume();
    await nodes.mediaElement.play();
    if (isSwitchingTrack && shouldUseTransitionFade) {
      const duration = shouldCrossfade ? this.crossfadeDurationSec : this.fadeDuration;
      this.rampMasterGain(this.targetVolume, duration);
      return;
    }

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

  setPreampGainDb(db: number) {
    const safeDb = Number.isFinite(db) ? Math.max(-12, Math.min(12, db)) : 0;
    this.preampGainDb = safeDb;
    const linearGain = Math.pow(10, safeDb / 20);

    if (!this.context || !this.preampGainNode) {
      return;
    }

    const now = this.context.currentTime;
    this.preampGainNode.gain.cancelScheduledValues(now);
    this.preampGainNode.gain.setTargetAtTime(linearGain, now, 0.03);
  }

  setGaplessEnabled(enabled: boolean) {
    this.gaplessEnabled = enabled;
  }

  setCrossfadeEnabled(enabled: boolean) {
    this.crossfadeEnabled = enabled;
  }

  setCrossfadeDurationSec(seconds: number) {
    const safeSeconds = Number.isFinite(seconds) ? Math.max(1, Math.min(10, seconds)) : 3;
    this.crossfadeDurationSec = safeSeconds;
  }

  setFadeDuration(seconds: number) {
    this.fadeDuration = Number.isFinite(seconds) ? Math.max(0.05, Math.min(0.5, seconds)) : 0.2;
  }

  setPlaybackRate(rate: number) {
    const safeRate = Number.isFinite(rate) ? Math.max(0.5, Math.min(2.0, rate)) : 1.0;
    this.playbackRate = safeRate;

    if (this.mediaElement) {
      this.mediaElement.playbackRate = safeRate;
    }
  }

  setEqualizerEnabled(enabled: boolean) {
    this.equalizerEnabled = enabled;
    this.syncEqualizerGain();
  }

  setEqualizerBands(bands: number[]) {
    if (!Array.isArray(bands) || bands.length !== EQ_BAND_FREQUENCIES.length) {
      return;
    }

    this.equalizerBands = bands.map((gain) =>
      Number.isFinite(gain) ? Math.max(-12, Math.min(12, gain)) : 0);
    this.syncEqualizerGain();
  }

  setEqualizerBand(index: number, gainDb: number) {
    if (index < 0 || index >= EQ_BAND_FREQUENCIES.length) {
      return;
    }

    const safeGain = Number.isFinite(gainDb) ? Math.max(-12, Math.min(12, gainDb)) : 0;
    this.equalizerBands[index] = safeGain;
    this.syncEqualizerGain(index);
  }

  getEqualizerBands() {
    return [...this.equalizerBands];
  }

  getEqualizerFrequencies() {
    return [...EQ_BAND_FREQUENCIES];
  }

  getPreampGainDb() {
    return this.preampGainDb;
  }

  async getOutputDevices() {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.enumerateDevices !== "function"
    ) {
      return [];
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === "audiooutput");
  }

  supportsOutputDeviceSelection() {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.enumerateDevices !== "function"
    ) {
      return false;
    }

    if (typeof window === "undefined") {
      return false;
    }

    return "setSinkId" in window.HTMLMediaElement.prototype;
  }

  async setOutputDevice(deviceId: string) {
    await this.ensureInitialized();
    const { mediaElement } = this.getNodes();
    const sinkAwareElement = mediaElement as SinkAwareAudioElement;

    if (typeof sinkAwareElement.setSinkId !== "function") {
      throw new Error("当前环境不支持音频输出设备切换");
    }

    await sinkAwareElement.setSinkId(deviceId);
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
      mediaElement.playbackRate = this.playbackRate;

      const sourceNode = context.createMediaElementSource(mediaElement);
      const replayGainNode = context.createGain();
      const preampGainNode = context.createGain();
      const equalizerNodes = EQ_BAND_FREQUENCIES.map((frequency, index) => {
        const node = context.createBiquadFilter();
        const isLowBand = index === 0;
        const isHighBand = index === EQ_BAND_FREQUENCIES.length - 1;
        node.type = isLowBand ? "lowshelf" : isHighBand ? "highshelf" : "peaking";
        node.frequency.value = frequency;
        node.Q.value = isLowBand || isHighBand ? 0.7 : 1.05;
        node.gain.value = 0;
        return node;
      });
      const masterGainNode = context.createGain();

      replayGainNode.gain.value = 1;
      preampGainNode.gain.value = Math.pow(10, this.preampGainDb / 20);
      masterGainNode.gain.value = this.targetVolume;

      sourceNode.connect(replayGainNode);
      replayGainNode.connect(preampGainNode);
      if (equalizerNodes.length > 0) {
        preampGainNode.connect(equalizerNodes[0]);
        for (let index = 0; index < equalizerNodes.length - 1; index += 1) {
          equalizerNodes[index]?.connect(equalizerNodes[index + 1] as BiquadFilterNode);
        }
        equalizerNodes[equalizerNodes.length - 1]?.connect(masterGainNode);
      } else {
        preampGainNode.connect(masterGainNode);
      }
      masterGainNode.connect(context.destination);

      this.context = context;
      this.mediaElement = mediaElement;
      this.sourceNode = sourceNode;
      this.replayGainNode = replayGainNode;
      this.preampGainNode = preampGainNode;
      this.equalizerNodes = equalizerNodes;
      this.masterGainNode = masterGainNode;
      this.syncEqualizerGain();
    })();

    await this.initPromise;
  }

  private getNodes() {
    if (
      !this.context ||
      !this.mediaElement ||
      !this.sourceNode ||
      !this.replayGainNode ||
      !this.preampGainNode ||
      !this.masterGainNode
    ) {
      throw new Error("AudioEngine is not initialized");
    }

    return {
      context: this.context,
      mediaElement: this.mediaElement,
      sourceNode: this.sourceNode,
      replayGainNode: this.replayGainNode,
      preampGainNode: this.preampGainNode,
      equalizerNodes: this.equalizerNodes,
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
    const durationSec = Math.max(this.fadeDuration, waitMs / 1000);
    this.rampMasterGain(0, durationSec);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  private syncEqualizerGain(onlyIndex?: number) {
    if (!this.context || this.equalizerNodes.length === 0) {
      return;
    }

    const applyAt = this.context.currentTime;
    const updateNode = (node: BiquadFilterNode, index: number) => {
      const gain = this.equalizerEnabled ? this.equalizerBands[index] ?? 0 : 0;
      node.gain.cancelScheduledValues(applyAt);
      node.gain.setTargetAtTime(gain, applyAt, 0.035);
    };

    if (typeof onlyIndex === "number" && this.equalizerNodes[onlyIndex]) {
      updateNode(this.equalizerNodes[onlyIndex], onlyIndex);
      return;
    }

    this.equalizerNodes.forEach((node, index) => {
      updateNode(node, index);
    });
  }
}

export const audioEngine = AudioEngine.getInstance();
