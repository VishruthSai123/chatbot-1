import { motion } from "framer-motion";
import { SpireMark, SpireWordmark } from "@/components/brand/spire-mark";

export const Greeting = () => (
  <div className="flex flex-col items-center px-4" key="overview">
    <motion.div
      animate={{ opacity: 1, scale: 1 }}
      className="mb-7 flex h-14 items-center gap-3 rounded-2xl border border-border/40 bg-card/30 px-5 text-muted-foreground/70 shadow-[var(--shadow-float)]"
      initial={{ opacity: 0, scale: 0.9 }}
      transition={{ delay: 0.2, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      <SpireMark className="size-7" />
      <SpireWordmark className="h-5 text-foreground/80" />
    </motion.div>
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="text-center font-semibold text-2xl tracking-tight text-foreground md:text-3xl"
      initial={{ opacity: 0, y: 10 }}
      transition={{ delay: 0.35, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      What can I help with?
    </motion.div>
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="mt-3 max-w-lg text-center text-muted-foreground/80 text-sm"
      initial={{ opacity: 0, y: 10 }}
      transition={{ delay: 0.5, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      Ask anything, or start with a tool below.
    </motion.div>
  </div>
);
