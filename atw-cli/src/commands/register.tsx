import { Command } from "commander";
import { render } from "ink";
import { RegisterJourney } from "../ui/journeys/register";
import pc from "picocolors";
import { logo } from "..";
import { AppLayout } from "../ui/app-layout";
import type { TalkativeBot } from "../contracts/talkative-bot-interface";
import type { AtwZero } from "../core/create-zero";

type Deps = {
  tBot: TalkativeBot;
  zero: AtwZero;
};
export const createRegisterCommand = (deps: Deps): Command => {
  const command = new Command("register")
    .description("Register to an event.")
    .action(async () => {
      console.log(pc.dim(logo));
      deps.tBot.say(
        "We can't wait to see you soon! Select one of the events below to register.",
      );
      const { waitUntilExit, unmount } = render(
        <AppLayout zero={deps.zero} title="Register to an event!">
          <RegisterJourney unmount={() => unmount()} deps={deps} />
        </AppLayout>,
        {
          exitOnCtrlC: true,
        },
      );
      await waitUntilExit();
    });
  return command;
};
