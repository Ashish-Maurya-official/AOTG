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

    // Calculate dynamic widths for each column to maintain grid alignment
    const colWidths = header.map((h, colIndex) => {
        const headerCell = h || '';
        const bodyCells = body.map(row => row[colIndex] || '');
        const maxLen = Math.max(headerCell.length, ...bodyCells.map(c => c.length));
        return Math.max(60, Math.min(maxLen * 8 + 32, 300));
    });

    const renderInlineText = (text: string) => {
        const parts = text.split(/(\*\*.*?\*\*|\*[^\*]+\*|`.*?`|\$[\s\S]*?\$)/g);

        return parts.map((part, index) => {
            if (part.startsWith('**') && part.endsWith('**')) {
                return <Text key={index} style={{ fontWeight: 'bold' }}>{part.slice(2, -2)}</Text>;
            }
            if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
                return <Text key={index} style={{ fontStyle: 'italic' }}>{part.slice(1, -1)}</Text>;
            }
            if (part.startsWith('`') && part.endsWith('`')) {
                return <Text key={index} style={[styles.inlineCode, { backgroundColor: colors.border }]}>{part.slice(1, -1)}</Text>;
            }
            if (part.startsWith('$') && part.endsWith('$')) {
                let mathContent = part.slice(1, -1).replace(/\\rightarrow/g, '→').replace(/\\leftarrow/g, '←').replace(/\\log/g, 'log');
                return <Text key={index} style={{ fontStyle: 'italic', color: '#10A37F', fontWeight: '500' }}>{mathContent}</Text>;
            }
            let cleaned = part.replace(/\\rightarrow/g, '→').replace(/\\leftarrow/g, '←');
            return <Text key={index}>{cleaned}</Text>;
        });
    };

    return (
        <View style={[styles.wrapper]}>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={true}
                contentContainerStyle={styles.tableContainer}
                nestedScrollEnabled={true}
            >
                <View style={styles.tableContainer}>
                    {/* Header Row */}
                    <View style={[styles.row, { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
                        {header.map((cell, index) => (
                            <View key={`header-${index}`} style={[
                                styles.cell,
                                { width: colWidths[index] }
                            ]}>
                                <Text selectable style={[styles.headerText, { color: colors.text }]}>
                                    {renderInlineText(cell)}
                                </Text>
                            </View>
                        ))}
                    </View>

                    {/* Body Rows */}
                    {body.map((row, rowIndex) => (
                        <View key={`row-${rowIndex}`} style={[
                            styles.row,
                            { borderBottomWidth: rowIndex === body.length - 1 ? 0 : StyleSheet.hairlineWidth, borderBottomColor: colors.border }
                        ]}>
                            {row.map((cellText, cellIndex) => (
                                <View key={`cell-${rowIndex}-${cellIndex}`} style={[
                                    styles.cell,
                                    { width: colWidths[cellIndex] }
                                ]}>
                                    <Text selectable style={[styles.cellText, { color: colors.text }]}>
                                        {renderInlineText(cellText)}
                                    </Text>
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
        borderWidth: 1,
        borderColor: 'transparent',
    },
    tableContainer: {
        flexDirection: 'column',
        alignItems: 'flex-start',
        padding: 10
    },
    row: {
        flexDirection: 'row',
    },
    cell: {
        paddingVertical: 10,
        paddingHorizontal: 12,
        justifyContent: 'center',
    },
    headerText: {
        fontWeight: 'bold',
        fontSize: 14,
    },
    cellText: {
        fontSize: 14,
    },
    inlineCode: {
        fontFamily: 'monospace',
        fontSize: 12,
        paddingHorizontal: 4,
        borderRadius: 4,
        overflow: 'hidden',
    },
});

export default TableBlock;
