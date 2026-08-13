import React, { useRef } from "react";
import { Animated, Easing, StyleSheet, ViewStyle, View } from "react-native";

/**
 * PressScale — wraps content in an animated view that scales down subtly on
 * press (premium tactile feel) and springs back on release. Use anywhere a
 * card/button would benefit from physical feedback.
 */
export function PressScale({
  children,
  style,
  scaleTo = 0.97,
}: {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  scaleTo?: number;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const pressIn = () => {
    Animated.spring(scale, {
      toValue: scaleTo,
      useNativeDriver: true,
      speed: 40,
      bounciness: 4,
    }).start();
  };
  const pressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 30,
      bounciness: 8,
    }).start();
  };

  return (
    <Animated.View
      style={[{ transform: [{ scale }] }, style]}
      onTouchStart={pressIn}
      onTouchEnd={pressOut}
      onTouchCancel={pressOut}
    >
      {children}
    </Animated.View>
  );
}

/**
 * FadeSlideIn — fades in and slides up a touch on mount. `delay` lets callers
 * stagger lists of cards for a polished cascade effect.
 */
export function FadeSlideIn({
  children,
  delay = 0,
  distance = 14,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  distance?: number;
  style?: ViewStyle | ViewStyle[];
}) {
  const anim = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 320,
      delay,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [anim, delay]);

  return (
    <Animated.View
      style={[
        {
          opacity: anim,
          transform: [
            {
              translateY: anim.interpolate({
                inputRange: [0, 1],
                outputRange: [distance, 0],
              }),
            },
          ],
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * Stagger — renders children one after another with a cascading fade/slide
 * (Apple Music-style entrance). Best for fixed-size collections.
 */
export function Stagger({ children, step = 60 }: { children: React.ReactNode[]; step?: number }) {
  return (
    <View>
      {React.Children.map(children, (child, i) => (
        <FadeSlideIn key={i} delay={i * step} distance={12}>
          {child}
        </FadeSlideIn>
      ))}
    </View>
  );
}

/** Shared spring config used across entrance animations. */
export const spring = {
  damping: 18,
  stiffness: 190,
  mass: 1,
};
