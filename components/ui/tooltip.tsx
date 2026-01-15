"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface TooltipProviderProps {
  children: React.ReactNode;
  delayDuration?: number;
}

const TooltipContext = React.createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
}>({ open: false, setOpen: () => {} });

function TooltipProvider({ children }: TooltipProviderProps) {
  return <>{children}</>;
}

interface TooltipProps {
  children: React.ReactNode;
}

function Tooltip({ children }: TooltipProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <TooltipContext.Provider value={{ open, setOpen }}>
      <div className="relative inline-flex">
        {children}
      </div>
    </TooltipContext.Provider>
  );
}

interface TooltipTriggerProps {
  children: React.ReactNode;
  asChild?: boolean;
}

function TooltipTrigger({ children }: TooltipTriggerProps) {
  const { setOpen } = React.useContext(TooltipContext);

  return (
    <div
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      className="inline-flex cursor-help"
    >
      {children}
    </div>
  );
}

interface TooltipContentProps {
  children: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}

function TooltipContent({ children, side = "top", className }: TooltipContentProps) {
  const { open } = React.useContext(TooltipContext);

  if (!open) return null;

  const positionClasses = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
  };

  return (
    <div
      className={cn(
        "absolute z-50 px-3 py-1.5 text-xs bg-gray-900 text-gray-50 rounded-md shadow-md",
        "dark:bg-gray-50 dark:text-gray-900",
        "animate-in fade-in-0 zoom-in-95",
        positionClasses[side],
        className
      )}
    >
      {children}
    </div>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
