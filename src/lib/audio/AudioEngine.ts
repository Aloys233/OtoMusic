import {
  isElectronRuntime,
  isMpvAvailable,
  listenMpvEnded,
  listenMpvProperty,
  mpvGetTimePos,
  mpvPause,
  mpvPlay,
  mpvResume,
  mpvSeek,
  mpvSetSpeed,
  mpvSetVolume,
  mpvStop,
} from "@/lib/desktop-api";

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

function tryDisconnect(node: AudioNode | null | undefined) {
  if (!node) {
    return;
  }

  try {
    node.disconnect();
  } catch {
    // Ignore redundant disconnects.
  }
}

export class AudioEngine {
  private static instance: AudioEngine;

  private context: AudioContext | null = null;

  private mediaElement: HTMLAudioElement | null = null;

  private sourceNode: MediaElementAudioSourceNode | null = null;

  private replayGainNode: GainNode | null = null;

  private preampGainNode: GainNode | null = null;

  private equalizerNodes: BiquadFilterNode[] = [];

  private masterGainNode: GainNode | null = null;

  private ensurePromise: Promise<void> | null = null;

  private targetVolume = 0.75;

  private preampGainDb = 0;

  private equalizerEnabled = false;

  private equalizerBands = [...EQ_BAND_FREQUENCIES.map(() => 0)];

  private gaplessEnabled = true;

  private crossfadeEnabled = false;

  private crossfadeDurationSec = 3;

  private fadeDuration = 0.2;

  private playbackRate = 1.0;

  private passthroughEnabled = false;

  private outputDeviceId = "default";

  private endedListeners = new Set<() => void>();

  private mpvAvailable: boolean | null = null;

  private mpvTimePos = 0;

  private mpvDuration = 0;

  private mpvPaused = true;

  private mpvPropertyUnsubscribe: (() => void) | null = null;

  private mpvEndedUnsubscribe: (() => void) | null = null;

  private currentStreamUrl = "";

  private pendingStartSeconds: number | null = null;

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
    const previousStreamUrl = this.currentStreamUrl;
    this.currentStreamUrl = url;
    const pendingStartSeconds = this.consumePendingStartSeconds();

    if (await this.shouldUseMpvBackend()) {
      const isSameStream = previousStreamUrl === url;

      if (isSameStream && pendingStartSeconds === null) {
        await mpvResume();
        this.mpvPaused = false;
        return;
      }

      if (isSameStream && pendingStartSeconds !== null) {
        await mpvSeek(pendingStartSeconds);
        await mpvResume();
        this.mpvTimePos = pendingStartSeconds;
        this.mpvPaused = false;
        return;
      }

      await mpvPlay({
        url,
        startSeconds: pendingStartSeconds ?? undefined,
        paused: false,
        volume: this.targetVolume * 100,
        speed: this.playbackRate,
      });
      this.mpvPaused = false;
      return;
    }

    await this.ensureInitialized();
    const mediaElement = this.getMediaElement();

    const isSwitchingTrack = mediaElement.src !== url;
    const wasPlaying = !mediaElement.paused;
    const supportsGainTransition = !this.passthroughEnabled && Boolean(this.context && this.masterGainNode);
    const shouldCrossfade = supportsGainTransition && isSwitchingTrack && wasPlaying && this.crossfadeEnabled;
    const shouldUseTransitionFade =
      supportsGainTransition && isSwitchingTrack && wasPlaying && (!this.gaplessEnabled || shouldCrossfade);

    if (shouldUseTransitionFade) {
      const fadeMs = shouldCrossfade
        ? Math.round(this.crossfadeDurationSec * 1000)
        : 160;
      await this.fadeOutCurrent(fadeMs);
    }

    if (isSwitchingTrack) {
      mediaElement.src = url;
      mediaElement.load();
      if (pendingStartSeconds !== null) {
        this.restoreCurrentTime(mediaElement, pendingStartSeconds);
      }
      if (shouldUseTransitionFade && this.context && this.masterGainNode) {
        this.masterGainNode.gain.setValueAtTime(0, this.context.currentTime);
      } else if (!this.passthroughEnabled && this.context && this.masterGainNode) {
        this.masterGainNode.gain.setValueAtTime(this.targetVolume, this.context.currentTime);
      }
    } else if (pendingStartSeconds !== null) {
      mediaElement.currentTime = pendingStartSeconds;
    }

    if (!this.passthroughEnabled) {
      this.applyReplayGain(replayGain);
    }

