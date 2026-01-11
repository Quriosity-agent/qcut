"use client";

import { motion } from "motion/react";
import { Handlebars } from "./handlebars";

export function Hero() {
  return (
    <div className="min-h-[calc(100vh-4.5rem)] supports-[height:100dvh]:min-h-[calc(100dvh-4.5rem)] flex flex-col justify-between items-center text-center px-4 relative overflow-hidden bg-gray-950">
      {/* Neon Cyan gradient background effects */}
      <div className="absolute inset-0 bg-gradient-to-b from-gray-950 via-slate-900/50 to-gray-950" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(6,182,212,0.15),transparent)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_80%_60%,rgba(59,130,246,0.1),transparent)]" />

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1 }}
        className="max-w-3xl mx-auto w-full flex-1 flex flex-col justify-center relative z-10"
      >
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.8 }}
          className="inline-block font-bold tracking-tighter text-4xl md:text-[4rem] text-slate-100"
        >
          <h1>The AI native</h1>
          <Handlebars>Content Creation</Handlebars>
        </motion.div>

        <motion.p
          className="mt-10 text-base sm:text-xl text-slate-400 font-light tracking-wide max-w-xl mx-auto"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.8 }}
        >
          The AI native content creation tool makes your dream come true.
        </motion.p>
      </motion.div>
    </div>
  );
}
