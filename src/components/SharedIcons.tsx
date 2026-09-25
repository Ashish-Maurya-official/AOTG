import React, { memo } from 'react';
import { View, StyleSheet, Animated } from 'react-native';

export const MenuIcon = memo(({ color }: { color: string }) => (
    <View style={styles.menuIconContainer}>
        <View style={[styles.menuLine, { backgroundColor: color }]} />
        <View style={[styles.menuLine, { backgroundColor: color }]} />
        <View style={[styles.menuLine, { backgroundColor: color }]} />
    </View>
));

export const ChevronDownIcon = memo(({ color }: { color: string }) => (
    <View style={styles.chevronContainer}>
        <View style={[styles.chevronLeft, { backgroundColor: color }]} />
        <View style={[styles.chevronRight, { backgroundColor: color }]} />
    </View>
));

export const RobotIcon = memo(({ color, bgColor }: { color: string; bgColor: string }) => (
    <View style={styles.robotContainer}>
        {/* Antenna */}
        <View style={styles.robotAntennaContainer}>
            <View style={[styles.robotAntennaKnob, { backgroundColor: color }]} />
            <View style={[styles.robotAntennaStem, { backgroundColor: color }]} />
        </View>

        {/* Head and Ears row */}
        <View style={styles.robotHeadRow}>
            {/* Left Ear */}
            <View style={[styles.robotEar, { backgroundColor: color }]} />

            {/* Face */}
            <View style={[styles.robotFace, { backgroundColor: color }]}>
                {/* Eyes */}
                <View style={styles.robotEyesRow}>
                    <View style={[styles.robotEye, { backgroundColor: bgColor }]} />
                    <View style={[styles.robotEye, { backgroundColor: bgColor }]} />
                </View>
                {/* Mouth */}
                <View style={[styles.robotMouth, { backgroundColor: bgColor }]} />
            </View>

            {/* Right Ear */}
            <View style={[styles.robotEar, { backgroundColor: color }]} />
        </View>
    </View>
));

export const PlusIcon = memo(({ color }: { color: any }) => (
    <View style={styles.plusIconContainer}>
        <Animated.View style={[styles.plusLineH, { backgroundColor: color }]} />
        <Animated.View style={[styles.plusLineV, { backgroundColor: color }]} />
    </View>
));

export const StopIcon = memo(({ color, size = 10, radius = 2 }: { color: string, size?: number, radius?: number }) => (
    <View style={styles.stopIconContainer}>
        <View style={[{ width: size, height: size, borderRadius: radius, backgroundColor: color }]} />
    </View>
));

export const UploadIcon = memo(({ color }: { color: string }) => (
    <View style={styles.uploadIconContainer}>
        {/* Arrow up */}
        <View style={[styles.uploadArrowStem, { backgroundColor: color }]} />
        <View style={[styles.uploadArrowLeft, { backgroundColor: color }]} />
        <View style={[styles.uploadArrowRight, { backgroundColor: color }]} />
        {/* Tray */}
        <View style={[styles.uploadTray, { borderColor: color }]} />
    </View>
));

export const CloseIcon = memo(({ color, size = 16 }: { color: string; size?: number }) => (
    <View style={[styles.closeIconContainer, { width: size, height: size }]}>
        <View style={[styles.closeLine1, { backgroundColor: color, width: size * 0.7 }]} />
        <View style={[styles.closeLine2, { backgroundColor: color, width: size * 0.7 }]} />
    </View>
));

export const FileIcon = memo(({ color }: { color: string }) => (
    <View style={styles.fileIconContainer}>
        <View style={[styles.fileBody, { borderColor: color }]} />
        <View style={[styles.fileFold, { borderColor: color, backgroundColor: color + '20' }]} />
    </View>
));

export const BackArrowIcon = memo(({color}: {color: string}) => (
    <View style={styles.backArrow}>
        <View style={[styles.backArrowLine1, {backgroundColor: color}]} />
        <View style={[styles.backArrowLine2, {backgroundColor: color}]} />
        <View style={[styles.backArrowShaft, {backgroundColor: color}]} />
    </View>
));

export const AgentIcon = memo(({color, size = 20}: {color: string; size?: number}) => (
    <View style={[styles.agentIcon, {width: size, height: size}]}>
        <View style={[
            styles.agentEye,
            {
                backgroundColor: color,
                width: size * 0.25,
                height: size * 0.25,
                borderRadius: size * 0.125,
                left: size * 0.2,
                top: size * 0.3,
            }
        ]} />
        <View style={[
            styles.agentEye,
            {
                backgroundColor: color,
                width: size * 0.25,
                height: size * 0.25,
                borderRadius: size * 0.125,
                right: size * 0.2,
                top: size * 0.3,
            }
        ]} />
        <View style={[
            styles.agentMouth,
            {
                borderBottomColor: color,
                width: size * 0.4,
                bottom: size * 0.2,
            }
        ]} />
    </View>
));

export const PlayIcon = memo(({color}: {color: string}) => (
    <View style={[styles.playTriangle, {borderLeftColor: color}]} />
));


