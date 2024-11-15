import clsx from 'clsx';
import { useState, useEffect } from 'react';
import { Card } from './card';

export function useTypingAnimation(
  texts: string[],
  typingSpeed: number = 100,
  deletingSpeed: number = 50,
  pauseDuration: number = 1000,
) {
  const [displayedText, setDisplayedText] = useState('');
  const [currentTextIndex, setCurrentTextIndex] = useState(0);
  const [isTyping, setIsTyping] = useState(true);

  useEffect(() => {
    const currentFullText = texts[currentTextIndex];
    let timeout: ReturnType<typeof globalThis.setTimeout>;

    if (isTyping) {
      if (displayedText !== currentFullText) {
        timeout = setTimeout(() => {
          setDisplayedText(currentFullText.slice(0, displayedText.length + 1));
        }, typingSpeed);
      } else {
        timeout = setTimeout(() => setIsTyping(false), pauseDuration);
      }
    } else {
      if (displayedText !== '') {
        timeout = setTimeout(() => {
          setDisplayedText(displayedText.slice(0, -1));
        }, deletingSpeed);
      } else {
        setCurrentTextIndex((prevIndex) => (prevIndex + 1) % texts.length);
        setIsTyping(true);
      }
    }

    return () => clearTimeout(timeout);
  }, [displayedText, isTyping, currentTextIndex, texts, typingSpeed, deletingSpeed, pauseDuration]);

  return displayedText;
}

export default function TypeAnimation({ texts, className }: { texts: string[]; className?: string }) {
  const displayedText = useTypingAnimation(texts);

  return (
    <div className={clsx(className, 'flex items-center justify-center')}>
      <Card className="py-4 px-6 rounded-lg">
        <pre className="text-lg font-mono">
          <span className="text-green-600 dark:text-green-400">$</span>{' '}
          <span className="inline-block w-[260px] text-gray-800 dark:text-gray-200 whitespace-pre">
            {displayedText}
          </span>
        </pre>
      </Card>
    </div>
  );
}
