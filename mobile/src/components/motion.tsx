import React, { useEffect, useRef } from "react";
import { Animated, Easing, ViewStyle, View } from "react-native";

/**
 * Apple-style spring used across the app for entrance/press animations.
 * Slightly snappier than the React Native default to match iOS 17/18 motion.
 */
export const spring = {
  damping: 18,
  stiffness: 220,
  mass: 1,
};

export const springSoft = {
  damping: 22,
  stiffness: 180,
  mass: 1,
};

/**
 * PressScale — wraps content in an animated view that scales down subtly on
 * press (premium tactile feel) and springs back on release. Use anywhere a
 * card/button would benefit from physical feedback.
 */
export function PressScale({
  children,
  style,
  scaleTo = 0.97,
  opacityTo,
}: {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  scaleTo?: number;
  opacityTo?: number;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;

  const pressIn = () => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: scaleTo,
        useNativeDriver: true,
        speed: 40,
        bounciness: 4,
        ...spring,
      }),
      ...(opacityTo !== undefined
        ? [Animated.timing(opacity, { toValue: opacityTo, duration: 120, useNativeDriver: true })]
        : []),
    ]).start();
  };
  const pressOut = () => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        speed: 30,
        bounciness: 8,
        ...spring,
      }),
      ...(opacityTo !== undefined
        ? [Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true })]
        : []),
    ]).start();
  };

  return (
    <Animated.View
      style={[{ transform: [{ scale }], opacity }, style]}
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
  duration = 360,
}: {
  children: React.ReactNode;
  delay?: number;
  distance?: number;
  style?: ViewStyle | ViewStyle[];
  duration?: number;
}) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration,
      delay,
      easing: Easing.bezier(0.16, 1, 0.3, 1), // soft quint out
      useNativeDriver: true,
    }).start();
  }, [anim, delay, duration]);

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
export function Stagger({
  children,
  step = 60,
  initialDelay = 0,
}: {
  children: React.ReactNode[];
  step?: number;
  initialDelay?: number;
}) {
  return (
    <View>
      {React.Children.map(children, (child, i) => (
        <FadeSlideIn key={i} delay={initialDelay + i * step} distance={12}>
          {child}
        </FadeSlideIn>
      ))}
    </View>
  );
}

/**
 * SectionReveal — fades + slides a hero/section on mount. Use for the top
 * hero on each screen so the first paint doesn't snap in.
 */
export function SectionReveal({
  children,
  delay = 0,
  style,
}: {
  children: React.ReactNode;
  delay?: number;
  style?: ViewStyle | ViewStyle[];
}) {
  return (
    <FadeSlideIn delay={delay} distance={20} duration={420} style={style}>
      {children}
    </FadeSlideIn>
  );
}
