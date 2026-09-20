import React from 'react';
import { Animated } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const ProfileIcon = ({ size = 24, color = '#000' }: { size?: number; color?: any }) => {
    return (
        <Svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
        >
            <AnimatedPath
                d="M17.925 20.056a6 6 0 0 0-11.851.001"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <AnimatedCircle
                cx={12}
                cy={11}
                r={4}
                stroke={color}
                strokeWidth={2}
            />
            <AnimatedCircle
                cx={12}
                cy={12}
                r={10}
                stroke={color}
                strokeWidth={2}
            />
        </Svg>
    );
};

export default ProfileIcon;
