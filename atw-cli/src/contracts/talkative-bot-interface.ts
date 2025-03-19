export type TalkativeBot = {
    say: (text: string) => Promise<void>;
    shutup: () => Promise<void>;
    isSpeaking: () => boolean;
}
