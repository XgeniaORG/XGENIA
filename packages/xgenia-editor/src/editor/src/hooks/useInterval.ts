import { useEffect, useRef } from 'react';

type IntervalCallback = () => Promise<void> | void;

export function useInterval(callback: IntervalCallback, delay: number) {
    const savedCallback = useRef<IntervalCallback | null>(null); // Initialize with null

    useEffect(() => {
        savedCallback.current = callback;
    }, [callback]);

    useEffect(() => {
        let timeoutId: NodeJS.Timeout;
        let cancelTimeout = false;

        function tick() { // NOT async
            try {
                // ALWAYS check if savedCallback.current is defined before calling
                if (savedCallback.current) {
                    const result = savedCallback.current(); // Call without await

                    if (result && typeof result.then === 'function') {
                        // It's a Promise
                        result.then(() => {
                            if (!cancelTimeout && delay !== null) {
                                timeoutId = setTimeout(tick, delay);
                            }
                        }).catch((e) => {
                            console.error("Error in useInterval callback:", e);
                        });
                    } else {
                        // It's synchronous
                        if (!cancelTimeout && delay !== null) {
                            timeoutId = setTimeout(tick, delay);
                        }
                    }
                }
            } catch (e: any) {
                console.error("Error in useInterval callback:", e);
            }
        }

        if (delay !== null) {
            tick();
        }

        return () => {
            cancelTimeout = true;
            clearTimeout(timeoutId);
        };
    }, [delay]);
}
