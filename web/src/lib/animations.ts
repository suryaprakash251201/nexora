import { type Variants, type Transition } from "motion/react";

export const fadeIn: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

export const slideUp: Variants = {
  initial: { y: 16, opacity: 0 },
  animate: { y: 0, opacity: 1 },
  exit: { y: -16, opacity: 0 },
};

export const scaleIn: Variants = {
  initial: { scale: 0.95, opacity: 0 },
  animate: { scale: 1, opacity: 1 },
  exit: { scale: 0.95, opacity: 0 },
};

export const slideInRight: Variants = {
  initial: { x: "100%", opacity: 0.5 },
  animate: { x: 0, opacity: 1 },
  exit: { x: "100%", opacity: 0.5 },
};

export const staggerContainer: Variants = {
  initial: {},
  animate: {
    transition: {
      staggerChildren: 0.05,
      delayChildren: 0.1,
    },
  },
};

export const staggerItem: Variants = {
  initial: { y: 16, opacity: 0, scale: 0.98 },
  animate: {
    y: 0,
    opacity: 1,
    scale: 1,
    transition: {
      duration: 0.35,
      ease: [0.25, 0.1, 0.25, 1],
    },
  },
};

export const cardHover = {
  whileHover: {
    y: -4,
    boxShadow:
      "0 8px 16px rgba(0,0,0,0.12), 0 24px 48px rgba(0,0,0,0.10), 0 0 40px rgba(91,140,255,0.08)",
    transition: { duration: 0.2, ease: "easeOut" },
  },
  whileTap: {
    scale: 0.98,
    transition: { duration: 0.1, ease: "easeOut" },
  },
};

export const buttonTap: Transition = {
  type: "spring",
  stiffness: 400,
  damping: 17,
};

export const springTransition: Transition = {
  type: "spring",
  stiffness: 300,
  damping: 25,
};

export const smoothTransition: Transition = {
  duration: 0.2,
  ease: [0.25, 0.1, 0.25, 1],
};

export const drawerTransition: Transition = {
  type: "spring",
  stiffness: 300,
  damping: 30,
  mass: 1,
};
