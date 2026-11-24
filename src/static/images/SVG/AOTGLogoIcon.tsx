import React, { memo } from 'react';
import Svg, {
    Path,
    Rect,
    Circle,
    Defs,
    LinearGradient,
    Stop,
    G,
} from 'react-native-svg';

export interface AOTGLogoIconProps {
    size?: number;
    withBackground?: boolean;
    color?: string;
    idPrefix?: string;
}

/**
 * AOTG Master Kinetic Neural Möbius Logo
 * Represents air-gapped sovereign edge intelligence:
 * Fuses the infinity loop (∞), glyphs 'A' and 'O', and the central synaptic core.
 */
const AOTGLogoIcon = memo(({
    size = 32,
    withBackground = false,
    color,
    idPrefix = 'aotg',
}: AOTGLogoIconProps) => {
    const gradId = `${idPrefix}_neuralGrad`;

    return (
        <Svg
            width={size}
            height={size}
            viewBox="0 0 512 512"
            fill="none"
        >
            <Defs>
                <LinearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
                    <Stop offset="0%" stopColor="#3CDDC7" />
                    <Stop offset="50%" stopColor="#10B981" />
                    <Stop offset="100%" stopColor="#059669" />
                </LinearGradient>
            </Defs>

            {withBackground && (
                <>
                    {/* Obsidian Void Monolith Squircle */}
                    <Rect width={512} height={512} rx={112} fill="#090A0F" />
                    {/* Chamfered Specular Edge Reflection */}
                    <Rect
                        width={510}
                        height={510}
                        x={1}
                        y={1}
                        rx={111}
                        fill="none"
                        stroke="rgba(255, 255, 255, 0.08)"
                        strokeWidth={1.5}
                    />
                </>
            )}

            {/* Kinetic Neural Möbius Vector Geometry */}
            <G transform="translate(256, 256)">
                {/* Continuous Möbius Ribbon (Double-Lobe Loop) */}
                <Path
                    d="M -120,40 C -180,40 -200,-50 -130,-90 C -60,-130 0,-20 0,-20 C 0,-20 60,-130 130,-90 C 200,-50 180,40 120,40 C 60,40 30,-10 0,-50 C -30,-10 -60,40 -120,40 Z"
                    fill="none"
                    stroke={color || `url(#${gradId})`}
                    strokeWidth={36}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />

                {/* Central Horizontal Apex Grounding ('A' Crossbar & Silicon Substrate Bed) */}
                <Path
                    d="M -54,30 L 54,30"
                    stroke={color || '#3CDDC7'}
                    strokeWidth={24}
                    strokeLinecap="round"
                    opacity={0.95}
                />

                {/* Concentric Synaptic Enclave Node (White Focal Point) */}
                <Circle
                    cx={0}
                    cy={-50}
                    r={14}
                    fill={color || '#F8FAFC'}
                />
            </G>
        </Svg>
    );
});

export default AOTGLogoIcon;
