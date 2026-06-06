import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { LuCornerDownLeft, LuDelete } from "react-icons/lu";

import api from "@/api";
import { cx } from "@/cva.config";
import { DEVICE_API } from "@/ui.config";
import useKeyboard, { type MacroStep } from "@hooks/useKeyboard";

type Position = {
  x: number;
  y: number;
};

type CompanionCredentialStatus = {
  keyguard_auth_state?: string;
};

type CompanionStatusResponse = {
  companions?: CompanionCredentialStatus[];
};

const STORAGE_KEY = "androidCredentialPromptPosition";
const PROMPT_WIDTH = 340;
const PROMPT_HEIGHT = 560;
const EDGE_PADDING = 10;
const MAX_VISIBLE_DIGITS = 16;

const digitButtons = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const getDefaultPosition = (): Position => {
  if (typeof window === "undefined") return { x: EDGE_PADDING, y: EDGE_PADDING };

  return {
    x: Math.max(EDGE_PADDING, Math.round((window.innerWidth - PROMPT_WIDTH) / 2)),
    y: Math.max(EDGE_PADDING, Math.round(window.innerHeight * 0.2)),
  };
};

const clampPosition = (position: Position): Position => {
  if (typeof window === "undefined") return position;

  return {
    x: clamp(position.x, EDGE_PADDING, window.innerWidth - PROMPT_WIDTH - EDGE_PADDING),
    y: clamp(position.y, EDGE_PADDING, window.innerHeight - PROMPT_HEIGHT - EDGE_PADDING),
  };
};

const getStoredPosition = (): Position => {
  if (typeof window === "undefined") return { x: EDGE_PADDING, y: EDGE_PADDING };

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) || "null",
    ) as Position | null;
    if (parsed && Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
      return clampPosition(parsed);
    }
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
  }

  return getDefaultPosition();
};

export default function CredentialPromptOverlay() {
  const [active, setActive] = useState(false);
  const [position, setPosition] = useState<Position>(() => getStoredPosition());
  const [enteredDigits, setEnteredDigits] = useState("");
  const { executeMacro } = useKeyboard();
  const dragRef = useRef<{
    offsetX: number;
    offsetY: number;
    pointerId: number;
  } | null>(null);

  const persistPosition = useCallback((next: Position) => {
    const clamped = clampPosition(next);
    setPosition(clamped);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(clamped));
  }, []);

  useEffect(() => {
    const onResize = () => persistPosition(position);
    window.addEventListener("orientationchange", onResize);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("orientationchange", onResize);
      window.removeEventListener("resize", onResize);
    };
  }, [persistPosition, position]);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const resp = await api.GET(`${DEVICE_API}/companion/status`);
        if (!resp.ok) return;

        const body = (await resp.json()) as CompanionStatusResponse;
        const nextActive = (body.companions || []).some(
          companion => companion.keyguard_auth_state === "credential_entry_requested",
        );
        if (!cancelled) setActive(nextActive);
      } catch {
        // Companion request center handles general companion status failures.
      }
    };

    void refresh();
    const id = window.setInterval(() => void refresh(), 500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (!active) setEnteredDigits("");
  }, [active]);

  const sendKey = useCallback(
    async (key: string) => {
      const steps: MacroStep[] = [{ keys: [key], modifiers: null, delay: 80 }];
      await executeMacro(steps);
    },
    [executeMacro],
  );

  const pressDigit = useCallback(
    (digit: string) => {
      setEnteredDigits(value => `${value}${digit}`.slice(-MAX_VISIBLE_DIGITS));
      void sendKey(`Digit${digit}`);
    },
    [sendKey],
  );

  const pressBackspace = useCallback(() => {
    setEnteredDigits(value => value.slice(0, -1));
    void sendKey("Backspace");
  }, [sendKey]);

  const pressEnter = useCallback(() => {
    void sendKey("Enter");
  }, [sendKey]);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      offsetX: event.clientX - position.x,
      offsetY: event.clientY - position.y,
      pointerId: event.pointerId,
    };
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    persistPosition({
      x: event.clientX - drag.offsetX,
      y: event.clientY - drag.offsetY,
    });
  };

  const finishDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  if (!active) return null;

  const keyButtonClass = cx(
    "flex h-16 min-h-16 items-center justify-center rounded-lg",
    "border border-white/10 bg-white/10 text-2xl font-semibold text-white shadow-sm",
    "transition hover:bg-white/15 active:scale-[0.98] active:bg-white/20",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7aa7ff]",
  );

  return (
    <div
      role="dialog"
      aria-label="Enter credentials"
      className={cx(
        "fixed z-[60] flex flex-col overflow-hidden rounded-xl select-none",
        "border border-white/10 bg-[#070c1c] text-white shadow-2xl",
      )}
      style={{
        height: `min(${PROMPT_HEIGHT}px, calc(100vh - ${EDGE_PADDING * 2}px))`,
        left: position.x,
        top: position.y,
        width: `min(${PROMPT_WIDTH}px, calc(100vw - ${EDGE_PADDING * 2}px))`,
      }}
      onPointerCancel={() => {
        dragRef.current = null;
      }}
    >
      <div
        className="flex touch-none flex-col items-center border-b border-white/10 px-6 py-6"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={finishDrag}
      >
        <div className="text-sm font-semibold tracking-[0.2em] text-[#7aa7ff] uppercase">
          JetKVM
        </div>
        <div className="mt-4 text-2xl font-semibold">Enter credentials</div>
        <div className="mt-2 text-sm text-slate-300">Unlock the Android device</div>
      </div>

      <div className="flex flex-1 flex-col px-6 py-5">
        <div
          aria-live="polite"
          className={cx(
            "flex h-14 min-h-14 items-center justify-center rounded-lg",
            "border border-white/10 bg-black/30 px-3 text-center",
            "font-mono text-2xl font-semibold text-white",
          )}
        >
          {enteredDigits || <span className="text-slate-500">PIN</span>}
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3">
          {digitButtons.map(digit => (
            <button
              key={digit}
              type="button"
              className={keyButtonClass}
              onClick={() => pressDigit(digit)}
            >
              {digit}
            </button>
          ))}
          <button
            type="button"
            className={keyButtonClass}
            aria-label="Backspace"
            onClick={pressBackspace}
          >
            <LuDelete aria-hidden className="h-7 w-7" />
          </button>
          <button type="button" className={keyButtonClass} onClick={() => pressDigit("0")}>
            0
          </button>
          <button
            type="button"
            className={cx(keyButtonClass, "bg-[#1447e6] hover:bg-[#2558f4] active:bg-[#1447e6]")}
            aria-label="Enter"
            onClick={pressEnter}
          >
            <LuCornerDownLeft aria-hidden className="h-7 w-7" />
          </button>
        </div>
      </div>
    </div>
  );
}
