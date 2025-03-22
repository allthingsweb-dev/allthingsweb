import { Check, Copy } from "lucide-react";
import { useState, useEffect } from "react";
import { Button } from "./button";

interface ClipboardButtonProps {
  text: string;
  className?: string;
}

export function ClipboardButton({ text, className }: ClipboardButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (copied) {
      const timer = setTimeout(() => {
        setCopied(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [copied]);

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  return (
    <Button
      variant="icon"
      size="icon"
      className={className}
      onClick={copyToClipboard}
      title={copied ? "Copied!" : "Copy to clipboard"}
    >
      {copied ? (
        <Check className="h-4 w-4 text-green-500" />
      ) : (
        <Copy className="h-4 w-4" />
      )}
    </Button>
  );
}
