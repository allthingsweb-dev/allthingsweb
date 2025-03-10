import { Box, Text } from "ink";
import { colors } from "../theme";

type HeaderProps = {
    level?: 1 | 2;
    children: React.ReactNode;
}

export const Header = ({ level = 1, children }: HeaderProps) => {
    const colorMap = {
        1: colors.mainBlue,
        2: '#FF6600',
    }
    return <Box
        flexDirection="row"
        borderStyle={"single"}
        borderTop={false}
        borderLeft={false}
        borderRight={false}
        borderBottom={true}
        borderBottomColor={colors.mainBlue}
    ><Text bold italic color={colorMap[level]}>{children}</Text></Box>
}
