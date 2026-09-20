import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const LiveIcon = ({ size = 24, color = '#000', isAnimated = true }: { size?: number; color?: any; isAnimated?: boolean }) => {
    const pulseAnim = useRef(new Animated.Value(isAnimated ? 0.2 : 1)).current;

    useEffect(() => {
        if (!isAnimated) {
            pulseAnim.setValue(1);
            return;
        }

        const animLoop = Animated.loop(
            Animated.sequence([
                Animated.timing(pulseAnim, {
                    toValue: 1,
                    duration: 600,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: false,
                }),
                Animated.timing(pulseAnim, {
                    toValue: 0.2,
                    duration: 600,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: false,
                }),
            ])
        );
        animLoop.start();

        return () => animLoop.stop();
    }, [pulseAnim, isAnimated]);

    return (
        <Svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
        >
            <AnimatedPath
                d="M16.247 7.761a6 6 0 0 1 0 8.478"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeOpacity={pulseAnim}
            />
            <AnimatedPath
                d="M19.075 4.933a10 10 0 0 1 0 14.134"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeOpacity={pulseAnim}
            />
            <AnimatedPath
                d="M4.925 19.067a10 10 0 0 1 0-14.134"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeOpacity={pulseAnim}
            />
            <AnimatedPath
                d="M7.753 16.239a6 6 0 0 1 0-8.478"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeOpacity={pulseAnim}
            />
            <AnimatedCircle
                cx={12}
                cy={12}
                r={2}
                stroke={color}
                strokeWidth={2}
            />
        </Svg>
    );
};

export default LiveIcon;
