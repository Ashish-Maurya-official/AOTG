import React from 'react';
import { Animated } from 'react-native';
import Svg, { Path, Rect, Circle } from 'react-native-svg';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const NpuIcon = ({ size = 24, color = '#000' }: { size?: number; color?: any }) => {
    return (
        <Svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
        >
            {/* Outer Chip */}
            <AnimatedRect
                x={4}
                y={4}
                width={16}
                height={16}
                rx={2}
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            
            {/* Pins */}
            <AnimatedPath
                d="M12 20v2 M12 2v2 M17 20v2 M17 2v2 M2 12h2 M2 17h2 M2 7h2 M20 12h2 M20 17h2 M20 7h2 M7 20v2 M7 2v2"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
            />

            {/* Neural Network Nodes */}
            <AnimatedPath
                d="M8 8l4 4 M16 8l-4 4 M8 16l4-4 M16 16l-4-4"
                stroke={color}
                strokeWidth={1.5}
                strokeLinecap="round"
                strokeLinejoin="round"
            />

            <AnimatedCircle cx={8} cy={8} r={1.5} fill={color} />
            <AnimatedCircle cx={16} cy={8} r={1.5} fill={color} />
            <AnimatedCircle cx={8} cy={16} r={1.5} fill={color} />
            <AnimatedCircle cx={16} cy={16} r={1.5} fill={color} />
            <AnimatedCircle cx={12} cy={12} r={1.5} fill={color} />
        </Svg>
    );
};

export default NpuIcon;
