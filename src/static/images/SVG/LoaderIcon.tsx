import React, { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const LoaderIcon = ({ size = 24, color = '#000' }: { size?: number; color?: any }) => {
    const spinAnim = useRef(new Animated.Value(0)).current;

    useEffect(() => {
        Animated.loop(
            Animated.timing(spinAnim, {
                toValue: 1,
                duration: 1000,
                easing: Easing.linear,
                useNativeDriver: true,
            })
        ).start();
    }, [spinAnim]);

    const spin = spinAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '360deg']
    });

    return (
        <Animated.View style={{ transform: [{ rotate: spin }] }}>
            <Svg
                width={size}
                height={size}
                viewBox="0 0 24 24"
                fill="none"
            >
                <AnimatedPath
                    d="M22 12a1 1 0 0 1-10 0 1 1 0 0 0-10 0"
                    stroke={color}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
                <AnimatedPath
                    d="M7 20.7a1 1 0 1 1 5-8.7 1 1 0 1 0 5-8.6"
                    stroke={color}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
                <AnimatedPath
                    d="M7 3.3a1 1 0 1 1 5 8.6 1 1 0 1 0 5 8.6"
                    stroke={color}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
                <AnimatedCircle
                    cx={12}
                    cy={12}
                    r={10}
                    stroke={color}
                    strokeWidth={2}
                />
            </Svg>
        </Animated.View>
    );
};

export default LoaderIcon;
