import React from 'react';
import { Animated } from 'react-native';
import Svg, { Path, Rect, Circle } from 'react-native-svg';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const GpuIcon = ({ size = 24, color = '#000' }: { size?: number; color?: any }) => {
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

            {/* GPU Fan */}
            <AnimatedCircle cx={12} cy={12} r={4} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            {/* Diagonal Fan Blades */}
            <AnimatedPath
                d="M9.172 9.172l5.656 5.656 M14.828 9.172l-5.656 5.656"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </Svg>
    );
};

export default GpuIcon;
