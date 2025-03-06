import { Command } from "commander";
import { Box, Newline, render, Text } from 'ink';
import { FooterSpeakers } from "../ui/speaker";
import { RegisterJourney } from "../ui/register-journey";
import pc from "picocolors";

import { logo } from "..";


export const createRegisterCommand = (): Command => {
    const command = new Command("register")
        .description("Register to an event.")
        .action(async () => {
            console.log(pc.dim(logo));
            const { waitUntilExit, unmount } = render(
                <>
                <Text bold italic>Register to an event!</Text>
                <RegisterJourney unmount={() => unmount()} />
                <Newline />
                <Box flexDirection="column" padding={1} gap={1}>
                    <FooterSpeakers />
                </Box>
                </>,
                {
                    exitOnCtrlC: true,
                }
            );
            await waitUntilExit();
        });
    return command;
}
