import { useCallback, useEffect, useState } from "react";
import { LuCornerDownLeft, LuDelete } from "react-icons/lu";

import api from "@/api";
import { cx } from "@/cva.config";
import { DEVICE_API } from "@/ui.config";
import useKeyboard, { type MacroStep } from "@hooks/useKeyboard";

type CompanionCredentialStatus = {
  keyguard_auth_state?: string;
};

type CompanionStatusResponse = {
  companions?: CompanionCredentialStatus[];
};

const PROMPT_WIDTH = 340;
const PROMPT_HEIGHT = 560;
const EDGE_PADDING = 10;
const MAX_VISIBLE_DIGITS = 16;

const digitButtons = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

const digitFromKeyboardEvent = (event: KeyboardEvent) => {
  if (/^[0-9]$/.test(event.key)) return event.key;
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(-1);
  if (/^Numpad[0-9]$/.test(event.code)) return event.code.slice(-1);
  return null;
};

export default function CredentialPromptOverlay() {
  const [active, setActive] = useState(false);
  const [enteredDigits, setEnteredDigits] = useState("");
  const { executeMacro } = useKeyboard();

  const mirrorDigit = useCallback((digit: string) => {
    setEnteredDigits(value => `${value}${digit}`.slice(-MAX_VISIBLE_DIGITS));
  }, []);

  const mirrorBackspace = useCallback(() => {
    setEnteredDigits(value => value.slice(0, -1));
  }, []);

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

  useEffect(() => {
    if (!active) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const digit = digitFromKeyboardEvent(event);
      if (digit !== null) {
        mirrorDigit(digit);
        return;
      }

      if (event.key === "Backspace" || event.code === "Backspace") {
        mirrorBackspace();
      }
    };

    const onAndroidImeText = (event: Event) => {
      const text = (event as CustomEvent<{ text?: string }>).detail?.text;
      if (!text) return;

      for (const char of text) {
        if (/^[0-9]$/.test(char)) {
          mirrorDigit(char);
        } else if (char === "\b" || char === "\u007f") {
          mirrorBackspace();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    window.addEventListener("jetkvm-android-ime-text", onAndroidImeText);
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      window.removeEventListener("jetkvm-android-ime-text", onAndroidImeText);
    };
  }, [active, mirrorBackspace, mirrorDigit]);

  const sendKey = useCallback(
    async (key: string) => {
      const steps: MacroStep[] = [{ keys: [key], modifiers: null, delay: 80 }];
      await executeMacro(steps);
    },
    [executeMacro],
  );

  const pressDigit = useCallback(
    (digit: string) => {
      mirrorDigit(digit);
      void sendKey(`Digit${digit}`);
    },
    [mirrorDigit, sendKey],
  );

  const pressBackspace = useCallback(() => {
    mirrorBackspace();
    void sendKey("Backspace");
  }, [mirrorBackspace, sendKey]);

  const pressEnter = useCallback(() => {
    void sendKey("Enter");
  }, [sendKey]);

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
        "absolute inset-0 z-30 flex items-center justify-center overflow-hidden select-none",
        "bg-[#070c1c] text-white",
      )}
    >
      <div
        className={cx(
          "flex max-h-[calc(100%-20px)] flex-col overflow-hidden rounded-xl",
          "border border-white/10 bg-[#070c1c] shadow-2xl",
        )}
        style={{
          height: `min(${PROMPT_HEIGHT}px, calc(100% - ${EDGE_PADDING * 2}px))`,
          width: `min(${PROMPT_WIDTH}px, calc(100% - ${EDGE_PADDING * 2}px))`,
        }}
      >
        <div className="flex flex-col items-center border-b border-white/10 px-6 py-6">
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
    </div>
  );
}
