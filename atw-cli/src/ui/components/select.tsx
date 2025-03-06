import { useState } from 'react';
import { Text, useInput, Box, Newline } from 'ink';

const maxOptionsToDisplay = 4;

type Option<T> = {
    label: string;
    value: T;
    render?: (label: string, value: T, isSelected: boolean) => React.ReactNode
};


export type Props<T> = {
    options: Option<T>[];
    onSelect: (value: T) => void;
    defaultSelectedIndex?: number;
    colors?: {
        highlight?: string;
    }
};

export function Select<T>({ options, onSelect, defaultSelectedIndex = 0, colors }: Props<T>) {
    const highlightColor = colors?.highlight || 'yellow';
    const [selectedIndex, setSelectedIndex] = useState(defaultSelectedIndex);

    const optionsToDisplay = (() => {
        if (selectedIndex === 0) {
            return options.slice(selectedIndex, maxOptionsToDisplay);
        }

        if (selectedIndex === options.length - 1) {
            return options.slice(-maxOptionsToDisplay);
        }
        return options.slice(selectedIndex - 1, selectedIndex - 1 + maxOptionsToDisplay);
    })();
    const lastDisplayedIndex = options.findIndex(
        (option: Option<T>) => option === optionsToDisplay[optionsToDisplay.length - 1],
    );
    const overflowItem = lastDisplayedIndex < options.length - 1 ? options[lastDisplayedIndex + 1] : null;

    useInput((_, key) => {
        if (key.return) {
            onSelect(options[selectedIndex].value);
            return;
        }

        if (key.upArrow) {
            setSelectedIndex(selectedIndex <= 0 ? options.length - 1 : selectedIndex - 1);
        }
        if (key.downArrow) {
            setSelectedIndex(selectedIndex >= options.length - 1 ? 0 : selectedIndex + 1);
        }
    });

    return (
        <Box flexDirection="column">
            {optionsToDisplay.map((option: Option<T>, index: number) => {
                const isSelected = options[selectedIndex].value === option.value;
                return (
                    <Box flexDirection="row" marginY={1} key={index}>
                        <Box width={1} marginRight={2}>
                            <Text color={highlightColor}>
                                {isSelected ? '>' : ''}
                            </Text>
                        </Box>
                        <Box>
                            {option.render ? option.render(option.label, option.value, isSelected) : <Text color={isSelected ? highlightColor : undefined}>{option.label}</Text>}
                        </Box>
                    </Box>
                );
            })}
            {overflowItem && (
                <Box marginLeft={3} flexDirection="row">
                    <Text>
                        {overflowItem.label}
                        <Newline />
                        ...
                    </Text>
                </Box>
            )}
        </Box>
    );
}
