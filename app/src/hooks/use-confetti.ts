"use client";

import { useCallback } from "react";
import confetti from "canvas-confetti";

export interface ConfettiOptions {
  particleCount?: number;
  spread?: number;
  origin?: { x?: number; y?: number };
  colors?: string[];
  duration?: number;
}

export function useConfetti() {
  const fireConfetti = useCallback((options: ConfettiOptions = {}) => {
    const {
      particleCount = 100,
      spread = 70,
      origin = { y: 0.6 },
      colors = ["#f43f5e", "#3b82f6", "#10b981", "#f59e0b", "#8b5cf6"],
      duration = 3000,
    } = options;

    // Fire confetti from multiple positions for full-screen effect
    const end = Date.now() + duration;

    const frame = () => {
      confetti({
        particleCount: Math.floor(particleCount / 4),
        spread,
        origin: { x: Math.random() * 0.6 + 0.2, y: Math.random() * 0.3 + 0.1 },
        colors,
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    };

    frame();
  }, []);

  const fireHackathonEndConfetti = useCallback(() => {
    // Special confetti for hackathon end - more intense
    fireConfetti({
      particleCount: 150,
      spread: 100,
      colors: ["#3b82f6", "#1d4ed8", "#60a5fa", "#93c5fd"],
      duration: 4000,
    });
  }, [fireConfetti]);

  const fireVotingEndConfetti = useCallback(() => {
    // Special confetti for voting end - celebration theme
    fireConfetti({
      particleCount: 120,
      spread: 80,
      colors: ["#f59e0b", "#d97706", "#fbbf24", "#fcd34d"],
      duration: 3500,
    });
  }, [fireConfetti]);

  return {
    fireConfetti,
    fireHackathonEndConfetti,
    fireVotingEndConfetti,
  };
}
