import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';

interface TableBlockProps {
    content: string;
}

const TableBlock: React.FC<TableBlockProps> = ({ content }) => {
    const { colors } = useTheme();

    const parsedTable = useMemo(() => {
        const lines = content.split('\n').map(line => line.trim());
        const rows = lines.map(line => {
            // Remove outer pipes if they exist
            let cleaned = line;
            if (cleaned.startsWith('|')) cleaned = cleaned.substring(1);
            if (cleaned.endsWith('|')) cleaned = cleaned.substring(0, cleaned.length - 1);
            
            // Split by pipe
            return cleaned.split('|').map(cell => cell.trim());
        });

        // Filter out empty rows or pure separator rows (like |---|---|)
        return rows.filter(row => {
            if (row.length === 0) return false;
            // Check if it's just a separator row
            const isSeparator = row.every(cell => /^[-: ]+$/.test(cell));
            return !isSeparator;
        });
    }, [content]);

    if (parsedTable.length === 0) {
        return null;
    }

    const header = parsedTable[0];
    const body = parsedTable.slice(1);

    return (
        <View style={styles.wrapper}>
            <ScrollView horizontal showsHorizontalScrollIndicator={true} style={styles.scroll}>
                <View>
                    {/* Header Row */}
                    <View style={[styles.row, styles.headerRow]}>
                        {header.map((cell, index) => (
                            <View key={`header-${index}`} style={styles.cell}>
                                <Text style={[styles.headerText, { color: colors.text }]}>{cell}</Text>
                            </View>
                        ))}
                    </View>

                    {/* Body Rows */}
                    {body.map((row, rowIndex) => (
                        <View key={`row-${rowIndex}`} style={styles.row}>
                            {row.map((cell, cellIndex) => (
                                <View key={`cell-${rowIndex}-${cellIndex}`} style={styles.cell}>
                                    <Text style={[styles.cellText, { color: colors.text }]}>{cell}</Text>
                                </View>
                            ))}
                        </View>
                    ))}
                </View>
            </ScrollView>
        </View>
    );
};

const styles = StyleSheet.create({
    wrapper: {
        marginVertical: 8,
        borderRadius: 8,
        overflow: 'hidden',
    },
    scroll: {
        flexDirection: 'column',
    },
    row: {
        flexDirection: 'row',
    },
    headerRow: {
        // Light background applied via inline style for dark/light mode
    },
    cell: {
        paddingVertical: 8,
        paddingHorizontal: 12,
        minWidth: 80,
        justifyContent: 'center',
    },
    headerText: {
        fontWeight: 'bold',
        fontSize: 14,
    },
    cellText: {
        fontSize: 14,
    },
});

export default TableBlock;
