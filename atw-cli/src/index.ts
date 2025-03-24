import { Command } from "commander";
import { commands } from "./commands";
import packageJson from "../package.json";
import pc from "picocolors";

const helpStyling = {
  styleTitle: (str: string) => pc.bold(str),
  styleCommandText: (str: string) => pc.cyan(str),
  styleCommandDescription: (str: string) => pc.magenta(str),
  styleDescriptionText: (str: string) => pc.italic(str),
  styleOptionText: (str: string) => pc.green(str),
  styleArgumentText: (str: string) => pc.yellow(str),
  styleSubcommandText: (str: string) => pc.cyan(str),
};

export const logo = `
   _   _ _   _____ _     _                   __    __     _     
  /_\\ | | | /__   \\ |__ (_)_ __   __ _ ___  / / /\\ \\ \\___| |__  
 //_\\\\| | |   / /\\/ '_ \\| | '_ \\ / _\` / __| \\ \\/  \\/ / _ \\ '_  \\ 
/  _  \\ | |  / /  | | | | | | | | (_| \\__ \\  \\  /\\  /  __/ |_) |
\\_/ \\_/_|_|  \\/   |_| |_|_|_| |_|\\__, |___/   \\/  \\/ \\___|_.__/ 
                                 |___/                          
                                                    ${pc.blueBright("CLI")} - ${pc.yellowBright(packageJson.version)}\n`;

const program = new Command();
program.configureHelp(helpStyling);
program
  .name("atw-cli")
  .description("All things Web CLI")
  .version(packageJson.version);
program.addHelpText("beforeAll", pc.magentaBright(logo));
program.addHelpText(
  "afterAll",
  pc.dim(
    "\nRun $ atw-cli <command> --help for more information on a specific command.\n",
  ),
);

commands.forEach((command) => {
  command.configureHelp(helpStyling);
  program.addCommand(command);
});

try {
  await program.parseAsync(process.argv);
} catch (exception) {
  console.error(exception);
  process.exit(1);
}
