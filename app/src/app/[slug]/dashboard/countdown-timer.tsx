"use client";

import { useState, useEffect, useRef } from "react";
import { Clock } from "lucide-react";
import { useConfetti } from "@/hooks/use-confetti";

interface CountdownTimerProps {
  targetDate: Date;
  title: string;
  subtitle?: string;
  onTimeExpired?: (type: "hackathon" | "voting") => void;
  timerType?: "hackathon" | "voting";
}

interface TimeLeft {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export function CountdownTimer({
  targetDate,
  title,
  subtitle,
  onTimeExpired,
  timerType = "hackathon",
}: CountdownTimerProps) {
  const [timeLeft, setTimeLeft] = useState<TimeLeft>({
    days: 0,
    hours: 0,
    minutes: 0,
    seconds: 0,
  });
  const [isExpired, setIsExpired] = useState(false);
  const hasTriggeredConfetti = useRef(false);
  const { fireHackathonEndConfetti, fireVotingEndConfetti } = useConfetti();

  useEffect(() => {
    const calculateTimeLeft = () => {
      const now = new Date().getTime();
      const target = targetDate.getTime();
      const difference = target - now;

      if (difference > 0) {
        const days = Math.floor(difference / (1000 * 60 * 60 * 24));
        const hours = Math.floor(
          (difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
        );
        const minutes = Math.floor(
          (difference % (1000 * 60 * 60)) / (1000 * 60),
        );
        const seconds = Math.floor((difference % (1000 * 60)) / 1000);

        setTimeLeft({ days, hours, minutes, seconds });
        setIsExpired(false);
        hasTriggeredConfetti.current = false; // Reset confetti flag when time is active
      } else {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });

        // Check if we just expired (within 5 minutes) and haven't triggered confetti yet
        const timeSinceExpiry = Math.abs(difference);
        const fiveMinutesInMs = 5 * 60 * 1000;

        if (!isExpired) {
          // Just expired - trigger confetti if within 5 minutes
          if (
            timeSinceExpiry <= fiveMinutesInMs &&
            !hasTriggeredConfetti.current
          ) {
            hasTriggeredConfetti.current = true;

            // Trigger appropriate confetti based on timer type
            if (timerType === "hackathon") {
              fireHackathonEndConfetti();
            } else if (timerType === "voting") {
              fireVotingEndConfetti();
            }

            // Call the callback if provided
            if (onTimeExpired) {
              onTimeExpired(timerType);
            }
          }
        }

        setIsExpired(true);
      }
    };

    calculateTimeLeft();
    const timer = setInterval(calculateTimeLeft, 1000);

    return () => clearInterval(timer);
  }, [
    targetDate,
    isExpired,
    timerType,
    onTimeExpired,
    fireHackathonEndConfetti,
    fireVotingEndConfetti,
  ]);

  const formatNumber = (num: number) => num.toString().padStart(2, "0");

  if (isExpired) {
    return (
      <div className="bg-gradient-to-r from-gray-500 to-gray-600 dark:from-gray-700 dark:to-gray-800 text-white rounded-xl p-6 mb-8">
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <Clock className="h-6 w-6" />
            <h2 className="text-2xl font-bold">{title}</h2>
          </div>
          <p className="text-lg opacity-90">Time's up!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-r from-blue-600 to-purple-600 dark:from-blue-700 dark:to-purple-700 text-white rounded-xl p-6 mb-8">
      <div className="text-center">
        <div className="flex items-center justify-center gap-2 mb-4">
          <Clock className="h-6 w-6" />
          <h2 className="text-2xl font-bold">{title}</h2>
        </div>

        <div className="grid grid-cols-4 gap-4 mb-4">
          <div className="bg-white/10 rounded-lg p-3">
            <div className="text-3xl font-mono font-bold">
              {formatNumber(timeLeft.days)}
            </div>
            <div className="text-sm opacity-75">Days</div>
          </div>
          <div className="bg-white/10 rounded-lg p-3">
            <div className="text-3xl font-mono font-bold">
              {formatNumber(timeLeft.hours)}
            </div>
            <div className="text-sm opacity-75">Hours</div>
          </div>
          <div className="bg-white/10 rounded-lg p-3">
            <div className="text-3xl font-mono font-bold">
              {formatNumber(timeLeft.minutes)}
            </div>
            <div className="text-sm opacity-75">Minutes</div>
          </div>
          <div className="bg-white/10 rounded-lg p-3">
            <div className="text-3xl font-mono font-bold">
              {formatNumber(timeLeft.seconds)}
            </div>
            <div className="text-sm opacity-75">Seconds</div>
          </div>
        </div>

        {subtitle && <p className="text-sm opacity-75">{subtitle}</p>}
      </div>
    </div>
  );
}
