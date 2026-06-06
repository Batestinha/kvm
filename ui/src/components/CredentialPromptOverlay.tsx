import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import api from "@/api";
import { cx } from "@/cva.config";
import { DEVICE_API } from "@/ui.config";

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

declare global {
  interface Window {
    JetKVMAndroid?: {
      hideKeyboard?: () => void;
      showInputMethod?: () => void;
    };
  }
}

const STORAGE_KEY = "androidCredentialPromptPosition";
const PROMPT_WIDTH = 188;
const PROMPT_HEIGHT = 48;
const EDGE_PADDING = 10;

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

export default function CredentialPromptOverlay({
  enableControllerOsk,
}: {
  enableControllerOsk: boolean;
}) {
  const [active, setActive] = useState(false);
  const [position, setPosition] = useState<Position>(() => getStoredPosition());
  const wasActiveRef = useRef(false);
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
    if (!enableControllerOsk) return;

    if (active) {
      wasActiveRef.current = true;
      window.JetKVMAndroid?.showInputMethod?.();
    } else if (wasActiveRef.current) {
      wasActiveRef.current = false;
      window.JetKVMAndroid?.hideKeyboard?.();
    }
  }, [active, enableControllerOsk]);

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

  return (
    <div
      role="status"
      className={cx(
        "fixed z-[60] flex touch-none items-center justify-center rounded-md select-none",
        "bg-black/50 px-4 text-center text-base font-semibold text-white shadow-xl",
      )}
      style={{
        height: PROMPT_HEIGHT,
        left: position.x,
        top: position.y,
        width: PROMPT_WIDTH,
      }}
      onPointerCancel={() => {
        dragRef.current = null;
      }}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={finishDrag}
    >
      Enter credentials
    </div>
  );
}