    await this.resume();
    await mediaElement.play();

    if (!this.passthroughEnabled) {
      if (isSwitchingTrack && shouldUseTransitionFade) {
        const duration = shouldCrossfade ? this.crossfadeDurationSec : this.fadeDuration;
        this.rampMasterGain(this.targetVolume, duration);
        return;
      }

      this.rampMasterGain(this.targetVolume, this.fadeDuration);
    }
  }

  async resume() {
    if (this.isUsingMpvBackend()) {
      await mpvResume();
      this.mpvPaused = false;
      return;
    }

    await this.ensureInitialized();
    if (this.context && this.context.state === "suspended") {
      await this.context.resume();
    }
  }

  async pause() {
    if (this.isUsingMpvBackend()) {
      await mpvPause();
      this.mpvPaused = true;
      return;
    }

    await this.ensureInitialized();
    const mediaElement = this.getMediaElement();

    if (mediaElement.paused) {
      return;
    }

    if (!this.passthroughEnabled) {
      await this.fadeOutCurrent(200);
    }
    mediaElement.pause();
  }

  async seek(seconds: number) {
    if (this.isUsingMpvBackend()) {
      const safeSeconds = Math.max(0, seconds);
      await mpvSeek(safeSeconds);
      this.mpvTimePos = safeSeconds;
      return;
    }

    await this.ensureInitialized();
    const mediaElement = this.getMediaElement();
    const duration = Number.isFinite(mediaElement.duration)
      ? mediaElement.duration
      : seconds;
    const safeSeconds = Math.max(0, Math.min(seconds, duration));

    const wasPlaying = !mediaElement.paused;
    if (wasPlaying && !this.passthroughEnabled) {
      this.rampMasterGain(0, this.fadeDuration / 2);
    }

    mediaElement.currentTime = safeSeconds;

    if (wasPlaying && !this.passthroughEnabled) {
      this.rampMasterGain(this.targetVolume, this.fadeDuration);
    }
  }

  setVolume(volume: number) {
    const safeVolume = Math.max(0, Math.min(1, volume));
    this.targetVolume = safeVolume;

    if (this.isUsingMpvBackend()) {
      void mpvSetVolume(safeVolume * 100);
      return;
    }

    if (this.mediaElement) {
      this.mediaElement.volume = this.passthroughEnabled ? safeVolume : 1;
    }

    if (this.passthroughEnabled || !this.context || !this.masterGainNode) {
      return;
    }

    const now = this.context.currentTime;
    this.masterGainNode.gain.cancelScheduledValues(now);
    this.masterGainNode.gain.setTargetAtTime(safeVolume, now, 0.03);
  }

  setReplayGainDb(db: number | null | undefined) {
    const safeDb = typeof db === "number" ? db : 0;
    const linearGain = Math.pow(10, safeDb / 20);

    if (this.passthroughEnabled || !this.context || !this.replayGainNode) {
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

    if (this.passthroughEnabled || !this.context || !this.preampGainNode) {
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

    if (this.isUsingMpvBackend()) {
      void mpvSetSpeed(safeRate);
    }

    if (this.mediaElement) {
      this.mediaElement.playbackRate = safeRate;
    }
  }

  async setPassthroughEnabled(enabled: boolean) {
    const nextEnabled = Boolean(enabled);
    if (this.passthroughEnabled === nextEnabled) {
      return;
    }

    const previousUsingMpv = this.isUsingMpvBackend();
    const snapshotTime = await this.captureCurrentTime();
    this.pendingStartSeconds = snapshotTime > 0 ? snapshotTime : null;

    this.passthroughEnabled = nextEnabled;

    if (nextEnabled) {
      await this.ensureMpvReady();
    }

    const nextUsingMpv = this.isUsingMpvBackend();

    if (previousUsingMpv && !nextUsingMpv) {
      await mpvPause().catch(() => {
        // Ignore backend switch pause failure.
      });
      await mpvStop().catch(() => {
        // Ignore backend switch stop failure.
      });
    }

    if (!this.mediaElement && !nextUsingMpv) {
      return;
    }

    if (nextUsingMpv) {
      this.mediaElement?.pause();
      this.disposeProcessingPipeline();
      if (this.mediaElement) {
        this.mediaElement.volume = this.targetVolume;
      }
      return;
    }

    await this.rebuildMediaPipeline();
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
    this.outputDeviceId = deviceId;
    await this.ensureInitialized();
    const mediaElement = this.getMediaElement();
    const sinkAwareElement = mediaElement as SinkAwareAudioElement;

    if (typeof sinkAwareElement.setSinkId !== "function") {
      throw new Error("当前环境不支持音频输出设备切换");
    }

    await sinkAwareElement.setSinkId(deviceId);
  }

  getCurrentTime() {
    if (this.isUsingMpvBackend()) {
      return this.mpvTimePos;
    }

    return this.mediaElement?.currentTime ?? 0;
  }

  getDuration() {
    if (this.isUsingMpvBackend()) {
      return this.mpvDuration;
    }

    const duration = this.mediaElement?.duration;
    return Number.isFinite(duration) ? (duration as number) : 0;
  }

  async onEnded(listener: () => void) {
    await this.ensureInitialized();
    const mediaElement = this.getMediaElement();
    this.endedListeners.add(listener);
    mediaElement.addEventListener("ended", listener);

    return () => {
      this.endedListeners.delete(listener);
      this.mediaElement?.removeEventListener("ended", listener);
    };
  }

  dispose() {
    this.mpvPropertyUnsubscribe?.();
    this.mpvPropertyUnsubscribe = null;
    this.mpvEndedUnsubscribe?.();
    this.mpvEndedUnsubscribe = null;

    if (this.mediaElement) {
      this.endedListeners.forEach((listener) => {
        this.mediaElement?.removeEventListener("ended", listener);
      });

      try {
        this.mediaElement.pause();
      } catch {
        // Ignore pause failures during teardown.
      }

      try {
        this.mediaElement.src = "";
        this.mediaElement.load();
      } catch {
        // Ignore source reset failures during teardown.
      }
    }

    this.endedListeners.clear();
    this.disposeProcessingPipeline();

    this.mediaElement = null;
    this.ensurePromise = null;
    this.currentStreamUrl = "";
    this.pendingStartSeconds = null;
    this.mpvAvailable = null;
    this.mpvTimePos = 0;
    this.mpvDuration = 0;
    this.mpvPaused = true;
  }

  private applyReplayGain(options: ReplayGainOptions) {
    const db = options.preferAlbumGain
      ? (options.albumGainDb ?? options.trackGainDb)
      : (options.trackGainDb ?? options.albumGainDb);

    this.setReplayGainDb(db ?? 0);
  }

  private async ensureInitialized() {
    if (this.ensurePromise) {
      await this.ensurePromise;
      return;
    }

    this.ensurePromise = (async () => {
      if (!this.mediaElement) {
        this.mediaElement = this.createMediaElement();
      }

      this.mediaElement.playbackRate = this.playbackRate;
      this.mediaElement.volume = this.passthroughEnabled ? this.targetVolume : 1;
      await this.applyOutputDevice(this.mediaElement);

      if (!this.passthroughEnabled) {
        this.ensureProcessingPipeline();
      }
    })();

    try {
      await this.ensurePromise;
    } finally {
      this.ensurePromise = null;
    }
  }

  private createMediaElement() {
    const mediaElement = new Audio();
    mediaElement.preload = "auto";
    mediaElement.crossOrigin = "anonymous";
    mediaElement.playbackRate = this.playbackRate;
    mediaElement.volume = this.passthroughEnabled ? this.targetVolume : 1;

    this.endedListeners.forEach((listener) => {
      mediaElement.addEventListener("ended", listener);
    });

    return mediaElement;
  }

  private ensureProcessingPipeline() {
    if (this.context && this.sourceNode && this.replayGainNode && this.preampGainNode && this.masterGainNode) {
      return;
    }

    if (!this.mediaElement) {
      throw new Error("AudioEngine is not initialized");
    }

    const AudioContextCtor = window.AudioContext;
    const context = new AudioContextCtor();
    const sourceNode = context.createMediaElementSource(this.mediaElement);
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
    this.sourceNode = sourceNode;
    this.replayGainNode = replayGainNode;
    this.preampGainNode = preampGainNode;
    this.equalizerNodes = equalizerNodes;
    this.masterGainNode = masterGainNode;

    this.syncEqualizerGain();
  }

  private async rebuildMediaPipeline() {
    const previousElement = this.mediaElement;
    if (!previousElement) {
      return;
    }

    const previousSrc = previousElement.src;
    const previousTime = previousElement.currentTime;
    const shouldResume = !previousElement.paused;

    previousElement.pause();

    const nextElement = this.createMediaElement();
    this.mediaElement = nextElement;

    this.disposeProcessingPipeline();

    if (!this.passthroughEnabled) {
      this.ensureProcessingPipeline();
      this.setPreampGainDb(this.preampGainDb);
      this.syncEqualizerGain();
    }

    await this.applyOutputDevice(nextElement);

    if (previousSrc) {
      nextElement.src = previousSrc;
      nextElement.load();
      this.restoreCurrentTime(nextElement, previousTime);
    }

    if (shouldResume && previousSrc) {
      await this.resume();
      try {
        await nextElement.play();
      } catch {
        // Keep engine usable even if browser blocks immediate resume.
      }
    }

    try {
      previousElement.src = "";
      previousElement.load();
    } catch {
      // Ignore cleanup failures.
    }
  }

  private async applyOutputDevice(mediaElement: HTMLAudioElement) {
    if (!this.outputDeviceId || this.outputDeviceId === "default") {
      return;
    }

    const sinkAwareElement = mediaElement as SinkAwareAudioElement;
    if (typeof sinkAwareElement.setSinkId !== "function") {
      return;
    }

    try {
      await sinkAwareElement.setSinkId(this.outputDeviceId);
    } catch {
      // Keep playback available if sink restore fails.
    }
  }

  private restoreCurrentTime(mediaElement: HTMLAudioElement, seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return;
    }

    const applyTime = () => {
      try {
        mediaElement.currentTime = seconds;
      } catch {
        // Ignore restore failures for streams that don't support seek.
      }
    };

    if (mediaElement.readyState >= 1) {
      applyTime();
      return;
    }

    mediaElement.addEventListener("loadedmetadata", applyTime, { once: true });
  }

  private disposeProcessingPipeline() {
    tryDisconnect(this.sourceNode);
    tryDisconnect(this.replayGainNode);
    tryDisconnect(this.preampGainNode);
    this.equalizerNodes.forEach((node) => {
      tryDisconnect(node);
    });
    tryDisconnect(this.masterGainNode);

    if (this.context && this.context.state !== "closed") {
      void this.context.close().catch(() => {
        // Ignore close failure.
      });
    }

    this.context = null;
    this.sourceNode = null;
    this.replayGainNode = null;
    this.preampGainNode = null;
    this.equalizerNodes = [];
    this.masterGainNode = null;
  }

  private getMediaElement() {
    if (!this.mediaElement) {
      throw new Error("AudioEngine is not initialized");
    }

    return this.mediaElement;
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
    if (this.passthroughEnabled || !this.context || this.equalizerNodes.length === 0) {
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

  private isUsingMpvBackend() {
    return this.passthroughEnabled && this.mpvAvailable === true && isElectronRuntime();
  }

  private async shouldUseMpvBackend() {
    if (!this.passthroughEnabled) {
      return false;
    }

    return await this.ensureMpvReady();
  }

  private async ensureMpvReady() {
    if (!isElectronRuntime()) {
      this.mpvAvailable = false;
      return false;
    }

    if (this.mpvAvailable === null) {
      this.mpvAvailable = await isMpvAvailable().catch(() => false);
    }

    if (!this.mpvAvailable) {
      return false;
    }

    if (!this.mpvPropertyUnsubscribe) {
      this.mpvPropertyUnsubscribe = listenMpvProperty((name, value) => {
        if (name === "time-pos" && typeof value === "number" && Number.isFinite(value)) {
          this.mpvTimePos = value;
          return;
        }

        if (name === "duration" && typeof value === "number" && Number.isFinite(value)) {
          this.mpvDuration = value;
          return;
        }

        if (name === "pause") {
          this.mpvPaused = value === true;
        }
      });
    }

    if (!this.mpvEndedUnsubscribe) {
      this.mpvEndedUnsubscribe = listenMpvEnded(() => {
        this.emitEndedCallbacks();
      });
    }

    return true;
  }

  private async captureCurrentTime() {
    if (this.isUsingMpvBackend()) {
      const current = await mpvGetTimePos().catch(() => this.mpvTimePos);
      this.mpvTimePos = Number.isFinite(current) ? current : this.mpvTimePos;
      return this.mpvTimePos;
    }

    return this.mediaElement?.currentTime ?? 0;
  }

  private consumePendingStartSeconds() {
    const value = this.pendingStartSeconds;
    this.pendingStartSeconds = null;
    return value;
  }

  private emitEndedCallbacks() {
    this.endedListeners.forEach((listener) => {
      try {
        listener();
      } catch {
        // Ignore listener failures.
      }
    });
  }
}

export const audioEngine = AudioEngine.getInstance();
