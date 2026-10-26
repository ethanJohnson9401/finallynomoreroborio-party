
import confetti from "canvas-confetti";

// Prevent multiple celebrations from running simultaneously.
let celebrationRunning = false;

const COLORS = [
    "#D8FF48", // Lime
    "#FF633A", // Orange
    "#F7F3EA", // Cream
    "#EBA7FF", // Purple
];

export function launchCelebration() {
    if (celebrationRunning) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
    }

    celebrationRunning = true;

    const duration = 5000;
    const end = performance.now() + duration;

    // THE BIG EXPLOSION — original intensity restored!
    void confetti({
        particleCount: 350,
        spread: 130,
        startVelocity: 55,
        origin: { x: 0.5, y: 0.5 },
        colors: COLORS,
        scalar: 1.3,
        disableForReducedMotion: true,
    });

    let animationFrameId = 0;

    function frame() {
        if (performance.now() >= end) {
            celebrationRunning = false;
            return;
        }

        // Full-intensity cannons firing from both sides.
        void confetti({
            particleCount: 16,
            angle: 60,
            spread: 65,
            startVelocity: 55,
            origin: { x: 0, y: 0.8 },
            colors: COLORS,
            scalar: 1.2,
            disableForReducedMotion: true,
        });

        void confetti({
            particleCount: 16,
            angle: 120,
            spread: 65,
            startVelocity: 55,
            origin: { x: 1, y: 0.8 },
            colors: COLORS,
            scalar: 1.2,
            disableForReducedMotion: true,
        });

        animationFrameId = requestAnimationFrame(frame);
    }

    animationFrameId = requestAnimationFrame(frame);
}
