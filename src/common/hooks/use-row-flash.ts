import { useCallback, useEffect, useRef, useState } from "react";

const FLASH_DURATION = 1600;

export const useRowFlash = () => {
  const [flashIndex, setFlashIndex] = useState<number | null>(null);
  const timerRef = useRef<number>(0);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const flash = useCallback((index: number) => {
    window.clearTimeout(timerRef.current);
    setFlashIndex(index);
    timerRef.current = window.setTimeout(() => setFlashIndex(null), FLASH_DURATION);
  }, []);

  return { flashIndex, flash };
};
