import React from 'react';
import Svg, { Rect, Circle, Path } from 'react-native-svg';

const ImageIcon = ({ size = 24, color = '#000' }) => {
    return (
        <Svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
        >
            <Rect
                width={18}
                height={18}
                x={3}
                y={3}
                rx={2}
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <Circle
                cx={9}
                cy={9}
                r={2}
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <Path
                d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </Svg>
    );
};

export default ImageIcon;