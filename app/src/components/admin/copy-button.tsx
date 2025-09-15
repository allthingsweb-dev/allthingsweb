"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";

interface CopyButtonProps {
  text: string;
  className?: string;
  title?: string;
  children?: React.ReactNode;
}

export function CopyButton({
  text,
  className = "",
  title = "Copy to clipboard",
  children,
}: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async () => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        toast.success("Copied to clipboard");
        setTimeout(() => setCopied(false), 2000);
      } else {
        // Fallback for older browsers
        const textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          document.execCommand("copy");
          setCopied(true);
          toast.success("Copied to clipboard");
          setTimeout(() => setCopied(false), 2000);
        } catch (err) {
          toast.error("Failed to copy to clipboard");
        }
        document.body.removeChild(textArea);
      }
    } catch (err) {
      toast.error("Failed to copy to clipboard");
    }
  };

  return (
    <button
      onClick={copyToClipboard}
      className={`flex items-center gap-1 transition-colors ${className}`}
      title={title}
    >
      {children}
      {copied ? (
        <Check className="h-3 w-3 text-green-600" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
    </button>
  );
}
