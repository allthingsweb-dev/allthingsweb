import { Command } from "commander";
import { render } from 'ink';
import { RegisterJourney } from "../ui/journeys/register";
import pc from "picocolors";
import { logo } from "..";
import { AppLayout } from "../ui/app-layout";

export const createRegisterCommand = (): Command => {
    const command = new Command("register")
        .description("Register to an event.")
        .action(async () => {
            console.log(pc.dim(logo));
            const { waitUntilExit, unmount } = render(
                <AppLayout title="Register to an event!">
                    <RegisterJourney unmount={() => unmount()} />
                </AppLayout>,
                {
                    exitOnCtrlC: true,
                }
            );
            await waitUntilExit();
        });
    return command;
}
