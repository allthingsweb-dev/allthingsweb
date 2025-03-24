import { Box } from "ink";
import { ZeroProvider } from "@rocicorp/zero/react";
import { ThemeProvider } from "@inkjs/ui";
import type React from "react";
import { customTheme } from "./theme";
import { Header } from "./components/header";
import { Footer } from "./footer";
import type { AtwZero } from "../core/create-zero";

type AppLayoutProps = {
  children: React.ReactNode;
  title: string;
  zero: AtwZero;
};

export const AppLayout = ({
  children,
  title,
  zero,
}: AppLayoutProps): React.ReactNode => {
  return (
    <ZeroProvider zero={zero}>
      <ThemeProvider theme={customTheme}>
        <Header level={1}>{title}</Header>
        <Box flexDirection="column" padding={1}>
          {children}
        </Box>
        <Box flexDirection="column">
          <Footer />
        </Box>
      </ThemeProvider>
    </ZeroProvider>
  );
};
