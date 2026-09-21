import React from 'react';
import { Animated } from 'react-native';
import Svg, { Path } from 'react-native-svg';

const AnimatedPath = Animated.createAnimatedComponent(Path);

const ShareIcon = ({ size = 24, color = '#000' }: { size?: number; color?: any }) => {
    return (
        <Svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
        >
            <AnimatedPath
                d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <AnimatedPath
                d="m16 6-4-4-4 4"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <AnimatedPath
                d="M12 2v13"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </Svg>
    );
};

export default ShareIcon;
