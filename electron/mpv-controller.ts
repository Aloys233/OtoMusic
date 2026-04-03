import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

type MpvMessage = {
  request_id?: number;
  error?: string;
  data?: unknown;
  event?: string;
  name?: string;
  reason?: string;
};

type PendingRequest = {
  resolve: (message: MpvMessage) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

const MPV_START_TIMEOUT_MS = 6000;
const MPV_REQUEST_TIMEOUT_MS = 5000;

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export class MpvController {
  private process: ChildProcessWithoutNullStreams | null = null;

  private socketPath = "";

  private socket: net.Socket | null = null;

  private startPromise: Promise<void> | null = null;

  private requestId = 1;

  private pendingRequests = new Map<number, PendingRequest>();

  private buffer = "";

  private endedCallback: (() => void) | null = null;

  private propertyCallback: ((name: string, value: unknown) => void) | null = null;

  private disposed = false;

  private available: boolean | null = null;

  setEventHandlers(handlers: {
    onEnded?: () => void;
    onProperty?: (name: string, value: unknown) => void;
  }) {
    this.endedCallback = handlers.onEnded ?? null;
    this.propertyCallback = handlers.onProperty ?? null;
  }

  async isAvailable() {
    if (this.available !== null) {
      return this.available;
    }

    try {
      await this.ensureStarted();
      this.available = true;
      return true;
    } catch {
      this.available = false;
      return false;
    }
  }

  async play(options: {
    url: string;
    startSeconds?: number;
    paused?: boolean;
    volume?: number;
    speed?: number;
  }) {
    await this.ensureStarted();

    const volume = isFiniteNumber(options.volume) ? clamp(options.volume, 0, 100) : 100;
    const speed = isFiniteNumber(options.speed) ? clamp(options.speed, 0.5, 2.0) : 1.0;
    const startSeconds = isFiniteNumber(options.startSeconds)
      ? Math.max(0, options.startSeconds)
      : 0;

    await this.setProperty("pause", true);
    await this.setProperty("volume", volume);
    await this.setProperty("speed", speed);

    if (startSeconds > 0) {
      await this.command(["loadfile", options.url, "replace", `start=${startSeconds}`]);
    } else {
      await this.command(["loadfile", options.url, "replace"]);
    }

    await this.setProperty("pause", Boolean(options.paused));
  }

  async pause() {
    await this.setProperty("pause", true);
  }

  async resume() {
    await this.setProperty("pause", false);
  }

  async stop() {
    await this.command(["stop"]);
  }

  async seek(seconds: number) {
    await this.command(["seek", Math.max(0, seconds), "absolute", "exact"]);
  }

  async setVolume(volume: number) {
    await this.setProperty("volume", clamp(volume, 0, 100));
  }

  async setSpeed(speed: number) {
    await this.setProperty("speed", clamp(speed, 0.5, 2.0));
  }

  async getTimePos() {
    const response = await this.command(["get_property", "time-pos"]);
    return isFiniteNumber(response.data) ? response.data : 0;
  }

  async getDuration() {
    const response = await this.command(["get_property", "duration"]);
    return isFiniteNumber(response.data) ? response.data : 0;
  }

  async dispose() {
    this.disposed = true;
    this.available = null;

    try {
      await this.command(["quit"]);
    } catch {
      // Ignore.
    }

    this.socket?.destroy();
    this.socket = null;

    this.rejectAllPending(new Error("mpv controller disposed"));

    if (this.process && !this.process.killed) {
      this.process.kill("SIGTERM");
    }
    this.process = null;

    if (this.socketPath) {
      try {
        fs.unlinkSync(this.socketPath);
      } catch {
        // Ignore cleanup failures.
      }
      this.socketPath = "";
    }
  }

  private async ensureStarted() {
    if (this.disposed) {
      throw new Error("mpv controller already disposed");
    }

    if (this.socket && !this.socket.destroyed) {
      return;
    }

    if (this.startPromise) {
      await this.startPromise;
      return;
    }

    this.startPromise = this.startInternal();

    try {
      await this.startPromise;
    } catch (error) {
      this.available = false;
      throw error;
    } finally {
      this.startPromise = null;
    }
  }

  private async startInternal() {
    this.socketPath = path.join(
      os.tmpdir(),
      `otomusic-mpv-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.sock`,
    );

    const args = [
      "--idle=yes",
      "--no-terminal",
      "--force-window=no",
      "--keep-open=yes",
      "--audio-exclusive=yes",
      "--alsa-resample=no",
      "--replaygain=no",
      "--msg-level=all=no",
      `--input-ipc-server=${this.socketPath}`,
    ];

    const child = spawn("mpv", args, {
      stdio: ["ignore", "ignore", "pipe"],
    });

    this.process = child;

    child.once("error", (error) => {
      this.rejectAllPending(error instanceof Error ? error : new Error(String(error)));
    });

    child.once("exit", () => {
      this.socket?.destroy();
      this.socket = null;
      this.rejectAllPending(new Error("mpv exited"));
    });

    const startAt = Date.now();
    while (!fs.existsSync(this.socketPath)) {
      if (Date.now() - startAt > MPV_START_TIMEOUT_MS) {
        throw new Error("mpv ipc socket did not appear in time");
      }
      await wait(40);
    }

    const socket = net.createConnection(this.socketPath);
    this.socket = socket;
    socket.setEncoding("utf8");

    socket.on("data", (chunk: string) => {
      this.handleData(chunk);
    });

    socket.on("error", (error) => {
      this.rejectAllPending(error instanceof Error ? error : new Error(String(error)));
    });

    socket.on("close", () => {
      this.rejectAllPending(new Error("mpv ipc socket closed"));
    });

    await once(socket, "connect");
    this.available = true;

    await this.command(["observe_property", 1, "time-pos"]);
    await this.command(["observe_property", 2, "duration"]);
    await this.command(["observe_property", 3, "pause"]);
  }

  private async setProperty(name: string, value: unknown) {
    await this.command(["set_property", name, value]);
  }

  private async command(command: unknown[]) {
    await this.ensureStarted();

    if (!this.socket || this.socket.destroyed) {
      throw new Error("mpv ipc socket is not connected");
    }

    const requestId = this.requestId;
    this.requestId += 1;

    return await new Promise<MpvMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`mpv request timeout: ${JSON.stringify(command)}`));
      }, MPV_REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(requestId, { resolve, reject, timer });

      const payload = JSON.stringify({ command, request_id: requestId });
      this.socket?.write(`${payload}\n`, (error) => {
        if (!error) {
          return;
        }

        const pending = this.pendingRequests.get(requestId);
        if (!pending) {
          return;
        }

        clearTimeout(pending.timer);
        this.pendingRequests.delete(requestId);
        pending.reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  private handleData(chunk: string) {
    this.buffer += chunk;
    let newlineIndex = this.buffer.indexOf("\n");

    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      newlineIndex = this.buffer.indexOf("\n");

      if (!line) {
        continue;
      }

      let message: MpvMessage;
      try {
        message = JSON.parse(line) as MpvMessage;
      } catch {
        continue;
      }

      this.handleMessage(message);
    }
  }

  private handleMessage(message: MpvMessage) {
    if (typeof message.request_id === "number") {
      const pending = this.pendingRequests.get(message.request_id);
      if (!pending) {
        return;
      }

      clearTimeout(pending.timer);
      this.pendingRequests.delete(message.request_id);

      if (message.error && message.error !== "success") {
        pending.reject(new Error(`mpv command failed: ${message.error}`));
        return;
      }

      pending.resolve(message);
      return;
    }

    if (message.event === "property-change" && typeof message.name === "string") {
      this.propertyCallback?.(message.name, message.data);
      return;
    }

    if (message.event === "end-file" && message.reason === "eof") {
      this.endedCallback?.();
    }
  }

  private rejectAllPending(error: Error) {
    this.pendingRequests.forEach((pending) => {
      clearTimeout(pending.timer);
      pending.reject(error);
    });
    this.pendingRequests.clear();
  }
}
