
"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

interface ScrollRevealProps {
    children: ReactNode;
    delay?: number;
}

export default function ScrollReveal({
                                         children,
                                         delay = 0,
                                     }: ScrollRevealProps) {
    const [reduceMotion, setReduceMotion] = useState(false);

    useEffect(() => {
        const media = window.matchMedia(
            "(prefers-reduced-motion: reduce)"
        );

        const update = () => {
            setReduceMotion(media.matches);
        };

        update();

        media.addEventListener("change", update);

        return () => {
            media.removeEventListener("change", update);
        };
    }, []);

    return (
        <motion.div
            initial={{
                opacity: 0,
                y: 28,
            }}
            whileInView={{
                opacity: 1,
                y: 0,
            }}
            viewport={{
                once: true,
                amount: 0.15,
            }}
            transition={{
                duration: reduceMotion ? 0 : 0.65,
                delay: reduceMotion ? 0 : delay,
                ease: [0.22, 1, 0.36, 1],
            }}
            className="motion-reduce:!transform-none motion-reduce:!opacity-100"
        >
            {children}
        </motion.div>
    );
}
