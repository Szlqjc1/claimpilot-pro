"use client";

import * as T from "@radix-ui/react-tooltip";

export function Tooltip({ content, children }: { content: React.ReactNode; children: React.ReactNode }) {
  return (
    <T.Provider delayDuration={150}>
      <T.Root>
        <T.Trigger asChild>{children}</T.Trigger>
        <T.Portal>
          <T.Content sideOffset={6} className="z-50 max-w-72 rounded-lg bg-navy-950 px-3 py-2 text-xs leading-relaxed text-white shadow-lg">
            {content}
            <T.Arrow className="fill-navy-950" />
          </T.Content>
        </T.Portal>
      </T.Root>
    </T.Provider>
  );
}
