import React from 'react';
import Svg, { Path } from 'react-native-svg';

const SendIcon = ({ size = 24, color = '#000' }) => {
    return (
        <Svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
        >
            <Path
                d="m5 12 7-7 7 7"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <Path
                d="M12 19V5"
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
        </Svg>
    );
};

export default SendIcon;