import { Command } from "commander";
import { Box, Newline, render, Text } from 'ink';
import { FooterSpeakers } from "../ui/speaker";
import { RegisterJourney } from "../ui/register-journey";
import pc from "picocolors";
import { ZeroProvider } from "@rocicorp/zero/react";
import { Zero } from "@rocicorp/zero";
import { logo } from "..";
import { schema } from "@lib/zero-sync/schema";

export const createRegisterCommand = (): Command => {
    const command = new Command("register")
        .description("Register to an event.")
        .action(async () => {
            console.log(pc.dim(logo));
            const z = new Zero({
                userID: "anon",
                server: 'https://allthingsweb-sync.fly.dev',
                schema,
                kvStore: 'mem',
            });
            const { waitUntilExit, unmount } = render(
                <ZeroProvider zero={z}>
                    <>
                    <Text bold italic>Register to an event!</Text>
                    <RegisterJourney unmount={() => unmount()} />
                    <Newline />
                    <Box flexDirection="column" padding={1} gap={1}>
                        <FooterSpeakers />
                    </Box>
                    </>
                </ZeroProvider>,
                {
                    exitOnCtrlC: true,
                }
            );
            await waitUntilExit();


            render(<Box flexDirection="column" padding={1} gap={1}>
                <Text>Register to an event!</Text>
                </Box>)
        });
    return command;
}
