import { createJarvis } from "../core/create-jarvis";
import { createRegisterCommand } from "./register";

const jarvis = createJarvis("Plopix");
export const commands = [createRegisterCommand({ tBot: jarvis })];
