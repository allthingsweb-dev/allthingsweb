import { createJarvis } from "../core/create-jarvis";
import { createRegisterCommand } from "./register";
import { createMCPServeCommand } from "./mcp";
import { createZero } from "../core/create-zero";

const jarvis = createJarvis("Plopix");
const zero = createZero();
export const commands = [
  createRegisterCommand({ tBot: jarvis, zero }),
  createMCPServeCommand({ zero }),
];
