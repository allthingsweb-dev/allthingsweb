import { ClipboardButton } from "./clipboard-button";

interface CodeBlockProps {
  code: string;
  html?: string;
}

export function CodeBlock({ code, html }: CodeBlockProps) {
  return (
    <div className="flex flex-row justify-center items-center gap-2 p-2 lg:p-4 rounded-md text-left font-normal text-sm md:text-base w-full bg-[#282A36]">
      <pre
        className="w-full p-2 lg:p-4 overflow-scroll "
        dangerouslySetInnerHTML={{ __html: html ? html : code }}
      ></pre>
      <div className="flex justify-end">
        <ClipboardButton text={code} />
      </div>
    </div>
  );
}