const styles = StyleSheet.create({
    // Menu Icon
    menuIconContainer: {
        width: 22,
        height: 16,
        justifyContent: 'space-between',
    },
    menuLine: {
        width: 22,
        height: 2.2,
        borderRadius: 1.5,
    },
    // ChevronDown Icon
    chevronContainer: {
        width: 10,
        height: 6,
        justifyContent: 'center',
        alignItems: 'center',
    },
    chevronLeft: {
        position: 'absolute',
        left: 0.5,
        width: 5.5,
        height: 1.6,
        borderRadius: 0.8,
        transform: [{ rotate: '45deg' }],
    },
    chevronRight: {
        position: 'absolute',
        right: 0.5,
        width: 5.5,
        height: 1.6,
        borderRadius: 0.8,
        transform: [{ rotate: '-45deg' }],
    },
    // Robot Icon
    robotContainer: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    robotAntennaContainer: {
        alignItems: 'center',
        marginBottom: 1,
    },
    robotAntennaKnob: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    robotAntennaStem: {
        width: 3,
        height: 5,
        borderRadius: 1,
    },
    robotHeadRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    robotEar: {
        width: 4,
        height: 10,
        borderRadius: 2,
    },
    robotFace: {
        width: 36,
        height: 28,
        borderRadius: 8,
        marginHorizontal: 3,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 4,
    },
    robotEyesRow: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 4,
    },
    robotEye: {
        width: 6,
        height: 6,
        borderRadius: 1.5,
    },
    robotMouth: {
        width: 14,
        height: 3,
        borderRadius: 1.5,
    },
    // Plus Icon
    plusIconContainer: {
        width: 18,
        height: 18,
        justifyContent: 'center',
        alignItems: 'center',
    },
    plusLineH: {
        width: 14,
        height: 2.2,
        borderRadius: 1.1,
    },
    plusLineV: {
        width: 2.2,
        height: 14,
        borderRadius: 1.1,
        position: 'absolute',
    },
    // Stop Icon
    stopIconContainer: {
        width: 18,
        height: 18,
        justifyContent: 'center',
        alignItems: 'center',
    },
    stopSquare: {
        width: 10,
        height: 10,
        borderRadius: 2,
    },
    // Upload Icon
    uploadIconContainer: {
        width: 20,
        height: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    uploadArrowStem: {
        width: 2,
        height: 9,
        borderRadius: 1,
        position: 'absolute',
        top: 1,
    },
    uploadArrowLeft: {
        position: 'absolute',
        width: 2,
        height: 5.5,
        borderRadius: 1,
        top: 1,
        left: 5.5,
        transform: [{ rotate: '45deg' }],
    },
    uploadArrowRight: {
        position: 'absolute',
        width: 2,
        height: 5.5,
        borderRadius: 1,
        top: 1,
        right: 5.5,
        transform: [{ rotate: '-45deg' }],
    },
    uploadTray: {
        position: 'absolute',
        bottom: 1,
        width: 16,
        height: 6,
        borderBottomLeftRadius: 3,
        borderBottomRightRadius: 3,
        borderWidth: 1.5,
        borderTopWidth: 0,
    },
    // Close Icon
    closeIconContainer: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    closeLine1: {
        position: 'absolute',
        height: 1.8,
        borderRadius: 1,
        transform: [{ rotate: '45deg' }],
    },
    closeLine2: {
        position: 'absolute',
        height: 1.8,
        borderRadius: 1,
        transform: [{ rotate: '-45deg' }],
    },
    // File Icon
    fileIconContainer: {
        width: 20,
        height: 24,
        justifyContent: 'center',
        alignItems: 'center',
    },
    fileBody: {
        width: 16,
        height: 20,
        borderRadius: 2,
        borderWidth: 1.5,
    },
    fileFold: {
        position: 'absolute',
        top: 0,
        right: 0,
        width: 7,
        height: 7,
        borderBottomLeftRadius: 2,
        borderLeftWidth: 1.5,
        borderBottomWidth: 1.5,
    },
    // BackArrow Icon
    backArrow: {
        width: 22,
        height: 22,
        justifyContent: 'center',
        alignItems: 'center',
    },
    backArrowLine1: {
        position: 'absolute',
        width: 10,
        height: 2,
        borderRadius: 1,
        transform: [{rotate: '-45deg'}, {translateY: -3}],
        left: 2,
    },
    backArrowLine2: {
        position: 'absolute',
        width: 10,
        height: 2,
        borderRadius: 1,
        transform: [{rotate: '45deg'}, {translateY: 3}],
        left: 2,
    },
    backArrowShaft: {
        position: 'absolute',
        width: 16,
        height: 2,
        borderRadius: 1,
        left: 2,
    },
    // Agent Icon
    agentIcon: {
        position: 'relative',
    },
    agentEye: {
        position: 'absolute',
    },
    agentMouth: {
        position: 'absolute',
        alignSelf: 'center',
        height: 0,
        borderBottomWidth: 2,
        borderRadius: 2,
    },
    // Play Icon
    playTriangle: {
        width: 0,
        height: 0,
        borderLeftWidth: 14,
        borderTopWidth: 9,
        borderBottomWidth: 9,
        borderTopColor: 'transparent',
        borderBottomColor: 'transparent',
        marginLeft: 3,
    },
});
