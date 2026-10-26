
"use client";

import Image from "next/image";
import { motion, useReducedMotion } from "motion/react";

export default function RetirementArtwork() {
    const reduceMotion = useReducedMotion();


    return (
        <div className="w-full">
            {/* The roboRIO rolling into retirement */}
            <motion.div
                initial={
                    reduceMotion
                        ? false
                        : {
                            x: 180,
                            rotate: 12,
                            opacity: 0,
                        }
                }
                animate={{
                    x: 0,
                    rotate: 0,
                    opacity: 1,
                }}
                transition={{
                    type: "spring",
                    stiffness: 65,
                    damping: 14,
                    mass: 1.3,
                }}
                className="relative h-64 w-full lg:h-[360px]"
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

            {/* Status appears after the roboRIO settles */}
            <motion.div
                initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                    duration: 0.5,
                    delay: reduceMotion ? 0 : 1.5,
                }}
                className="mt-2 border-t border-white/15 pt-4"
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
