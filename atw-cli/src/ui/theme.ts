import { type TextProps } from "ink";
import { extendTheme, defaultTheme } from "@inkjs/ui";

export const customTheme = extendTheme(defaultTheme, {
  components: {
    Spinner: {
      styles: {
        frame: (): TextProps => ({
          color: "magenta",
        }),
      },
    },
  },
});

export const colors = {
  mainBlue: "#4F46E5",
  mainPurple: "#A502C9",
  mainOrange: "#FF9900",
};
