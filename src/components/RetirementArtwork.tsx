
"use client";

import Image from "next/image";
import { motion } from "motion/react";
import { useEffect, useState } from "react";

export default function RetirementArtwork() {
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
        <div className="w-full">
            <motion.div
                initial={{
                    x: 180,
                    rotate: 12,
                    opacity: 0,
                }}
                animate={{
                    x: 0,
                    rotate: 0,
                    opacity: 1,
                }}
                transition={
                    reduceMotion
                        ? { duration: 0 }
                        : {
                            type: "spring",
                            stiffness: 65,
                            damping: 14,
                            mass: 1.3,
                        }
                }
                className="relative h-64 w-full motion-reduce:!transform-none motion-reduce:!opacity-100 lg:h-[360px]"
            >
                <Image
                    src="/images/roborio-retirement-hero.png"
                    alt="A roboRIO controller being carted away into retirement"
                    fill
                    sizes="(max-width: 1023px) 100vw, 40vw"
                    className="object-contain"
                    priority
                />
            </motion.div>

            <motion.div
                initial={{
                    opacity: 0,
                    y: 12,
                }}
                animate={{
                    opacity: 1,
                    y: 0,
                }}
                transition={{
                    duration: reduceMotion ? 0 : 0.5,
                    delay: reduceMotion ? 0 : 1.5,
                }}
                className="mt-2 border-t border-white/15 pt-4 motion-reduce:!transform-none motion-reduce:!opacity-100"
            >
                <p className="font-technical text-xs font-bold tracking-wider text-lime-400">
                    ● DECOMMISSIONING COMPLETE
                </p>

                <p className="font-technical mt-2 text-xs text-gray-400">
                    LEGACY HARDWARE HAS LEFT THE BUILDING.
                </p>
            </motion.div>
        </div>
    );
}
