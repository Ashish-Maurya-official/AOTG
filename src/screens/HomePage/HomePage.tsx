import React, {
    useEffect,
    useRef,
    useState,
} from 'react';
import {
    Animated,
    Dimensions,
    Keyboard,
    KeyboardAvoidingView,
    Platform,
    Pressable, ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import {useTheme} from '../../theme/ThemeProvider';
import {MARGIN_HORIZONTAL} from '../../theme/spacing';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

const {width} = Dimensions.get('window');

const HomePage = () => {
    const theme = useTheme();
    const {colors} = theme;

    const widthAnim = useRef(new Animated.Value(width * 0.75)).current;
    const insets = useSafeAreaInsets();
    const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);

    const expand = () => {
        Animated.timing(widthAnim, {
            toValue: width * 0.85,
            duration: 500,
            useNativeDriver: false,
        }).start();
    };

    const collapse = () => {
        Animated.timing(widthAnim, {
            toValue: width * 0.75,
            duration: 500,
            useNativeDriver: false,
        }).start();
    };

    useEffect(() => {
        const showSubscription = Keyboard.addListener('keyboardDidShow', () => {
            setIsKeyboardVisible(true);
        });

        const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
            setIsKeyboardVisible(false);
        });

        return () => {
            showSubscription.remove();
            hideSubscription.remove();
        };
    }, []);

    return (
        <KeyboardAvoidingView
            style={{flex: 1}}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
            <Pressable
                onPress={() => {
                    Keyboard.dismiss();
                }}
                style={[styles.container, {backgroundColor: colors.background}]}>
                <View></View>
                <ScrollView contentContainerStyle={{flex:1}}>
                    {/* Header area */}
                    <View style={styles.headerArea}>
                        <Text style={[styles.greeting, {color: colors.text}]}>
                            Hello 👋
                        </Text>
                        <Text style={[styles.subtitle, {color: colors.secondaryText}]}>
                            How can I help you today?
                        </Text>
                    </View>
                </ScrollView>

                {/* Animated Input */}
                <Animated.View
                    style={[
                        styles.inputContainer,
                        {
                            width: widthAnim,
                            backgroundColor: colors.card,
                            borderColor: colors.border,
                        },
                    ]}>
                    <TextInput
                        style={[styles.input, {color: colors.text}]}
                        placeholder="Ask your question..."
                        placeholderTextColor={colors.secondaryText}
                        onFocus={expand}
                        onBlur={collapse}
                    />
                </Animated.View>
            </Pressable>
        </KeyboardAvoidingView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'flex-end',
        alignItems: 'center',
        paddingVertical:10,
    },
    headerArea: {
        position: 'absolute',
        top: '35%',
        alignItems: 'center',
    },
    greeting: {
        fontSize: 28,
        fontWeight: '700',
    },
    subtitle: {
        fontSize: 16,
        marginTop: 8,
    },
    inputContainer: {
        marginHorizontal: MARGIN_HORIZONTAL,
        borderRadius: 20,
        alignItems: 'center',
        position: 'absolute',
        borderWidth: 1,
        paddingVertical: 4,
    },
    input: {
        width: '90%',
        paddingVertical: 12,
        fontSize: 16,
    },
});

export default HomePage;
