import type { TalkativeBot } from "../contracts/talkative-bot-interface";

export const createJarvis = (voice: string): TalkativeBot => {
  let currentOuput: ReturnType<typeof Bun.spawn> | null = null;

  const shutup = async () => {
    if (currentOuput) {
      currentOuput.kill("SIGKILL");
      await currentOuput.exited;
    }
    currentOuput = null;
  };
  return {
    say: async (text: string) => {
      try {
        await shutup();
        currentOuput = Bun.spawn(["say", "-v", voice, text]);
        await currentOuput.exited;
      } catch (e) {
        currentOuput = null;
      }
    },
    shutup,
    isSpeaking: () => {
      return currentOuput !== null;
    },
  };
};
