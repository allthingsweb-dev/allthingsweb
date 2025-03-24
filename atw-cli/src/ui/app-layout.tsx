import { Box } from "ink";
import { ZeroProvider } from "@rocicorp/zero/react";
import { Zero } from "@rocicorp/zero";
import { schema } from "@lib/zero-sync/schema";
import { ThemeProvider } from "@inkjs/ui";
import type React from "react";
import { customTheme } from "./theme";
import { Header } from "./components/header";
import { Footer } from "./footer";

type AppLayoutProps = {
  children: React.ReactNode;
  title: string;
};

export const AppLayout = ({
  children,
  title,
}: AppLayoutProps): React.ReactNode => {
  const z = new Zero({
    userID: "anon",
    server: "https://allthingsweb-sync.fly.dev",
    schema,
    kvStore: "mem",
  });
  return (
    <ZeroProvider zero={z}>
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
