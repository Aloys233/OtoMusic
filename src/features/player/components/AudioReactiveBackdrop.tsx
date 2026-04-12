import { motion, useMotionTemplate, useMotionValue, useTransform } from "framer-motion";
import { type CSSProperties, useEffect, useRef } from "react";

import { audioEngine } from "@/lib/audio/AudioEngine";
import { cn } from "@/lib/utils";

type AudioReactiveBackdropProps = {
  ambientColor: string;
  isPlaying: boolean;
  backgroundBlurEnabled?: boolean;
};

type ReactiveFrameState = {
  energy: number;
  bass: number;
  mid: number;
  treble: number;
  pulse: number;
};

const IDLE_TARGET: ReactiveFrameState = {
  energy: 0,
  bass: 0,
  mid: 0,
  treble: 0,
  pulse: 0,
};

function lerp(current: number, target: number, factor: number) {
  return current + (target - current) * factor;
}

export function AudioReactiveBackdrop({
  ambientColor,
  isPlaying,
  backgroundBlurEnabled = true,
}: AudioReactiveBackdropProps) {
  const energy = useMotionValue(0);
  const bass = useMotionValue(0);
  const mid = useMotionValue(0);
  const treble = useMotionValue(0);
  const pulse = useMotionValue(0);
  const stateRef = useRef<ReactiveFrameState>({ ...IDLE_TARGET });

  useEffect(() => {
    let frameId = 0;

    const tick = () => {
      const snapshot = audioEngine.getAudioReactiveSnapshot();
      const hasAudioInput = isPlaying && snapshot.available;
      const target = hasAudioInput ? snapshot : IDLE_TARGET;
      const frameState = stateRef.current;

      const baseFollow = hasAudioInput ? 0.22 : 0.08;
      frameState.energy = lerp(frameState.energy, target.energy, baseFollow * 0.8);
      frameState.bass = lerp(frameState.bass, target.bass, baseFollow);
      frameState.mid = lerp(frameState.mid, target.mid, baseFollow * 0.86);
      frameState.treble = lerp(frameState.treble, target.treble, baseFollow * 0.92);

      const pulseDecay = hasAudioInput ? 0.83 : 0.9;
      const pulseDrive = hasAudioInput ? target.pulse : 0;
      frameState.pulse = Math.max(0, frameState.pulse * pulseDecay + pulseDrive * 0.24);

      energy.set(frameState.energy);
      bass.set(frameState.bass);
      mid.set(frameState.mid);
      treble.set(frameState.treble);
      pulse.set(frameState.pulse);

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [bass, energy, isPlaying, mid, pulse, treble]);

  const ambientOpacity = useTransform(energy, [0, 1], [0.2, 0.56]);

  const orbOneOpacity = useTransform(energy, [0, 1], [0.36, 0.88]);
  const orbOneScale = useTransform(bass, [0, 1], [0.98, 1.22]);
  const orbOneX = useTransform(bass, [0, 1], [-14, 26]);
  const orbOneY = useTransform(pulse, [0, 1], [4, -28]);
  const orbOneBrightness = useTransform(pulse, [0, 1], [0.9, 1.85]);
  const orbOneSaturation = useTransform(energy, [0, 1], [1.15, 1.85]);

  const orbTwoOpacity = useTransform(mid, [0, 1], [0.28, 0.72]);
  const orbTwoScale = useTransform(mid, [0, 1], [0.94, 1.14]);
  const orbTwoX = useTransform(treble, [0, 1], [-18, 30]);
  const orbTwoY = useTransform(pulse, [0, 1], [2, -20]);
  const orbTwoBrightness = useTransform(pulse, [0, 1], [0.92, 1.68]);
  const orbTwoSaturation = useTransform(mid, [0, 1], [1.1, 1.6]);

  const orbThreeOpacity = useTransform(treble, [0, 1], [0.24, 0.66]);
  const orbThreeScale = useTransform(pulse, [0, 1], [0.9, 1.2]);
  const orbThreeX = useTransform(mid, [0, 1], [-14, 26]);
  const orbThreeY = useTransform(bass, [0, 1], [14, -20]);
  const orbThreeBrightness = useTransform(pulse, [0, 1], [0.9, 1.72]);
  const orbThreeSaturation = useTransform(treble, [0, 1], [1.06, 1.62]);

  const pulseRingOpacity = useTransform(pulse, [0, 1], [0.02, 0.32]);
  const pulseRingScale = useTransform(pulse, [0, 1], [0.95, 1.32]);

  const blurPx = backgroundBlurEnabled ? 26 : 14;
  const orbOneFilter = useMotionTemplate`blur(${blurPx}px) saturate(${orbOneSaturation}) brightness(${orbOneBrightness})`;
  const orbTwoFilter = useMotionTemplate`blur(${blurPx}px) saturate(${orbTwoSaturation}) brightness(${orbTwoBrightness})`;
  const orbThreeFilter = useMotionTemplate`blur(${blurPx}px) saturate(${orbThreeSaturation}) brightness(${orbThreeBrightness})`;
  const pulseRingBrightness = useTransform(pulse, [0, 1], [0.9, 1.5]);
  const pulseRingFilter = useMotionTemplate`blur(12px) brightness(${pulseRingBrightness})`;

  const overlayStyle = {
    "--np-ambient-color": ambientColor,
  } as CSSProperties;

  return (
    <div
      className={cn(
        "np-audio-reactive-layer pointer-events-none absolute inset-0 z-[3] overflow-hidden",
        !backgroundBlurEnabled && "np-audio-reactive-layer--noblur",
      )}
      style={overlayStyle}
      aria-hidden="true"
    >
      <motion.div
        className="absolute inset-0"
        style={{
          opacity: ambientOpacity,
          background: "radial-gradient(circle at 18% 24%, var(--np-ambient-color), transparent 58%)",
        }}
      />

      <motion.div
        className="np-audio-orb-shell np-audio-orb-shell-1"
        animate={{
          x: [0, 116, -74, 42, 0],
          y: [0, 66, -44, 18, 0],
          rotate: [0, 10, -8, 4, 0],
        }}
        transition={{
          duration: 22,
          repeat: Number.POSITIVE_INFINITY,
          ease: "easeInOut",
        }}
      >
        <motion.div
          className="np-audio-orb np-audio-orb-1"
          style={{
            opacity: orbOneOpacity,
            scale: orbOneScale,
            x: orbOneX,
            y: orbOneY,
            filter: orbOneFilter,
          }}
          animate={{
            rotate: [0, 24, 0, -18, 0],
            backgroundPosition: ["38% 34%", "62% 60%", "42% 48%", "38% 34%"],
          }}
          transition={{
            duration: 20,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeInOut",
          }}
        />
      </motion.div>

      <motion.div
        className="np-audio-orb-shell np-audio-orb-shell-2"
        animate={{
          x: [0, -112, 58, -24, 0],
          y: [0, 54, -38, 20, 0],
          rotate: [0, -11, 8, -4, 0],
        }}
        transition={{
          duration: 25,
          repeat: Number.POSITIVE_INFINITY,
          ease: "easeInOut",
        }}
      >
        <motion.div
          className="np-audio-orb np-audio-orb-2"
          style={{
            opacity: orbTwoOpacity,
            scale: orbTwoScale,
            x: orbTwoX,
            y: orbTwoY,
            filter: orbTwoFilter,
          }}
          animate={{
            rotate: [0, -22, 0, 16, 0],
            backgroundPosition: ["30% 30%", "64% 58%", "46% 42%", "30% 30%"],
          }}
          transition={{
            duration: 22,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeInOut",
          }}
        />
      </motion.div>

      <motion.div
        className="np-audio-orb-shell np-audio-orb-shell-3"
        animate={{
          x: [0, 98, -66, 26, 0],
          y: [0, -62, 40, -20, 0],
          rotate: [0, 12, -8, 5, 0],
        }}
        transition={{
          duration: 24,
          repeat: Number.POSITIVE_INFINITY,
          ease: "easeInOut",
        }}
      >
        <motion.div
          className="np-audio-orb np-audio-orb-3"
          style={{
            opacity: orbThreeOpacity,
            scale: orbThreeScale,
            x: orbThreeX,
            y: orbThreeY,
            filter: orbThreeFilter,
          }}
          animate={{
            rotate: [0, 20, 0, -15, 0],
            backgroundPosition: ["44% 36%", "68% 62%", "48% 46%", "44% 36%"],
          }}
          transition={{
            duration: 21,
            repeat: Number.POSITIVE_INFINITY,
            ease: "easeInOut",
          }}
        />
      </motion.div>

      <motion.div
        className="np-audio-pulse-ring"
        style={{ opacity: pulseRingOpacity, scale: pulseRingScale, filter: pulseRingFilter }}
      />
    </div>
  );
}
